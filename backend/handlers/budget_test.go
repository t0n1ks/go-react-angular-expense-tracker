package handlers

import (
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// A no-salary user with a monthly goal gets a safe, month-scoped budget window.
func TestBudgetWindow_SafeAllowanceAndWindow(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "nosalary", Password: "x", MonthlySpendingGoal: 400}
	database.DB.Create(&user)

	cat := models.Category{UserID: user.ID, Name: "Groceries"}
	database.DB.Create(&cat)

	// Fix "now" late in the month so days_remaining is small — this is exactly
	// where the old client formula ran away (×7). Use the 28th so the assertion
	// holds in every month.
	now := time.Date(2026, time.July, 28, 12, 0, 0, 0, time.Local)

	// €139.98 spent this month.
	database.DB.Create(&models.Transaction{
		UserID: user.ID, CategoryID: cat.ID, Amount: 139.98, Type: "expense",
		Date: now, CreatedAt: now.AddDate(0, 0, -2), UpdatedAt: now,
	})

	bw := computeBudgetWindow(user.ID, user.MonthlySpendingGoal, now)

	if !bw.HasGoal {
		t.Fatal("expected has_goal=true")
	}
	if bw.WindowStart.Day() != 1 || bw.WindowStart.Month() != time.July {
		t.Errorf("window should start on July 1, got %v", bw.WindowStart)
	}
	remaining := 400 - 139.98
	if bw.CurrentWeekAllowance > remaining+0.01 {
		t.Errorf("week allowance %.2f exceeds remaining budget %.2f (runaway!)",
			bw.CurrentWeekAllowance, remaining)
	}
	if bw.CurrentWeekAllowance <= 0 {
		t.Errorf("expected a positive allowance, got %.2f", bw.CurrentWeekAllowance)
	}
	if bw.SpentThisWindow != 139.98 {
		t.Errorf("spent_this_window: want 139.98, got %.2f", bw.SpentThisWindow)
	}
}

// No goal set → has_goal=false and a €500 default is offered.
func TestBudgetWindow_NoGoal(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "blank", Password: "x", MonthlySpendingGoal: 0}
	database.DB.Create(&user)

	bw := computeBudgetWindow(user.ID, user.MonthlySpendingGoal, time.Now())
	if bw.HasGoal {
		t.Error("expected has_goal=false when no goal is set")
	}
	if bw.DefaultGoal != DefaultMonthlyBudget {
		t.Errorf("default_goal: want %.0f, got %.2f", DefaultMonthlyBudget, bw.DefaultGoal)
	}
}

// Expenses from a previous month must NOT count toward the current window.
func TestBudgetWindow_ExcludesOtherMonths(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "spanner", Password: "x", MonthlySpendingGoal: 300}
	database.DB.Create(&user)
	cat := models.Category{UserID: user.ID, Name: "Misc"}
	database.DB.Create(&cat)

	now := time.Date(2026, time.July, 15, 12, 0, 0, 0, time.Local)
	lastMonth := time.Date(2026, time.June, 20, 12, 0, 0, 0, time.Local)

	database.DB.Create(&models.Transaction{
		UserID: user.ID, CategoryID: cat.ID, Amount: 999, Type: "expense",
		Date: lastMonth, CreatedAt: lastMonth, UpdatedAt: lastMonth,
	})
	database.DB.Create(&models.Transaction{
		UserID: user.ID, CategoryID: cat.ID, Amount: 50, Type: "expense",
		Date: now, CreatedAt: now, UpdatedAt: now,
	})

	bw := computeBudgetWindow(user.ID, user.MonthlySpendingGoal, now)
	if bw.SpentThisWindow != 50 {
		t.Errorf("spent_this_window should exclude June's €999, want 50, got %.2f", bw.SpentThisWindow)
	}
}
