package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── helpers ──────────────────────────────────────────────────────────────────

type carryStats struct {
	CycleIncome           float64 `json:"cycle_income"`
	CycleVariableExpenses float64 `json:"cycle_variable_expenses"`
	VariableAllowance     float64 `json:"variable_allowance"`
	DynamicSavings        float64 `json:"dynamic_savings"`
	SavedMoneyBalance     float64 `json:"saved_money_balance"`
	CarryOver             float64 `json:"carry_over"`
	CarryOverToSavings    float64 `json:"carry_over_to_savings"`
	CarryOverMovable      float64 `json:"carry_over_movable"`
}

func currentStats(t *testing.T, uid uint) (carryStats, bool) {
	t.Helper()
	InvalidateCycleCache(uid)
	w := callHandlerTZ(uid, nil, GetCurrentSalaryCycle, "UTC")
	var r struct {
		HasActive bool        `json:"has_active_cycle"`
		Stats     *carryStats `json:"cycle_stats"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &r); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if r.Stats == nil {
		return carryStats{}, r.HasActive
	}
	return *r.Stats, r.HasActive
}

// spendEarlier records an expense and moves its entry time `ago` into the past
// (dated that day), so it unambiguously precedes a handover made now.
func spendEarlier(t *testing.T, uid uint, amount float64, ago time.Duration) {
	t.Helper()
	addExpense(t, uid, amount, udate(0))
	var tx models.Transaction
	database.DB.Where("user_id = ? AND type = ?", uid, "expense").Order("id DESC").First(&tx)
	at := time.Now().Add(-ago).UTC()
	database.DB.Model(&tx).Updates(map[string]any{
		"created_at": at, "date": time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC),
	})
}

func approx(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 0.001 {
		t.Errorf("%s = %.2f, want %.2f", label, got, want)
	}
}

func countTx(uid uint, where string, args ...any) int64 {
	var n int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", uid).Where(where, args...).Count(&n)
	return n
}

// ── Pure rounding rule ────────────────────────────────────────────────────────

func TestSplitToWholeUnits(t *testing.T) {
	cases := []struct{ in, whole, cents float64 }{
		{12.80, 12, 0.80},
		{393.80, 393, 0.80},
		{99.999, 100, 0}, // rounded to cents first
		{0.80, 0, 0.80},
		{0, 0, 0},
		{-5, 0, 0},
	}
	for _, c := range cases {
		w, ct := splitToWholeUnits(c.in)
		if w != c.whole || math.Abs(ct-c.cents) > 1e-9 {
			t.Errorf("split(%v) = %v + %v, want %v + %v", c.in, w, ct, c.whole, c.cents)
		}
	}
}

// ── Carry-over ────────────────────────────────────────────────────────────────

// The unspent budget of the closing cycle becomes extra spendable budget in
// the new one — exactly, not as income and not as savings.
func TestCarryOverIntoNewCycle(t *testing.T) {
	u := newTZUser(t, "carry")
	startUTC(t, u.ID, udate(-30), udate(0)) // allowance 504 − 100 = 404
	spendEarlier(t, u.ID, 10, time.Minute)
	before, _ := currentStats(t, u.ID)
	remainder := before.VariableAllowance - before.CycleVariableExpenses // 394

	if w := startUTC(t, u.ID, udate(0), udate(30)); w.Code != http.StatusCreated {
		t.Fatalf("start next: %d %s", w.Code, w.Body.String())
	}
	s, _ := currentStats(t, u.ID)
	approx(t, "carry_over", s.CarryOver, remainder)
	approx(t, "carry_over", s.CarryOver, 394)
	approx(t, "variable_allowance (404 base + 394 carried)", s.VariableAllowance, 798)
	approx(t, "cycle_income (carry is not income)", s.CycleIncome, 504)
	approx(t, "pool (two allocations, no bonus)", s.SavedMoneyBalance, 200)
	if n := countTx(u.ID, "description = ?", "Pleasant bonus from the previous cycle"); n != 0 {
		t.Errorf("the remainder must not go to savings, found %d bonus deposits", n)
	}
}

// An overspent cycle carries nothing; the overspend is covered from savings.
func TestOverspentCycleCarriesNothing(t *testing.T) {
	u := newTZUser(t, "overspent")
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 450, time.Minute) // 46 over the 404 allowance

	startUTC(t, u.ID, udate(0), udate(30))
	s, _ := currentStats(t, u.ID)
	approx(t, "carry_over", s.CarryOver, 0)
	approx(t, "variable_allowance", s.VariableAllowance, 404)
	approx(t, "pool (100 + 100 − 46 penalty)", s.SavedMoneyBalance, 154)
}

// A stopped cycle settles only up to its stop: spending after it belonged to
// the no-cycle monthly budget and must not eat the carry-over.
func TestStoppedCycleSettlesAtStop(t *testing.T) {
	u := newTZUser(t, "stoppedcarry")
	startUTC(t, u.ID, udate(-30), udate(-5))
	spendEarlier(t, u.ID, 10, 20*24*time.Hour)
	stopped := time.Now().Add(-10 * 24 * time.Hour)
	database.DB.Model(&models.SalaryCycle{}).Where("user_id = ?", u.ID).Update("stopped_at", stopped)
	spendEarlier(t, u.ID, 300, 3*24*time.Hour) // after the stop

	startUTC(t, u.ID, udate(0), udate(30))
	s, _ := currentStats(t, u.ID)
	approx(t, "carry_over (404 − 10, post-stop spend excluded)", s.CarryOver, 394)
}

// Moving the carry-over to savings: whole units move, cents stay spendable,
// and totals reconcile; a second move has nothing left to move.
func TestMoveCarryOverToSavings(t *testing.T) {
	u := newTZUser(t, "movecarry")
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 10.20, time.Minute) // remainder 393.80
	startUTC(t, u.ID, udate(0), udate(30))

	before, _ := currentStats(t, u.ID)
	approx(t, "carry_over", before.CarryOver, 393.80)
	approx(t, "movable", before.CarryOverMovable, 393)

	w := callHandlerTZ(u.ID, nil, MoveCarryOverToSavings, "UTC")
	if w.Code != http.StatusCreated {
		t.Fatalf("move: %d %s", w.Code, w.Body.String())
	}
	after, _ := currentStats(t, u.ID)
	approx(t, "moved", after.CarryOverToSavings, 393)
	approx(t, "allowance keeps the cents", after.VariableAllowance, before.VariableAllowance-393)
	approx(t, "pool grows by whole units", after.SavedMoneyBalance, before.SavedMoneyBalance+393)
	approx(t, "nothing more to move", after.CarryOverMovable, 0)
	approx(t, "money conserved", after.VariableAllowance+after.SavedMoneyBalance,
		before.VariableAllowance+before.SavedMoneyBalance)

	if w := callHandlerTZ(u.ID, nil, MoveCarryOverToSavings, "UTC"); w.Code != http.StatusBadRequest {
		t.Errorf("second move: want 400 NOTHING_TO_MOVE, got %d", w.Code)
	}
}

// Never move more carry-over than is still unspent.
func TestMoveCarryOverCappedByUnspent(t *testing.T) {
	u := newTZUser(t, "capcarry")
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 10, time.Minute) // carry 394
	startUTC(t, u.ID, udate(0), udate(30))
	addExpense(t, u.ID, 700.50, udate(0)) // 798 − 700.50 = 97.50 unspent

	s, _ := currentStats(t, u.ID)
	approx(t, "movable capped by unspent", s.CarryOverMovable, 97)
}

// Manual deposits/withdrawals the user types keep their exact cents.
func TestManualSavingsKeepCents(t *testing.T) {
	u := newTZUser(t, "manualcents")
	startUTC(t, u.ID, udate(-2), udate(28))
	before, _ := currentStats(t, u.ID)
	callHandlerTZ(u.ID, map[string]any{"amount": 12.80}, AddSavingsManual, "UTC")
	callHandlerTZ(u.ID, map[string]any{"amount": -0.35}, AddSavingsManual, "UTC")
	after, _ := currentStats(t, u.ID)
	approx(t, "pool", after.SavedMoneyBalance, before.SavedMoneyBalance+12.45)
}

// ── Delete-cycle fallback ─────────────────────────────────────────────────────

func deleteCycle(t *testing.T, uid, id uint) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
	c.Request.Header.Set(userTimezoneHeader, "UTC")
	c.Params = gin.Params{{Key: "id", Value: jsonID(id)}}
	c.Set("userID", uid)
	DeleteSalaryCycle(c)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
}

func latestCycleID(uid uint) uint {
	var cy models.SalaryCycle
	database.DB.Where("user_id = ?", uid).Order("cycle_start_at DESC").First(&cy)
	return cy.ID
}

// Within its dates the predecessor takes over again — and the deleted cycle's
// carry-over moves leave the pool, so no money is counted twice.
func TestDeleteReopensQualifyingPredecessor(t *testing.T) {
	u := newTZUser(t, "reopen")
	startUTC(t, u.ID, udate(-30), udate(0)) // payday today → still within its dates
	spendEarlier(t, u.ID, 10, time.Minute)
	poolBefore, _ := currentStats(t, u.ID)
	startUTC(t, u.ID, udate(0), udate(30))
	callHandlerTZ(u.ID, nil, MoveCarryOverToSavings, "UTC")

	deleteCycle(t, u.ID, latestCycleID(u.ID))
	s, active := currentStats(t, u.ID)
	if !active {
		t.Fatal("qualifying predecessor must be current again")
	}
	approx(t, "pool back to the predecessor's", s.SavedMoneyBalance, poolBefore.SavedMoneyBalance)
	if n := countTx(u.ID, "source = ?", carryOverToSavingsSource); n != 0 {
		t.Errorf("carry-over moves of the deleted cycle must be removed, %d left", n)
	}
}

// Past its dates the predecessor is NOT force-activated: clean no-cycle state,
// and a later new cycle still settles (carries) its unspent budget.
func TestDeleteFallsBackToNoCycleWhenPredecessorExpired(t *testing.T) {
	u := newTZUser(t, "noreopen")
	startUTC(t, u.ID, udate(-30), udate(-2)) // payday two days ago
	spendEarlier(t, u.ID, 10, 3*24*time.Hour)
	startUTC(t, u.ID, udate(0), udate(30))

	deleteCycle(t, u.ID, latestCycleID(u.ID))
	if _, active := currentStats(t, u.ID); active {
		t.Fatal("an expired predecessor must not be resurrected")
	}

	if w := startUTC(t, u.ID, udate(0), udate(30)); w.Code != http.StatusCreated {
		t.Fatalf("restart: %d %s", w.Code, w.Body.String())
	}
	s, _ := currentStats(t, u.ID)
	approx(t, "carry from the predecessor is not lost", s.CarryOver, 394)
}

// ── Lite / no-cycle isolation ─────────────────────────────────────────────────

// Users without a cycle (incl. Lite) run on the monthly budget only: none of
// carry-over, savings rounding or delete-cycle reaches them, and nothing errors.
func TestLiteAndNoCycleUnaffected(t *testing.T) {
	setupFlowDB(t)
	for _, lite := range []bool{true, false} {
		name := "nocycle"
		if lite {
			name = "litecycle"
		}
		u := models.User{Username: name, Password: "x", LiteMode: lite, MonthlySpendingGoal: 500}
		database.DB.Create(&u)
		cat := models.Category{UserID: u.ID, Name: "Food"}
		database.DB.Create(&cat)
		w := callHandlerTZ(u.ID, map[string]any{
			"category_id": cat.ID, "amount": 12.80, "date": udate(0), "type": "expense",
		}, CreateTransaction, "UTC")
		if w.Code != http.StatusCreated {
			t.Fatalf("lite=%v create tx: %d", lite, w.Code)
		}

		bw := computeBudgetWindow(u.ID, u.MonthlySpendingGoal, time.Now().UTC())
		approx(t, "spent_this_window", bw.SpentThisWindow, 12.80) // exact cents, not floored
		approx(t, "remaining", bw.Remaining, 487.20)

		var cur map[string]any
		_ = json.Unmarshal(callHandlerTZ(u.ID, nil, GetCurrentSalaryCycle, "UTC").Body.Bytes(), &cur)
		if cur["cycle"] != nil || cur["has_active_cycle"] != false || cur["payday_status"] != paydayStatusNone {
			t.Errorf("lite=%v: no-cycle state changed: %v", lite, cur)
		}

		if w := callHandlerTZ(u.ID, nil, MoveCarryOverToSavings, "UTC"); w.Code != http.StatusNotFound {
			t.Errorf("lite=%v: carry-over move must 404 without a cycle, got %d", lite, w.Code)
		}
		if n := countTx(u.ID, "type IN ?", []string{"savings_deposit", "savings_withdrawal"}); n != 0 {
			t.Errorf("lite=%v: no savings entries may be created, got %d", lite, n)
		}

		if lite {
			var resp map[string]any
			_ = json.Unmarshal(callHandlerTZ(u.ID, nil, AnalyzeBehavior, "UTC").Body.Bytes(), &resp)
			if resp["financial_health_score"] != nil || resp["predicted_end_of_month_balance"] != nil {
				t.Errorf("Lite must short-circuit analytics (neutral payload), got %v", resp)
			}
		}
	}
}
