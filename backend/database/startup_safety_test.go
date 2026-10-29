package database

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Server startup must never delete or deactivate user data. These tests run
// the REAL startup sequence (runStartupMaintenance, exactly what Connect runs)
// against data shaped like the incident of 29.10.2026.

func openStartupDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "startup.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{},
		&models.SalaryCycle{}, &models.FixedExpense{}, &models.SalaryCycleAudit{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	DB = db
	return db
}

type rowCounts struct {
	Cycles, FixedExpenses, TxAll, TxLive int64
}

func countRows(db *gorm.DB) rowCounts {
	var r rowCounts
	db.Model(&models.SalaryCycle{}).Count(&r.Cycles)
	db.Model(&models.FixedExpense{}).Count(&r.FixedExpenses)
	db.Unscoped().Model(&models.Transaction{}).Count(&r.TxAll)
	db.Model(&models.Transaction{}).Count(&r.TxLive)
	return r
}

func dateOnly(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// The incident: October (04.10 → payday 28.10) handed over to a new cycle
// that starts ON that payday at 16:00. Startup used to flag the new cycle as
// a "duplicate", delete it and mark its salary, fixed expense and allocation
// deleted. It must now survive untouched — row, dates, flags and entries.
func TestStartupKeepsCycleStartingOnPreviousPayday(t *testing.T) {
	db := openStartupDB(t)
	u := models.User{Username: "nik", Password: "x"}
	db.Create(&u)
	income := models.Category{UserID: u.ID, Name: "Income"}
	fixed := models.Category{UserID: u.ID, Name: "Базовые затраты"}
	saved := models.Category{UserID: u.ID, Name: "Сбережения"}
	db.Create(&income)
	db.Create(&fixed)
	db.Create(&saved)

	// 04.10 09:00 and 28.10 16:00 Berlin, as UTC instants (CEST / CET).
	octStart := time.Date(2026, 10, 4, 7, 0, 0, 0, time.UTC)
	handover := time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC)
	octPayday, newPayday := dateOnly(2026, 10, 28), dateOnly(2026, 11, 27)

	oct := models.SalaryCycle{
		UserID: u.ID, BaseSalary: 504, TotalIncome: 504, NeedsPct: 50, WantsPct: 30, SavingsPct: 20,
		FixedExpCategoryID: fixed.ID, SavedMoneyCategoryID: saved.ID,
		CycleStartAt: octStart, NextPaydayAt: &octPayday, EndedAt: &handover,
	}
	db.Create(&oct)
	next := models.SalaryCycle{
		UserID: u.ID, BaseSalary: 504.85, TotalIncome: 504.85, NeedsPct: 50, WantsPct: 30, SavingsPct: 20,
		FixedExpCategoryID: fixed.ID, SavedMoneyCategoryID: saved.ID, CarryOver: 11.84,
		CycleStartAt: handover, NextPaydayAt: &newPayday,
	}
	db.Create(&next)
	db.Create(&models.FixedExpense{SalaryCycleID: next.ID, UserID: u.ID, Amount: 39.99, Description: "Internet"})

	tx := func(cat uint, amount float64, typ, desc, source string, at time.Time) {
		db.Create(&models.Transaction{
			UserID: u.ID, CategoryID: cat, Amount: amount, Type: typ, Description: desc, Source: source,
			Date: dateOnly(at.Year(), at.Month(), at.Day()), CreatedAt: at, UpdatedAt: at,
		})
	}
	tx(income.ID, 504, "income", "Salary", "", octStart)
	tx(saved.ID, 100, "savings_deposit", "Planned savings allocation", "", octStart)
	// The new cycle's start-time entries — exactly what the old cleanup hit.
	tx(income.ID, 504.85, "income", "Salary", "", handover)
	tx(fixed.ID, 39.99, "expense", "Internet", "", handover)
	tx(saved.ID, 100, "savings_deposit", "Planned savings allocation", "", handover)
	tx(saved.ID, 11, "savings_deposit", "Carry-over moved to savings", "carry_over_to_savings", handover.Add(2*time.Hour))

	before := countRows(db)
	runStartupMaintenance()
	runStartupMaintenance() // and again — e.g. the next deploy

	if after := countRows(db); after != before {
		t.Fatalf("startup changed user rows: before %+v, after %+v", before, after)
	}
	var got models.SalaryCycle
	if err := db.First(&got, next.ID).Error; err != nil {
		t.Fatalf("the payday-handover cycle was deleted: %v", err)
	}
	if !got.CycleStartAt.Equal(handover) || got.StoppedAt != nil || got.EndedAt != nil ||
		got.NextPaydayAt == nil || !got.NextPaydayAt.Equal(newPayday) || got.CarryOver != 11.84 {
		t.Errorf("the new cycle was altered: %+v", got)
	}
	var gotOct models.SalaryCycle
	db.First(&gotOct, oct.ID)
	if gotOct.EndedAt == nil || !gotOct.EndedAt.Equal(handover) {
		t.Errorf("October's handover end was altered: %+v", gotOct.EndedAt)
	}
}

// Startup deletes nothing — not even what the removed cleanups targeted: an
// overlapping cycle and a cycle without any income ("ghost").
func TestStartupDeletesNoRows(t *testing.T) {
	db := openStartupDB(t)
	u := models.User{Username: "someone", Password: "x"}
	db.Create(&u)
	cat := models.Category{UserID: u.ID, Name: "Food"}
	db.Create(&cat)

	start := dateOnly(2026, 9, 1)
	payday := dateOnly(2026, 9, 30)
	db.Create(&models.SalaryCycle{UserID: u.ID, TotalIncome: 100, CycleStartAt: start, NextPaydayAt: &payday})
	overlap := start.AddDate(0, 0, 10)
	db.Create(&models.SalaryCycle{UserID: u.ID, TotalIncome: 100, CycleStartAt: overlap, NextPaydayAt: &payday})
	ghost := dateOnly(2026, 10, 1)
	db.Create(&models.SalaryCycle{UserID: u.ID, TotalIncome: 0, CycleStartAt: ghost})
	db.Create(&models.Transaction{UserID: u.ID, CategoryID: cat.ID, Amount: 100, Type: "income",
		Description: "Salary", Date: overlap, CreatedAt: overlap, UpdatedAt: overlap})
	db.Create(&models.Transaction{UserID: u.ID, CategoryID: cat.ID, Amount: 12.5, Type: "expense",
		Description: "Lunch", Date: ghost, CreatedAt: ghost, UpdatedAt: ghost})

	before := countRows(db)
	runStartupMaintenance()
	if after := countRows(db); after != before {
		t.Errorf("startup deleted rows: before %+v, after %+v", before, after)
	}
}
