package database

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// TestHealThenBackfillRepairsInOnePass proves the startup-migration ordering
// fix: a cycle whose category IDs were corrupted to point at ANOTHER user's
// categories must be both reset (heal) and re-assigned to the owning user's
// own localized categories (backfill) within a SINGLE startup pass.
//
// With the old order (backfill before heal) the heal step left the cycle at
// category_id = 0 for the whole session; this test guards the corrected order.
func TestHealThenBackfillRepairsInOnePass(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "heal.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{}, &models.SalaryCycle{}, &models.FixedExpense{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Close the handle before t.TempDir cleanup runs, otherwise Windows refuses
	// to unlink the still-open DB file and fails the test.
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	DB = db

	// Two users.
	victim := models.User{Username: "victim", Password: "x"}
	intruder := models.User{Username: "intruder", Password: "x"}
	db.Create(&victim)
	db.Create(&intruder)

	// Intruder owns categories that the victim's cycle erroneously references.
	intruderFixed := models.Category{UserID: intruder.ID, Name: "Fixed Payments"}
	intruderSaved := models.Category{UserID: intruder.ID, Name: "Saved Money"}
	db.Create(&intruderFixed)
	db.Create(&intruderSaved)

	// The victim DOES own correct localized categories of their own.
	victimFixed := models.Category{UserID: victim.ID, Name: "Fixed Payments"}
	victimSaved := models.Category{UserID: victim.ID, Name: "Saved Money"}
	db.Create(&victimFixed)
	db.Create(&victimSaved)

	// Victim's cycle is corrupted: it points at the intruder's category IDs.
	start := time.Now().AddDate(0, 0, -2)
	payday := start.AddDate(0, 0, 30)
	cycle := models.SalaryCycle{
		UserID: victim.ID, BaseSalary: 2000, TotalIncome: 2000,
		NeedsPct: 50, WantsPct: 30, SavingsPct: 20,
		CycleStartAt: start, NextPaydayAt: &payday,
		CreatedAt: start, UpdatedAt: start,
		FixedExpCategoryID:   intruderFixed.ID, // WRONG owner
		SavedMoneyCategoryID: intruderSaved.ID, // WRONG owner
	}
	db.Create(&cycle)
	// Give it an income tx so deleteZeroTransactionCycles doesn't remove it.
	db.Create(&models.Transaction{
		UserID: victim.ID, CategoryID: victimFixed.ID, Amount: 2000,
		Description: "Salary", Date: start, Type: "income",
		CreatedAt: start, UpdatedAt: start,
	})

	// Run the startup maintenance sequence in the SAME order Connect() uses.
	healCrossUserCategoryRefs()
	backfillFixedExpCategory()
	backfillSavedMoneyCategory()
	deduplicateSalaryCycles()
	deleteZeroTransactionCycles()

	var got models.SalaryCycle
	if err := db.First(&got, cycle.ID).Error; err != nil {
		t.Fatalf("reload cycle: %v", err)
	}

	if got.FixedExpCategoryID != victimFixed.ID {
		t.Errorf("fixed_exp_category_id: want victim's %d, got %d (0 means heal left it broken for the session)",
			victimFixed.ID, got.FixedExpCategoryID)
	}
	if got.SavedMoneyCategoryID != victimSaved.ID {
		t.Errorf("saved_money_category_id: want victim's %d, got %d",
			victimSaved.ID, got.SavedMoneyCategoryID)
	}
}
