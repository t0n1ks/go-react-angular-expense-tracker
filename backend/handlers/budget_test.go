package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// A user can set a monthly limit, then EDIT it: the new value persists and the
// server-computed weekly allowance recomputes accordingly. Regression guard for
// the Phase-2.5 "can't change the amount after setting it" bug.
func TestEditMonthlyLimit_PersistsAndRecomputes(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "editor", Password: "x"}
	database.DB.Create(&user)

	now := time.Now()

	// Set the limit to 500 via the real profile handler.
	if w := callHandler(user.ID, map[string]any{"monthly_spending_goal": 500.0, "currency": "EUR"}, UpdateProfile); w.Code != http.StatusOK {
		t.Fatalf("set limit: %d %s", w.Code, w.Body.String())
	}
	var u1 models.User
	database.DB.First(&u1, user.ID)
	if u1.MonthlySpendingGoal != 500 {
		t.Fatalf("limit not persisted: got %.2f", u1.MonthlySpendingGoal)
	}
	before := computeBudgetWindow(user.ID, u1.MonthlySpendingGoal, now)

	// EDIT the limit to 300.
	if w := callHandler(user.ID, map[string]any{"monthly_spending_goal": 300.0, "currency": "EUR"}, UpdateProfile); w.Code != http.StatusOK {
		t.Fatalf("edit limit: %d %s", w.Code, w.Body.String())
	}
	var u2 models.User
	database.DB.First(&u2, user.ID)
	if u2.MonthlySpendingGoal != 300 {
		t.Fatalf("edited limit not persisted: got %.2f", u2.MonthlySpendingGoal)
	}
	after := computeBudgetWindow(user.ID, u2.MonthlySpendingGoal, now)

	if after.MonthlyBudget != 300 {
		t.Errorf("budget window should reflect edited limit, got %.2f", after.MonthlyBudget)
	}
	if !(after.CurrentWeekAllowance < before.CurrentWeekAllowance) {
		t.Errorf("weekly allowance should recompute lower after cutting the limit: 500→%.2f, 300→%.2f",
			before.CurrentWeekAllowance, after.CurrentWeekAllowance)
	}
}

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
