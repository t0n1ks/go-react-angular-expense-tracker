package database

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// TestWidenTransactionTypeColumn_SQLiteNoOpAndAcceptsLongTypes verifies that
// widenTransactionTypeColumn is a safe no-op on SQLite (which does not enforce
// varchar length) and that the long savings type strings insert successfully.
//
// The Postgres path (the one that was actually failing in production with
// SQLSTATE 22001) cannot be exercised without a live Postgres server, but the
// dialector gate below guarantees we only emit the ALTER there.
func TestWidenTransactionTypeColumn_SQLiteNoOpAndAcceptsLongTypes(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "widen.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	DB = db

	if got := DB.Dialector.Name(); got != "sqlite" {
		t.Fatalf("expected sqlite dialector, got %q", got)
	}

	// Must not panic / fatal / error on a non-postgres dialect.
	widenTransactionTypeColumn()

	// The longest type strings the app writes must round-trip.
	for _, typ := range []string{"savings_deposit", "savings_withdrawal"} {
		tx := models.Transaction{
			UserID: 1, CategoryID: 1, Amount: 10, Description: "x",
			Date: time.Now(), Type: typ, IncomeType: "one_time",
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		}
		if err := DB.Create(&tx).Error; err != nil {
			t.Fatalf("insert type=%q failed: %v", typ, err)
		}
		var reload models.Transaction
		DB.First(&reload, tx.ID)
		if reload.Type != typ {
			t.Errorf("type round-trip: want %q, got %q", typ, reload.Type)
		}
	}
}
