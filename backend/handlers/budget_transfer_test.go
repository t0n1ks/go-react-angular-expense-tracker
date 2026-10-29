package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── helpers ──────────────────────────────────────────────────────────────────

type liveStats struct {
	SpendableRemaining float64 `json:"spendable_remaining"`
	SavedMoneyBalance  float64 `json:"saved_money_balance"`
	MoneyOnHand        float64 `json:"money_on_hand"`
	CarryOverToSavings float64 `json:"carry_over_to_savings"`
	CarryOverMovable   float64 `json:"carry_over_movable"`
}

func liveNow(t *testing.T, uid uint) liveStats {
	t.Helper()
	InvalidateCycleCache(uid)
	var r struct {
		Stats *liveStats `json:"cycle_stats"`
	}
	_ = json.Unmarshal(callHandlerTZ(uid, nil, GetCurrentSalaryCycle, "UTC").Body.Bytes(), &r)
	if r.Stats == nil {
		t.Fatal("no cycle stats")
	}
	return *r.Stats
}

func moveToSavings(uid, id uint) *httptest.ResponseRecorder {
	return callWithID(uid, id, MoveTransactionToSavings)
}

// originRows returns the live rows sharing tx's origin (entry time,
// description, source): the savings side and the budget side of one deposit.
func originRows(uid uint, tx models.Transaction) []models.Transaction {
	var rows []models.Transaction
	database.DB.Where("user_id = ? AND created_at = ? AND description = ? AND source = ?",
		uid, tx.CreatedAt, tx.Description, tx.Source).Order("type").Find(&rows)
	return rows
}

func amounts(rows []models.Transaction) map[string]float64 {
	m := map[string]float64{}
	for _, r := range rows {
		m[r.Type] += r.Amount
	}
	return m
}

// assertReconciled: real money unchanged, and the chart's two lines end at
// the dashboard's figures.
func assertReconciled(t *testing.T, uid uint, label string, wantMoney float64) liveStats {
	t.Helper()
	s := liveNow(t, uid)
	if d := s.MoneyOnHand - wantMoney; d > 0.001 || d < -0.001 {
		t.Fatalf("%s: money drifted by %.4f", label, d)
	}
	approx(t, label+": money = spendable + savings", s.MoneyOnHand, s.SpendableRemaining+s.SavedMoneyBalance)
	pts := timeline(t, uid)
	last := pts[len(pts)-1]
	approx(t, label+": chart budget line", last.Spendable, s.SpendableRemaining)
	approx(t, label+": chart savings line", last.Savings, s.SavedMoneyBalance)
	return s
}

// A carried-over budget moved to savings (393): the deposit row under test.
func setupCarryMove(t *testing.T, name string) (uint, models.Transaction) {
	t.Helper()
	u := newTZUser(t, name)
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 10.20, time.Minute) // remainder 393.80 carried
	startUTC(t, u.ID, udate(0), udate(30))
	if w := callHandlerTZ(u.ID, nil, MoveCarryOverToSavings, "UTC"); w.Code != http.StatusCreated {
		t.Fatalf("move carry: %d %s", w.Code, w.Body.String())
	}
	var dep models.Transaction
	database.DB.Where("user_id = ? AND source = ?", u.ID, carryOverToSavingsSource).First(&dep)
	return u.ID, dep
}

// ── Full return ↔ move back: the same row changes side ───────────────────────

func TestFullReturnRecategorizesAndReverses(t *testing.T) {
	uid, dep := setupCarryMove(t, "fullreturn")
	before := assertReconciled(t, uid, "start", liveNow(t, uid).MoneyOnHand)
	approx(t, "caption: moved to savings", before.CarryOverToSavings, 393)

	if w := returnToBudget(uid, dep.ID, nil); w.Code != http.StatusOK {
		t.Fatalf("return: %d %s", w.Code, w.Body.String())
	}
	var row models.Transaction
	database.DB.First(&row, dep.ID)
	if row.Type != budgetTransferType || !isVariableBudgetCategory(uid, row.CategoryID) || row.Amount != dep.Amount ||
		!row.CreatedAt.Equal(dep.CreatedAt) || !row.Date.Equal(dep.Date) || row.Description != dep.Description {
		t.Errorf("the same row must become a Переменный бюджет row, unchanged otherwise: %+v", row)
	}
	if rows := originRows(uid, dep); len(rows) != 1 {
		t.Errorf("one row, no mirror: got %d", len(rows))
	}
	after := assertReconciled(t, uid, "after return", before.MoneyOnHand)
	approx(t, "budget +393", after.SpendableRemaining, before.SpendableRemaining+393)
	approx(t, "savings −393", after.SavedMoneyBalance, before.SavedMoneyBalance-393)
	approx(t, "caption: nothing moved any more", after.CarryOverToSavings, 0)
	approx(t, "carry is movable again", after.CarryOverMovable, 393)

	if w := moveToSavings(uid, dep.ID); w.Code != http.StatusOK {
		t.Fatalf("move back: %d %s", w.Code, w.Body.String())
	}
	database.DB.First(&row, dep.ID)
	if row.Type != "savings_deposit" || isVariableBudgetCategory(uid, row.CategoryID) {
		t.Errorf("the row must be a savings deposit again: %+v", row)
	}
	back := assertReconciled(t, uid, "after move back", before.MoneyOnHand)
	approx(t, "caption grows back", back.CarryOverToSavings, 393)
	approx(t, "budget back", back.SpendableRemaining, before.SpendableRemaining)
}

