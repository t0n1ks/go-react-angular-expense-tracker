package database

import (
	"log"
	"os"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var DB *gorm.DB

func Connect() {
	var err error

	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		DB, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	} else {
		dbPath := os.Getenv("DB_PATH")
		if dbPath == "" {
			dbPath = "expenses.db"
		}
		DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	}

	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("Database connected successfully")

	err = DB.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{}, &models.SalaryCycle{}, &models.FixedExpense{}, &models.SalaryCycleAudit{}, &models.CompanionState{})
	if err != nil {
		log.Fatalf("Failed to run database migration: %v", err)
	}

	log.Println("Database migration completed")

	runStartupMaintenance()
}

// runStartupMaintenance is EVERYTHING the server does to existing data on
// start, in order. It only widens a column and repairs/backfills reference
// fields — it NEVER deletes a cycle, a transaction or any other user row.
//
// It used to also run deduplicateSalaryCycles and deleteZeroTransactionCycles,
// one-off repairs for the pre-guard StartSalaryCycle. Their date rule treated a
// cycle starting on the previous cycle's payday — the legitimate shared-payday
// handover since the time-aware boundaries — as a duplicate, and on a restart
// permanently deleted it (and marked its start-time entries deleted). Overlaps
// are now refused when a cycle is created (cycle_window.go conflictingCycle),
// so nothing needs cleaning up at startup; deleting data here is never safe.
func runStartupMaintenance() {
	// CRITICAL: widen transactions.type before any cycle/savings write.
	// Early schemas created the column as varchar(10). SQLite ignores the length
	// so it never surfaced locally, but Postgres (production/Render) enforces it
	// strictly and rejects "savings_deposit" (15) / "savings_withdrawal" (18)
	// with SQLSTATE 22001 ("value too long"), 500-ing StartSalaryCycle and the
	// savings endpoints. AutoMigrate does not reliably widen an existing column,
	// so we issue an explicit, idempotent ALTER. Runs in Connect(), i.e. before
	// the router starts serving requests.
	widenTransactionTypeColumn()

	// One-time normalization: ensure all existing usernames are lowercase.
	if res := DB.Exec("UPDATE users SET username = LOWER(username) WHERE username != LOWER(username)"); res.Error != nil {
		log.Printf("Warning: username normalization failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("Username normalization: %d existing username(s) converted to lowercase", res.RowsAffected)
	}

	// ORDER MATTERS. Heal must run BEFORE the backfills.
	//
	// Detect and reset cycles whose fixed_exp_category_id or
	// saved_money_category_id point at a category that belongs to a different
	// user (data corruption from earlier code versions). Resetting to 0 lets
	// the backfill functions BELOW re-assign the correct per-user category in
	// this same startup pass — otherwise a corrupted cycle would be left with
	// category_id = 0 for the entire server session (breaking the fixed/variable
	// split and forcing cycle/savings writes to operate against a zero ID) until
	// the next restart.
	healCrossUserCategoryRefs()

	// One-time backfill: salary cycles created before fixed_exp_category_id was
	// persisted correctly have the column = 0 (or were just reset to 0 by the
	// heal step above). Set it to the user's "Fixed Payments" category (matched
	// by localized name) so fixed/variable splits and AI exclusion work for
	// existing beta users. Idempotent.
	backfillFixedExpCategory()

	// Backfill saved_money_category_id for cycles that pre-date the savings pool
	// feature, or that were just reset to 0 by the heal step above.
	backfillSavedMoneyCategory()

	// Lite separation: tag pre-existing rows and open a Lite period for users
	// already in Lite. Only the new columns are written.
	backfillTransactionMode()

	// One-time, reversible: bring pre-update entries of pure-Lite users (in
	// Lite, never a cycle) back into Lite. Tag columns only; ids backed up.
	retagPreUpdateLiteEntries()

	// Visible in the deploy log: proves this non-deleting startup is live.
	log.Println("Startup maintenance completed (non-destructive: no cycles or transactions deleted)")
}

// widenTransactionTypeColumn ensures transactions.type is wide enough to hold
// the longest value the app writes ("savings_withdrawal", 18 chars).
//
// Only Postgres enforces varchar length, so the ALTER is Postgres-specific;
// SQLite stores any-length text regardless of the declared size, so it is a
// no-op there. The statement is idempotent — re-running it just re-asserts the
// same type. Safe to run on every startup.
func widenTransactionTypeColumn() {
	if DB.Dialector.Name() != "postgres" {
		return // SQLite (and others) do not enforce varchar length
	}
	const sql = `ALTER TABLE transactions ALTER COLUMN type TYPE varchar(30)`
	if res := DB.Exec(sql); res.Error != nil {
		// Fatal: leaving a too-narrow column means every cycle/savings write
		// will 500 in production, so fail loudly rather than serve broken.
		log.Fatalf("widenTransactionTypeColumn: failed to widen transactions.type: %v", res.Error)
	}
	log.Println("Schema: transactions.type ensured at varchar(30)")
}

// backfillFixedExpCategory sets salary_cycles.fixed_exp_category_id for rows
// where it is still 0, matching each cycle's user to their Fixed Payments
// category by any of the four localized names.
func backfillFixedExpCategory() {
	const sql = `
		UPDATE salary_cycles
		SET fixed_exp_category_id = (
			SELECT c.id FROM categories c
			WHERE c.user_id = salary_cycles.user_id
			  AND c.name IN ('Fixed Payments', 'Базовые затраты', 'Базові витрати', 'Fixkosten')
			ORDER BY c.id
			LIMIT 1
		)
		WHERE (fixed_exp_category_id IS NULL OR fixed_exp_category_id = 0)
		  AND EXISTS (
			SELECT 1 FROM categories c
			WHERE c.user_id = salary_cycles.user_id
			  AND c.name IN ('Fixed Payments', 'Базовые затраты', 'Базові витрати', 'Fixkosten')
		)`
	if res := DB.Exec(sql); res.Error != nil {
		log.Printf("Warning: fixed_exp_category_id backfill failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("fixed_exp_category_id backfill: updated %d cycle(s)", res.RowsAffected)
	}
}

// backfillSavedMoneyCategory sets saved_money_category_id for cycles that
// pre-date the savings-pool feature, using any of the four localized names.
func backfillSavedMoneyCategory() {
	const sql = `
		UPDATE salary_cycles
		SET saved_money_category_id = (
			SELECT c.id FROM categories c
			WHERE c.user_id = salary_cycles.user_id
			  AND c.name IN ('Saved Money', 'Ersparnisse', 'Сбережения', 'Заощадження')
			ORDER BY c.id
			LIMIT 1
		)
		WHERE (saved_money_category_id IS NULL OR saved_money_category_id = 0)
		  AND EXISTS (
			SELECT 1 FROM categories c
			WHERE c.user_id = salary_cycles.user_id
			  AND c.name IN ('Saved Money', 'Ersparnisse', 'Сбережения', 'Заощадження')
		)`
	if res := DB.Exec(sql); res.Error != nil {
		log.Printf("Warning: saved_money_category_id backfill failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("saved_money_category_id backfill: updated %d cycle(s)", res.RowsAffected)
	}
}

// healCrossUserCategoryRefs detects and resets salary cycle rows whose
// fixed_exp_category_id or saved_money_category_id point at a category that
// belongs to a DIFFERENT user. This can happen when a previous code version
// had a defect in the category-lookup logic. Resetting to 0 lets the
// backfill functions re-assign the correct per-user category on the next
// startup, or the next StartSalaryCycle call will create fresh ones.
// Idempotent; safe to run on every start.
func healCrossUserCategoryRefs() {
	const fixSQL = `
		UPDATE salary_cycles
		SET fixed_exp_category_id = 0
		WHERE fixed_exp_category_id > 0
		  AND NOT EXISTS (
			SELECT 1 FROM categories c
			WHERE c.id = salary_cycles.fixed_exp_category_id
			  AND c.user_id = salary_cycles.user_id
		)`
	if res := DB.Exec(fixSQL); res.Error != nil {
		log.Printf("healCrossUserCategoryRefs: fixed_exp reset failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("healCrossUserCategoryRefs: reset %d cycle(s) with wrong fixed_exp_category_id", res.RowsAffected)
	}

	const savedSQL = `
		UPDATE salary_cycles
		SET saved_money_category_id = 0
		WHERE saved_money_category_id > 0
		  AND NOT EXISTS (
			SELECT 1 FROM categories c
			WHERE c.id = salary_cycles.saved_money_category_id
			  AND c.user_id = salary_cycles.user_id
		)`
	if res := DB.Exec(savedSQL); res.Error != nil {
		log.Printf("healCrossUserCategoryRefs: saved_money reset failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("healCrossUserCategoryRefs: reset %d cycle(s) with wrong saved_money_category_id", res.RowsAffected)
	}
}

// backfillTransactionMode sets the new mode tag on rows that pre-date it
// (all of them are extended-mode entries) and gives users who were already in
// Lite mode their first Lite period, starting now. It writes ONLY the new
// columns (transactions.mode, users.lite_period / lite_started_at); no amount,
// date, category or other content changes. Idempotent.
func backfillTransactionMode() {
	if res := DB.Exec("UPDATE transactions SET mode = ? WHERE mode IS NULL OR mode = ''", models.TxModeExtended); res.Error != nil {
		log.Printf("Warning: transaction mode backfill failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("Transaction mode backfill: %d row(s) tagged extended", res.RowsAffected)
	}
	if res := DB.Model(&models.User{}).
		Where("lite_mode = ? AND (lite_period IS NULL OR lite_period = 0)", true).
		Updates(map[string]any{"lite_period": 1, "lite_started_at": time.Now()}); res.Error != nil {
		log.Printf("Warning: Lite period backfill failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("Lite period backfill: %d Lite user(s) given a first period", res.RowsAffected)
	}
}
