package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// TestSavingsPoolNet covers the pure balance rule:
// remaining = allocated − withdrawn + additions, across every entry type the
// pool can hold (new typed entries and legacy income/expense in the pool).
func TestSavingsPoolNet(t *testing.T) {
	pool := []models.Transaction{
		{Type: "savings_deposit", Amount: 100.8}, // planned allocation
		{Type: "savings_withdrawal", Amount: 30}, // manual withdrawal
		{Type: "expense", Amount: 5},             // legacy spend from the pool
		{Type: "savings_deposit", Amount: 10},    // manual addition
		{Type: "income", Amount: 2.2},            // legacy deposit
	}
	if got, want := savingsPoolNet(pool), 78.0; math.Abs(got-want) > 1e-9 {
		t.Fatalf("savingsPoolNet = %v, want %v", got, want)
	}
	if got := savingsPoolNet(nil); got != 0 {
		t.Fatalf("empty pool = %v, want 0", got)
	}
}

// TestSavingsBalanceReflectsWithdrawal is the regression for the stale
// "Запланированные сбережения €100,8" card: after money is taken out of the
// pool, the dashboard's balance figure, the savings-history modal and the
// planned allocation must each report the right thing.
func TestSavingsBalanceReflectsWithdrawal(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "savingsuser", Password: "x"}
	if err := database.DB.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	// €504 × 20% = €100.80 — the figure from the bug report (allocated as €100).
	start := map[string]any{
		"base_salary": 504.0, "language": "ru", "savings_pct": 20.0,
		"needs_pct": 50.0, "wants_pct": 30.0,
		"received_at_date": time.Now().AddDate(0, 0, -5).Format("2006-01-02"),
		"next_payday_date": time.Now().AddDate(0, 0, 25).Format("2006-01-02"),
	}
	if w := callHandler(user.ID, start, StartSalaryCycle); w.Code != http.StatusCreated {
		t.Fatalf("StartSalaryCycle: %d %s", w.Code, w.Body.String())
	}
	if w := callHandler(user.ID, map[string]any{"amount": -30.0}, AddSavingsManual); w.Code != http.StatusCreated {
		t.Fatalf("withdraw: %d %s", w.Code, w.Body.String())
	}
	if w := callHandler(user.ID, map[string]any{"amount": 10.0}, AddSavingsManual); w.Code != http.StatusCreated {
		t.Fatalf("deposit: %d %s", w.Code, w.Body.String())
	}

	w := callHandler(user.ID, nil, GetCurrentSalaryCycle)
	var cur struct {
		Stats struct {
			SavedMoneyBalance float64 `json:"saved_money_balance"`
			DynamicSavings    float64 `json:"dynamic_savings"`
		} `json:"cycle_stats"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &cur); err != nil {
		t.Fatalf("decode current: %v", err)
	}
	// Allocation is rounded down to €100; manual entries keep their cents.
	if math.Abs(cur.Stats.SavedMoneyBalance-80) > 0.001 {
		t.Errorf("saved_money_balance = %v, want 80 (100 − 30 + 10)", cur.Stats.SavedMoneyBalance)
	}
	if math.Abs(cur.Stats.DynamicSavings-100) > 0.001 {
		t.Errorf("dynamic_savings (planned) = %v, want 100", cur.Stats.DynamicSavings)
	}

	// The savings-history modal must agree with the dashboard figure.
	w = callHandler(user.ID, nil, GetSavingsHistory)
	var hist struct {
		Balance float64 `json:"balance"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &hist); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	if math.Abs(hist.Balance-cur.Stats.SavedMoneyBalance) > 0.001 {
		t.Errorf("history balance %v != dashboard balance %v", hist.Balance, cur.Stats.SavedMoneyBalance)
	}
}

