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

	err = DB.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{})
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
}
