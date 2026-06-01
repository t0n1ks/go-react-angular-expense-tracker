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

	err = DB.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{}, &models.SalaryCycle{}, &models.FixedExpense{})
	if err != nil {
		log.Fatalf("Failed to run database migration: %v", err)
	}

	log.Println("Database migration completed")

	// One-time normalization: ensure all existing usernames are lowercase.
	if res := DB.Exec("UPDATE users SET username = LOWER(username) WHERE username != LOWER(username)"); res.Error != nil {
		log.Printf("Warning: username normalization failed: %v", res.Error)
	} else if res.RowsAffected > 0 {
		log.Printf("Username normalization: %d existing username(s) converted to lowercase", res.RowsAffected)
	}

	// One-time backfill: GORM column default only applies to new INSERTs, not ALTER ADD COLUMN.
	if res := DB.Exec("UPDATE users SET hearts_count = 3 WHERE hearts_count = 0"); res.Error != nil {
		log.Printf("Warning: hearts_count backfill failed: %v", res.Error)
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

	// Remove duplicate/overlapping salary cycles that were created by the old
	// (pre-guard) StartSalaryCycle logic when users submitted backdated dates.
	// This is idempotent and safe to run on every start.
	deduplicateSalaryCycles()

	// Remove any salary cycles that have absolutely zero income transactions in
	// their window — these are ghost placeholders that were never properly funded.
	deleteZeroTransactionCycles()
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

// deleteZeroTransactionCycles removes any SalaryCycle row that has no income
// transaction within its window. These are "ghost" placeholders — the cycle
// form was submitted but no salary money was ever actually recorded.
// Runs once on startup; idempotent.
func deleteZeroTransactionCycles() {
	var cycles []models.SalaryCycle
	if err := DB.Order("user_id ASC, cycle_start_at ASC").Find(&cycles).Error; err != nil {
		log.Printf("deleteZeroTransactionCycles: load error: %v", err)
		return
	}

	var toDelete []uint
	for _, cycle := range cycles {
		var count int64
		// Use a 5-minute buffer before cycle_start_at so that any GORM
		// auto-timestamp imprecision (sub-second differences between when
		// the cycle row and its salary transaction are written) never causes
		// a legitimate cycle to be misidentified as a ghost.
		bufStart := cycle.CycleStartAt.Add(-5 * time.Minute)
		q := DB.Model(&models.Transaction{}).
			Where("user_id = ? AND created_at >= ? AND type = 'income'", cycle.UserID, bufStart)
		if cycle.NextPaydayAt != nil {
			q = q.Where("created_at <= ?", *cycle.NextPaydayAt)
		}
		q.Count(&count)

		if count == 0 {
			log.Printf("deleteZeroTransactionCycles: user=%d cycle id=%d (start=%s) has 0 income txs — deleting ghost",
				cycle.UserID, cycle.ID, cycle.CycleStartAt.Format("2006-01-02"))
			DB.Where("salary_cycle_id = ?", cycle.ID).Delete(&models.FixedExpense{})
			toDelete = append(toDelete, cycle.ID)
		}
	}

	if len(toDelete) > 0 {
		DB.Where("id IN ?", toDelete).Delete(&models.SalaryCycle{})
		log.Printf("deleteZeroTransactionCycles: removed %d ghost cycle(s)", len(toDelete))
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

// normalizeToDate returns midnight UTC for t — identical semantics to the
// handlers.toDateOnly helper but kept here so database.go has no import cycle.
func normalizeToDate(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// deduplicateSalaryCycles removes salary cycle rows whose cycle_start_at (as a
// calendar date) falls inside an earlier cycle's [start, next_payday] window.
// This repairs databases that accumulated ghost fragments from the old
// StartSalaryCycle logic which blindly inserted a new row on every call.
//
// For each duplicate cycle the function also soft-deletes the auto-generated
// transactions that were created when that duplicate cycle was provisioned:
//   - The "Salary" income transaction
//   - Any fixed-expense transactions (category = fixed_exp_category_id)
//   - Any savings-transfer transactions (category = saved_money_category_id)
//
// FixedExpense metadata rows are hard-deleted (no soft-delete column).
// The function is idempotent: re-running it after cleanup does nothing.
func deduplicateSalaryCycles() {
	var allCycles []models.SalaryCycle
	if err := DB.Order("user_id ASC, cycle_start_at ASC").Find(&allCycles).Error; err != nil {
		log.Printf("dedup cycles: load error: %v", err)
		return
	}

	// Group by user
	byUser := make(map[uint][]models.SalaryCycle)
	for _, c := range allCycles {
		byUser[c.UserID] = append(byUser[c.UserID], c)
	}

	totalDeleted := 0
	for uid, userCycles := range byUser {
		if len(userCycles) <= 1 {
			continue
		}

		var toDelete []uint

		for i := 1; i < len(userCycles); i++ {
			dup := userCycles[i]
			dupDate := normalizeToDate(dup.CycleStartAt)

			isDuplicate := false
			for j := 0; j < i; j++ {
				parent := userCycles[j]
				pStart := normalizeToDate(parent.CycleStartAt)

				if dupDate.Before(pStart) {
					continue
				}
				inWindow := true
				if parent.NextPaydayAt != nil {
					pEnd := normalizeToDate(*parent.NextPaydayAt)
					if dupDate.After(pEnd) {
						inWindow = false
					}
				}
				if inWindow {
					isDuplicate = true
					log.Printf("dedup: user=%d — cycle id=%d (start=%s) overlaps with id=%d (start=%s), cleaning up",
						uid, dup.ID, dupDate.Format("2006-01-02"),
						parent.ID, normalizeToDate(parent.CycleStartAt).Format("2006-01-02"))
					break
				}
			}

			if !isDuplicate {
				continue
			}

			// Cleanup window: 60 s around the duplicate cycle's exact start time.
			// Auto-generated transactions use CreatedAt == cycleStart so they're
			// squarely inside this window; user-entered transactions are not.
			winEnd := dup.CycleStartAt.Add(60 * time.Second)

			// 1. Salary income transaction
			DB.Where(
				"user_id = ? AND created_at >= ? AND created_at <= ? AND type = 'income' AND description = 'Salary'",
				uid, dup.CycleStartAt, winEnd,
			).Delete(&models.Transaction{})

			// 2. Fixed-expense transactions
			if dup.FixedExpCategoryID > 0 {
				DB.Where(
					"user_id = ? AND created_at >= ? AND created_at <= ? AND category_id = ?",
					uid, dup.CycleStartAt, winEnd, dup.FixedExpCategoryID,
				).Delete(&models.Transaction{})
			}

			// 3. Savings-transfer transactions (surplus/deficit injections)
			if dup.SavedMoneyCategoryID > 0 {
				DB.Where(
					"user_id = ? AND created_at >= ? AND created_at <= ? AND category_id = ?",
					uid, dup.CycleStartAt, winEnd, dup.SavedMoneyCategoryID,
				).Delete(&models.Transaction{})
			}

			// 4. FixedExpense metadata rows (hard delete — no DeletedAt column)
			DB.Where("salary_cycle_id = ?", dup.ID).Delete(&models.FixedExpense{})

			toDelete = append(toDelete, dup.ID)
		}

		if len(toDelete) > 0 {
			DB.Where("id IN ?", toDelete).Delete(&models.SalaryCycle{})
			totalDeleted += len(toDelete)
		}
	}

	if totalDeleted > 0 {
		log.Printf("dedup cycles: removed %d duplicate salary cycle(s)", totalDeleted)
	}
}