// ── Partial return: split, then merge — never more than two rows ─────────────

func TestPartialReturnSplitsAndMerges(t *testing.T) {
	uid, dep := setupCarryMove(t, "partialreturn")
	money := liveNow(t, uid).MoneyOnHand

	if w := returnToBudget(uid, dep.ID, amt(5)); w.Code != http.StatusOK {
		t.Fatalf("return 5: %d %s", w.Code, w.Body.String())
	}
	rows := originRows(uid, dep)
	got := amounts(rows)
	if len(rows) != 2 || got["savings_deposit"] != 388 || got[budgetTransferType] != 5 {
		t.Fatalf("want 388 in savings + 5 in budget, got %v (%d rows)", got, len(rows))
	}
	for _, r := range rows {
		if !r.CreatedAt.Equal(dep.CreatedAt) || !r.Date.Equal(dep.Date) {
			t.Errorf("the split part must keep the date and entry time: %+v", r)
		}
	}
	s := assertReconciled(t, uid, "after split", money)
	approx(t, "caption shrinks", s.CarryOverToSavings, 388)

	if w := returnToBudget(uid, dep.ID, amt(2.50)); w.Code != http.StatusOK {
		t.Fatalf("return 2.50: %d", w.Code)
	}
	if got := amounts(originRows(uid, dep)); len(originRows(uid, dep)) != 2 || got["savings_deposit"] != 385.5 || got[budgetTransferType] != 7.5 {
		t.Errorf("a second partial return merges into the budget row: %v", got)
	}
	assertReconciled(t, uid, "after second split", money)

	var budgetRow models.Transaction
	database.DB.Where("user_id = ? AND type = ?", uid, budgetTransferType).First(&budgetRow)
	if w := moveToSavings(uid, budgetRow.ID); w.Code != http.StatusOK {
		t.Fatalf("move budget row back: %d %s", w.Code, w.Body.String())
	}
	if got := amounts(originRows(uid, dep)); len(originRows(uid, dep)) != 1 || got["savings_deposit"] != 393 {
		t.Errorf("moving the budget part back merges into one 393 deposit: %v", got)
	}
	assertReconciled(t, uid, "after merge", money)

	if w := returnToBudget(uid, dep.ID, amt(393.01)); w.Code != http.StatusBadRequest {
		t.Errorf("more than the deposit holds must be refused, got %d", w.Code)
	}
}

// Many rounds, odd cents, both directions: no drift and no stray rows.
func TestBackAndForthLeavesNoStrayRows(t *testing.T) {
	uid, dep := setupCarryMove(t, "nostray")
	money := liveNow(t, uid).MoneyOnHand
	for i, a := range []float64{0.01, 7.77, 33.33, 0.99, 12.5, 99.99, 1.01} {
		if w := returnToBudget(uid, dep.ID, amt(a)); w.Code != http.StatusOK {
			t.Fatalf("round %d return %.2f: %d %s", i, a, w.Code, w.Body.String())
		}
		assertReconciled(t, uid, "after return", money)
		var budgetRow models.Transaction
		database.DB.Where("user_id = ? AND type = ?", uid, budgetTransferType).First(&budgetRow)
		if w := moveToSavings(uid, budgetRow.ID); w.Code != http.StatusOK {
			t.Fatalf("round %d move back: %d %s", i, w.Code, w.Body.String())
		}
		assertReconciled(t, uid, "after move back", money)
		if rows := originRows(uid, dep); len(rows) != 1 || rows[0].Amount != 393 {
			t.Fatalf("round %d: want one 393 deposit, got %+v", i, rows)
		}
	}
	if n := countTx(uid, "source = ?", savingsToBudgetSource); n != 0 {
		t.Errorf("no mirror rows may appear, found %d", n)
	}
}