// TestPlannedSavingsRoundsDownToWholeUnits covers the whole-unit rule and its
// float edge: 333.33 × 30% = 99.999 must round to 100.00 first, not floor to 99.
func TestPlannedSavingsRoundsDownToWholeUnits(t *testing.T) {
	cases := []struct {
		income, pct, alloc, remainder float64
	}{
		{504, 20, 100, 0.80},
		{500, 20, 100, 0},
		{333.33, 30, 100, 0},
		{1234.56, 15, 185, 0.18},
		{0, 20, 0, 0},
		{1000, 0, 0, 0},
	}
	for _, c := range cases {
		if got := plannedSavingsAllocation(c.income, c.pct); got != c.alloc {
			t.Errorf("alloc(%v, %v%%) = %v, want %v", c.income, c.pct, got, c.alloc)
		}
		if got := savingsRoundingRemainder(c.income, c.pct); math.Abs(got-c.remainder) > 1e-9 {
			t.Errorf("remainder(%v, %v%%) = %v, want %v", c.income, c.pct, got, c.remainder)
		}
	}
}

// TestBudgetFrameworkRedirectsSavingsCents: the shed cents raise the spendable
// (wants) budget by exactly the remainder, and the split still sums to income.
func TestBudgetFrameworkRedirectsSavingsCents(t *testing.T) {
	fw := ComputeBudgetFramework(504, 50, 30, 20, nil)
	if fw.SavingsLimit != 100 {
		t.Fatalf("SavingsLimit = %v, want 100", fw.SavingsLimit)
	}
	if math.Abs(fw.WantsLimit-152.0) > 1e-9 { // 151.20 + 0.80
		t.Errorf("WantsLimit = %v, want 152.00", fw.WantsLimit)
	}
	if sum := fw.NeedsLimit + fw.WantsLimit + fw.SavingsLimit; math.Abs(sum-504) > 1e-9 {
		t.Errorf("needs+wants+savings = %v, want 504", sum)
	}
}

// TestCycleAllowanceAbsorbsSavingsCents: the live cycle stats put the €0.80 in
// the variable allowance and the pool receives exactly €100 — nothing lost.
func TestCycleAllowanceAbsorbsSavingsCents(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "centsuser", Password: "x"}
	if err := database.DB.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	start := map[string]any{
		"base_salary": 504.0, "language": "en", "savings_pct": 20.0,
		"needs_pct": 50.0, "wants_pct": 30.0,
		"received_at_date": time.Now().AddDate(0, 0, -2).Format("2006-01-02"),
		"next_payday_date": time.Now().AddDate(0, 0, 28).Format("2006-01-02"),
	}
	if w := callHandler(user.ID, start, StartSalaryCycle); w.Code != http.StatusCreated {
		t.Fatalf("StartSalaryCycle: %d %s", w.Code, w.Body.String())
	}
	w := callHandler(user.ID, nil, GetCurrentSalaryCycle)
	var cur struct {
		Stats struct {
			CycleIncome       float64 `json:"cycle_income"`
			VariableAllowance float64 `json:"variable_allowance"`
			DynamicSavings    float64 `json:"dynamic_savings"`
			SavedMoneyBalance float64 `json:"saved_money_balance"`
		} `json:"cycle_stats"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &cur); err != nil {
		t.Fatalf("decode: %v", err)
	}
	s := cur.Stats
	if s.DynamicSavings != 100 || s.SavedMoneyBalance != 100 {
		t.Errorf("planned=%v pool=%v, want both 100", s.DynamicSavings, s.SavedMoneyBalance)
	}
	if math.Abs(s.VariableAllowance-404) > 1e-9 { // 504 − 100, includes the €0.80
		t.Errorf("variable_allowance = %v, want 404", s.VariableAllowance)
	}
	if math.Abs(s.VariableAllowance+s.DynamicSavings-s.CycleIncome) > 1e-9 {
		t.Errorf("allowance + savings (%v) != income (%v)", s.VariableAllowance+s.DynamicSavings, s.CycleIncome)
	}
}
