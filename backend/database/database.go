package database

import (
	"log"
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var DB *gorm.DB

func Connect() {
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "expenses.db"
	}

	var err error
	DB, err = gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("Database connected successfully")

	err = DB.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{})
	if err != nil {
		log.Fatalf("Failed to run database migration: %v", err)
	}

	log.Println("Database migration completed")
}