// ── Closed-cycle deposit: a today-dated transfer, no money lost ──────────────

// The loss case from the diagnosis: an allocation made in a CLOSED cycle.
// Changing it in place would hand the old cycle +X that its locked carry-over
// can never pass on — X would vanish. The return must instead be a new
// transfer dated today, leaving the old deposit exactly as it was.
func TestClosedCycleReturnCreatesTodayTransfer(t *testing.T) {
	u := newTZUser(t, "closedreturn")
	startUTC(t, u.ID, udate(-30), udate(0))
	var oldAlloc models.Transaction
	database.DB.Where("user_id = ? AND description = ?", u.ID, savingsAllocationDescription).First(&oldAlloc)
	startUTC(t, u.ID, udate(0), udate(30))
	before := liveNow(t, u.ID)

	w := returnToBudget(u.ID, oldAlloc.ID, amt(40))
	var r struct {
		Mode string `json:"mode"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &r)
	if w.Code != http.StatusOK || r.Mode != "transfer" {
		t.Fatalf("want a transfer, got %d %s", w.Code, w.Body.String())
	}
	var stored models.Transaction
	database.DB.First(&stored, oldAlloc.ID)
	if stored.Type != "savings_deposit" || stored.Amount != oldAlloc.Amount || !stored.UpdatedAt.Equal(oldAlloc.UpdatedAt) {
		t.Errorf("the closed cycle's deposit must not change: %+v", stored)
	}
	var transfer models.Transaction
	database.DB.Where("user_id = ? AND source = ?", u.ID, savingsToBudgetSource).First(&transfer)
	if transfer.Amount != 40 || !transfer.Date.Equal(toDateOnly(time.Now().UTC())) {
		t.Errorf("want a 40 transfer dated today, got %+v", transfer)
	}
	after := assertReconciled(t, u.ID, "closed-cycle return", before.MoneyOnHand)
	approx(t, "budget +40", after.SpendableRemaining, before.SpendableRemaining+40)
	approx(t, "savings −40", after.SavedMoneyBalance, before.SavedMoneyBalance-40)
}

// ── Guards and side effects ──────────────────────────────────────────────────

// A returned allocation is not re-saved by the next income top-up.
func TestReturnedAllocationNotReSavedByTopUp(t *testing.T) {
	u := newTZUser(t, "allocreturn")
	startUTC(t, u.ID, udate(-2), udate(28))
	alloc := latestTx(u.ID, "savings_deposit")
	returnToBudget(u.ID, alloc.ID, nil)
	callHandlerTZ(u.ID, map[string]any{"amount": 100.0}, AddCycleIncome, "UTC")
	// 604 × 20% = 120 planned; 100 already allocated (now in the budget) → +20 only.
	approx(t, "only the new income's share is saved", liveNow(t, u.ID).SavedMoneyBalance, 20)
}

// A budget row's money fields are system-managed, and the system category
// can't hold ordinary entries.
func TestBudgetRowAndSystemCategoryGuarded(t *testing.T) {
	uid, dep := setupCarryMove(t, "guards")
	returnToBudget(uid, dep.ID, nil)
	var row models.Transaction
	database.DB.First(&row, dep.ID)

	put := func(id uint, body map[string]any) int {
		gin.SetMode(gin.TestMode)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		b, _ := json.Marshal(body)
		c.Request = httptest.NewRequest(http.MethodPut, "/", bytes.NewReader(b))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Params = gin.Params{{Key: "id", Value: jsonID(id)}}
		c.Set("userID", uid)
		UpdateTransaction(c)
		return w.Code
	}
	if code := put(row.ID, map[string]any{"amount": 500.0}); code != http.StatusBadRequest {
		t.Errorf("changing a budget row's amount must be refused, got %d", code)
	}
	if code := put(row.ID, map[string]any{"type": "income"}); code != http.StatusBadRequest {
		t.Errorf("turning a budget row into income must be refused, got %d", code)
	}
	if code := put(row.ID, map[string]any{"description": "kept for groceries"}); code != http.StatusOK {
		t.Errorf("its description stays editable, got %d", code)
	}
	w := callHandlerTZ(uid, map[string]any{
		"category_id": row.CategoryID, "amount": 3.0, "date": udate(0), "type": "expense",
	}, CreateTransaction, "UTC")
	if w.Code != http.StatusBadRequest {
		t.Errorf("an ordinary entry in the system category must be refused, got %d", w.Code)
	}
}
