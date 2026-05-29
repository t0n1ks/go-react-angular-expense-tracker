package database

import (
	"log"
	"os"

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

	// One-time backfill: salary cycles created before fixed_exp_category_id was
	// persisted correctly have the column = 0. Set it to the user's "Fixed
	// Payments" category (matched by localized name) so fixed/variable splits and
	// AI exclusion work for existing beta users. Idempotent.
	backfillFixedExpCategory()
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
