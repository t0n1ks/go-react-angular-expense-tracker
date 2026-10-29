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

type moneyStats struct {
	CycleIncome        float64 `json:"cycle_income"`
	VariableAllowance  float64 `json:"variable_allowance"`
	SpendableRemaining float64 `json:"spendable_remaining"`
	SavedMoneyBalance  float64 `json:"saved_money_balance"`
	MoneyOnHand        float64 `json:"money_on_hand"`
}

func moneyNow(t *testing.T, uid uint) moneyStats {
	t.Helper()
	InvalidateCycleCache(uid)
	var r struct {
		Stats *moneyStats `json:"cycle_stats"`
	}
	_ = json.Unmarshal(callHandlerTZ(uid, nil, GetCurrentSalaryCycle, "UTC").Body.Bytes(), &r)
	if r.Stats == nil {
		t.Fatal("no cycle stats")
	}
	return *r.Stats
}

func timeline(t *testing.T, uid uint) []timelinePoint {
	t.Helper()
	var r struct {
		Points []timelinePoint `json:"points"`
	}
	if err := json.Unmarshal(callHandlerTZ(uid, nil, GetBalanceTimeline, "UTC").Body.Bytes(), &r); err != nil {
		t.Fatalf("decode timeline: %v", err)
	}
	return r.Points
}

func deposit(uid uint, amount float64) *httptest.ResponseRecorder {
	return callHandlerTZ(uid, map[string]any{"amount": amount}, AddSavingsManual, "UTC")
}

func latestTx(uid uint, typ string) models.Transaction {
	var tx models.Transaction
	database.DB.Where("user_id = ? AND type = ?", uid, typ).Order("id DESC").First(&tx)
	return tx
}

func callWithID(uid, id uint, h gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Request.Header.Set(userTimezoneHeader, "UTC")
	c.Params = gin.Params{{Key: "id", Value: jsonID(id)}}
	c.Set("userID", uid)
	h(c)
	return w
}

// ── Part A: every deposit leaves the budget ──────────────────────────────────

// A typed deposit reduces the spendable budget by exactly its amount (cents
// kept) and the pool grows by the same amount: total money unchanged.
func TestManualDepositReducesSpendable(t *testing.T) {
	u := newTZUser(t, "depositspend")
	startUTC(t, u.ID, udate(-2), udate(28)) // 504: 100 to savings, 404 spendable
	before := moneyNow(t, u.ID)
	approx(t, "allowance", before.VariableAllowance, 404)

	if w := deposit(u.ID, 12.80); w.Code != http.StatusCreated {
		t.Fatalf("deposit: %d %s", w.Code, w.Body.String())
	}
	after := moneyNow(t, u.ID)
	approx(t, "spendable drops by the exact amount", after.SpendableRemaining, before.SpendableRemaining-12.80)
	approx(t, "pool grows by the exact amount", after.SavedMoneyBalance, before.SavedMoneyBalance+12.80)
	approx(t, "money conserved", after.MoneyOnHand, before.MoneyOnHand)
}

// A deposit larger than what is left is rejected with the most that fits; the
// typed amount is never trimmed and nothing is stored.
func TestOversizedDepositRejected(t *testing.T) {
	u := newTZUser(t, "depositguard")
	startUTC(t, u.ID, udate(-2), udate(28))
	addExpense(t, u.ID, 392.16, udate(0)) // 404 − 392.16 = 11.84 left

	w := deposit(u.ID, 11.85)
	var r struct {
		Code      string  `json:"code"`
		Available float64 `json:"available"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &r)
	if w.Code != http.StatusBadRequest || r.Code != errDepositExceedsSpendable {
		t.Fatalf("want 400 %s, got %d %s", errDepositExceedsSpendable, w.Code, w.Body.String())
	}
	approx(t, "available", r.Available, 11.84)
	if n := countTx(u.ID, "description = ?", "Manual savings transfer"); n != 0 {
		t.Errorf("a rejected deposit must not be stored, found %d", n)
	}
	if w := deposit(u.ID, 11.84); w.Code != http.StatusCreated {
		t.Errorf("exactly what is left must pass: %d %s", w.Code, w.Body.String())
	}
	approx(t, "spendable", moneyNow(t, u.ID).SpendableRemaining, 0)
}

// Deposits made before this rule, in the open cycle, now count against its
// budget too — without the stored record being touched.
func TestExistingDepositCountsWithoutAlteringIt(t *testing.T) {
	u := newTZUser(t, "olddeposit")
	startUTC(t, u.ID, udate(-2), udate(28))
	before := moneyNow(t, u.ID)
	var cy models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).First(&cy)
	now := time.Now()
	old := models.Transaction{
		UserID: u.ID, CategoryID: cy.SavedMoneyCategoryID, Amount: 50.25,
		Description: "Manual savings transfer", Date: toDateOnly(now), Type: "savings_deposit",
		IncomeType: "one_time", CreatedAt: now, UpdatedAt: now,
	}
	database.DB.Create(&old)

	after := moneyNow(t, u.ID)
	approx(t, "spendable", after.SpendableRemaining, before.SpendableRemaining-50.25)
	var stored models.Transaction
	database.DB.First(&stored, old.ID)
	if stored.Amount != 50.25 || stored.Type != "savings_deposit" || !stored.UpdatedAt.Equal(old.UpdatedAt) {
		t.Errorf("the stored deposit must stay as it was: %+v", stored)
	}
}

// Re-filing an expense as a deposit: the spendable remainder is unchanged (it
// stops counting as spent, counts as moved instead), the pool and the real
// money grow by exactly that amount, cents kept.
func TestMoveExpenseToSavings(t *testing.T) {
	u := newTZUser(t, "expensetosavings")
	startUTC(t, u.ID, udate(-2), udate(28))
	addExpense(t, u.ID, 25.50, udate(0))
	before := moneyNow(t, u.ID)
	exp := latestTx(u.ID, "expense")

	if w := callWithID(u.ID, exp.ID, MoveTransactionToSavings); w.Code != http.StatusOK {
		t.Fatalf("move: %d %s", w.Code, w.Body.String())
	}
	after := moneyNow(t, u.ID)
	approx(t, "spendable unchanged", after.SpendableRemaining, before.SpendableRemaining)
	approx(t, "pool +25.50", after.SavedMoneyBalance, before.SavedMoneyBalance+25.50)
	approx(t, "money on hand +25.50", after.MoneyOnHand, before.MoneyOnHand+25.50)

	var moved models.Transaction
	database.DB.First(&moved, exp.ID)
	if moved.Type != "savings_deposit" || moved.Source != expenseToSavingsSource || moved.Amount != 25.50 ||
		!moved.CreatedAt.Equal(exp.CreatedAt) {
		t.Errorf("re-filed entry: %+v", moved)
	}
	if w := callWithID(u.ID, latestTx(u.ID, "income").ID, MoveTransactionToSavings); w.Code != http.StatusBadRequest {
		t.Errorf("an income cannot be re-filed: got %d", w.Code)
	}
}

// Raising a deposit by editing it obeys the same guard.
func TestEditedDepositGuarded(t *testing.T) {
	u := newTZUser(t, "editdeposit")
	startUTC(t, u.ID, udate(-2), udate(28))
	addExpense(t, u.ID, 394, udate(0)) // 10 left
	deposit(u.ID, 5)                   // 5 left
	dep := latestTx(u.ID, "savings_deposit")

	put := func(amount float64) int {
		gin.SetMode(gin.TestMode)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		body, _ := json.Marshal(map[string]any{"amount": amount})
		c.Request = httptest.NewRequest(http.MethodPut, "/", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Request.Header.Set(userTimezoneHeader, "UTC")
		c.Params = gin.Params{{Key: "id", Value: jsonID(dep.ID)}}
		c.Set("userID", u.ID)
		UpdateTransaction(c)
		return w.Code
	}
	if code := put(10.01); code != http.StatusBadRequest {
		t.Errorf("raising beyond what is left: want 400, got %d", code)
	}
	if code := put(10); code != http.StatusOK {
		t.Errorf("raising to exactly what is left: want 200, got %d", code)
	}
}

// ── Conservation on salary changes (bug C) ───────────────────────────────────

// More income: its % allocation reaches the pool as a real whole-unit deposit
// (cents stay spendable) and total money rises by exactly the income.
// Deleting that income takes away exactly the income — nothing more, nothing
// less; the allocation already in savings stays there.
func TestIncomeChangesConserveMoney(t *testing.T) {
	u := newTZUser(t, "incomeconserve")
	startUTC(t, u.ID, udate(-2), udate(28))
	before := moneyNow(t, u.ID)

	w := callHandlerTZ(u.ID, map[string]any{"amount": 100.50}, AddCycleIncome, "UTC")
	if w.Code != http.StatusCreated {
		t.Fatalf("add income: %d %s", w.Code, w.Body.String())
	}
	added := moneyNow(t, u.ID)
	approx(t, "pool: 604.50 × 20% = 120.90 → 120 allocated", added.SavedMoneyBalance, 120)
	approx(t, "allowance keeps the cents", added.VariableAllowance, 604.50-120)
	approx(t, "money on hand rises by the income", added.MoneyOnHand, before.MoneyOnHand+100.50)
	if n := countTx(u.ID, "source = ?", savingsAllocationSource); n != 1 {
		t.Errorf("want one allocation top-up, got %d", n)
	}

	inc := latestTx(u.ID, "income")
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
	c.Params = gin.Params{{Key: "id", Value: jsonID(inc.ID)}}
	c.Set("userID", u.ID)
	DeleteTransaction(c)
	removed := moneyNow(t, u.ID)
	approx(t, "money on hand falls by the income", removed.MoneyOnHand, added.MoneyOnHand-100.50)
	approx(t, "allocation stays in savings", removed.SavedMoneyBalance, 120)
}

// ── Part B: one real-money figure everywhere ─────────────────────────────────

// Spending from savings lowers the pool, the real money and the chart's latest
// point together; the chart ends exactly at the dashboard figure and starts at
// the first cycle (earlier cash flow is not real money on hand).
func TestTimelineEndsAtMoneyOnHand(t *testing.T) {
	u := newTZUser(t, "timeline")
	var cat models.Category
	database.DB.Create(&models.Category{UserID: u.ID, Name: "Misc"})
	database.DB.Where("user_id = ?", u.ID).First(&cat)
	pre := callHandlerTZ(u.ID, map[string]any{
		"category_id": cat.ID, "amount": 600.0, "date": udate(-40), "type": "income",
	}, CreateTransaction, "UTC")
	if pre.Code != http.StatusCreated {
		t.Fatalf("pre-cycle income: %d", pre.Code)
	}

	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 10, 5*24*time.Hour)
	startUTC(t, u.ID, udate(0), udate(30)) // carries 394
	addExpense(t, u.ID, 392.16, udate(0))

	s := moneyNow(t, u.ID)
	pts := timeline(t, u.ID)
	if len(pts) == 0 {
		t.Fatal("empty timeline")
	}
	if pts[0].Date != udate(-30) {
		t.Errorf("chart must start at the first cycle: %s, want %s", pts[0].Date, udate(-30))
	}
	last := pts[len(pts)-1]
	approx(t, "budget line ends at the live spendable", last.Spendable, s.SpendableRemaining)
	approx(t, "savings line ends at the live pool", last.Savings, s.SavedMoneyBalance)
	if d := last.Total - s.MoneyOnHand; d > 0.0101 || d < -0.0101 {
		t.Errorf("total line ends at %.2f, money on hand is %.2f", last.Total, s.MoneyOnHand)
	}
	// "Общий" is the real-money sum of the two views at EVERY point — never an
	// all-time income − expenses sum (the pre-cycle 600 income must not count).
	for _, p := range pts {
		if p.Total != round2(p.Spendable+p.Savings) {
			t.Errorf("%s: total %.2f ≠ budget %.2f + savings %.2f", p.Date, p.Total, p.Spendable, p.Savings)
		}
	}
	var naive float64
	var all []models.Transaction
	database.DB.Where("user_id = ?", u.ID).Find(&all)
	for _, tx := range all {
		switch tx.Type {
		case "income":
			naive += tx.Amount
		case "expense":
			naive -= tx.Amount
		}
	}
	if d := last.Total - naive; d < 1 && d > -1 {
		t.Errorf("total %.2f must not be the all-time income − expenses sum %.2f", last.Total, naive)
	}
	approx(t, "money on hand = remainder + pool", s.MoneyOnHand, s.SpendableRemaining+s.SavedMoneyBalance)

	callHandlerTZ(u.ID, map[string]any{"amount": -30.0}, AddSavingsManual, "UTC")
	s2 := moneyNow(t, u.ID)
	approx(t, "pool −30", s2.SavedMoneyBalance, s.SavedMoneyBalance-30)
	approx(t, "money on hand −30", s2.MoneyOnHand, s.MoneyOnHand-30)
	pts = timeline(t, u.ID)
	approx(t, "savings line −30", pts[len(pts)-1].Savings, last.Savings-30)
	approx(t, "budget line untouched by spending from savings", pts[len(pts)-1].Spendable, last.Spendable)

	deposit(u.ID, 1.50)
	pts = timeline(t, u.ID)
	approx(t, "deposit: budget line −1.50", pts[len(pts)-1].Spendable, last.Spendable-1.50)
	approx(t, "deposit: savings line +1.50", pts[len(pts)-1].Savings, last.Savings-30+1.50)
	if pts[0].Spendable != 404 || pts[0].Savings != 100 {
		t.Errorf("first day: want 404 spendable / 100 saved, got %+v", pts[0])
	}
}

// The handover moves the remainder into the new cycle's carry-over, so the
// real money does not jump at the boundary (no drift).
func TestTimelineContinuousAcrossHandover(t *testing.T) {
	utc := time.UTC
	start := time.Date(2026, 9, 28, 9, 0, 0, 0, utc)
	handover := time.Date(2026, 10, 28, 9, 0, 0, 0, utc)
	prev := models.SalaryCycle{ID: 1, CycleStartAt: start, EndedAt: &handover, SavedMoneyCategoryID: 9}
	next := models.SalaryCycle{ID: 2, CycleStartAt: handover, CarryOver: 394, SavedMoneyCategoryID: 9}
	all := []models.SalaryCycle{prev, next}
	tx := func(id uint, typ string, amt float64, cat uint, at time.Time) windowTx {
		return windowTx{Transaction: models.Transaction{ID: id, Type: typ, Amount: amt, CategoryID: cat}, At: at}
	}
	txs := []windowTx{
		tx(1, "income", 504, 1, start),
		tx(2, "savings_deposit", 100, 9, start),
		tx(3, "expense", 10, 2, start.Add(48*time.Hour)),
		tx(4, "income", 504, 1, handover),
		tx(5, "savings_deposit", 100, 9, handover),
	}
	justBefore := handover
	v1, _ := moneyOnHandAt(all, txs, 9, &justBefore)
	approx(t, "before handover: 394 left", v1.Spendable, 394)
	approx(t, "before handover: 100 saved", v1.Savings, 100)
	justAfter := handover.Add(time.Second)
	v2, _ := moneyOnHandAt(all, txs, 9, &justAfter)
	approx(t, "after: 404 + 394 carried (saw-tooth up on payday)", v2.Spendable, 798)
	approx(t, "after: 200 saved", v2.Savings, 200)
	approx(t, "only the new salary is added in total", v2.Spendable+v2.Savings, v1.Spendable+v1.Savings+504)
	if _, ok := moneyOnHandAt(all, txs, 9, &start); ok {
		t.Error("no point before the first cycle")
	}
}

// Users who never had a cycle get no server series (their cash-flow chart is
// unchanged).
func TestTimelineEmptyWithoutCycles(t *testing.T) {
	u := newTZUser(t, "notimeline")
	if pts := timeline(t, u.ID); len(pts) != 0 {
		t.Errorf("want no points, got %d", len(pts))
	}
	if w := deposit(u.ID, 5); w.Code != http.StatusNotFound {
		t.Errorf("deposit without a cycle: want 404, got %d", w.Code)
	}
}

// ── Savings → budget (reversible moves) ──────────────────────────────────────

func returnToBudget(uid, depositID uint, amount *float64) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	var body []byte
	if amount != nil {
		body, _ = json.Marshal(map[string]any{"amount": *amount})
	}
	c.Request = httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set(userTimezoneHeader, "UTC")
	c.Params = gin.Params{{Key: "id", Value: jsonID(depositID)}}
	c.Set("userID", uid)
	ReturnSavingsToBudget(c)
	return w
}

func amt(v float64) *float64 { return &v }

// Moving a deposit back raises the budget and lowers the pool by exactly the
// same amount (cents kept); the same row becomes a "Переменный бюджет" row —
// no extra mirror row.
func TestReturnSavingsToBudget(t *testing.T) {
	u := newTZUser(t, "returnbudget")
	startUTC(t, u.ID, udate(-2), udate(28))
	deposit(u.ID, 12.34)
	dep := latestTx(u.ID, "savings_deposit")
	before := moneyNow(t, u.ID)

	if w := returnToBudget(u.ID, dep.ID, nil); w.Code != http.StatusOK {
		t.Fatalf("return: %d %s", w.Code, w.Body.String())
	}
	after := moneyNow(t, u.ID)
	approx(t, "spendable +12.34", after.SpendableRemaining, before.SpendableRemaining+12.34)
	approx(t, "pool −12.34", after.SavedMoneyBalance, before.SavedMoneyBalance-12.34)
	approx(t, "money on hand unchanged", after.MoneyOnHand, before.MoneyOnHand)

	var stored models.Transaction
	database.DB.First(&stored, dep.ID)
	if stored.Type != budgetTransferType || stored.Amount != 12.34 || !isVariableBudgetCategory(u.ID, stored.CategoryID) {
		t.Errorf("the same row must become a 12.34 Переменный бюджет row: %+v", stored)
	}
	if n := countTx(u.ID, "source = ?", savingsToBudgetSource); n != 0 {
		t.Errorf("no mirror row may be created, found %d", n)
	}
	pts := timeline(t, u.ID)
	last := pts[len(pts)-1]
	approx(t, "budget line", last.Spendable, after.SpendableRemaining)
	approx(t, "savings line", last.Savings, after.SavedMoneyBalance)
}

// Back and forth, many times, odd cents, every path: total real money never
// moves by a single cent and every view agrees after each step.
func TestBudgetSavingsMovesConserveMoney(t *testing.T) {
	u := newTZUser(t, "backandforth")
	startUTC(t, u.ID, udate(-2), udate(28)) // 404 spendable, 100 saved
	start := moneyNow(t, u.ID)
	alloc := latestTx(u.ID, "savings_deposit")

	amounts := []float64{0.05, 7.77, 33.33, 0.99, 12.5, 99.99, 1.01, 50}
	for i, a := range amounts {
		if w := deposit(u.ID, a); w.Code != http.StatusCreated {
			t.Fatalf("step %d deposit %.2f: %d %s", i, a, w.Code, w.Body.String())
		}
		back := a / 3 // a different amount back
		if w := returnToBudget(u.ID, latestTx(u.ID, "savings_deposit").ID, amt(back)); w.Code != http.StatusOK {
			t.Fatalf("step %d return: %d %s", i, w.Code, w.Body.String())
		}
		if w := returnToBudget(u.ID, alloc.ID, amt(0.07)); w.Code != http.StatusOK {
			t.Fatalf("step %d return from allocation: %d", i, w.Code)
		}
		s := moneyNow(t, u.ID)
		if diff := s.MoneyOnHand - start.MoneyOnHand; diff > 0.001 || diff < -0.001 {
			t.Fatalf("step %d: money drifted by %.4f", i, diff)
		}
		pts := timeline(t, u.ID)
		last := pts[len(pts)-1]
		approx(t, "chart budget line = card", last.Spendable, s.SpendableRemaining)
		approx(t, "chart savings line = card", last.Savings, s.SavedMoneyBalance)
	}
}

// Returning more than the pool holds is rejected with what is available; no
// entry is stored. Without a current cycle there is no budget to return into.
func TestReturnToBudgetGuards(t *testing.T) {
	u := newTZUser(t, "returnguard")
	startUTC(t, u.ID, udate(-2), udate(28)) // pool 100
	alloc := latestTx(u.ID, "savings_deposit")

	w := returnToBudget(u.ID, alloc.ID, amt(100.01))
	var r struct {
		Code      string  `json:"code"`
		Available float64 `json:"available"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &r)
	if w.Code != http.StatusBadRequest || r.Code != errSavingsInsufficient {
		t.Fatalf("want 400 %s, got %d %s", errSavingsInsufficient, w.Code, w.Body.String())
	}
	approx(t, "available", r.Available, 100)
	if n := countTx(u.ID, "source = ?", savingsToBudgetSource); n != 0 {
		t.Errorf("a rejected return must not be stored, found %d", n)
	}
	if w := returnToBudget(u.ID, latestTx(u.ID, "income").ID, nil); w.Code != http.StatusBadRequest {
		t.Errorf("only deposits can be returned: got %d", w.Code)
	}

	database.DB.Model(&models.SalaryCycle{}).Where("user_id = ?", u.ID).Update("stopped_at", time.Now())
	InvalidateCycleCache(u.ID)
	if w := returnToBudget(u.ID, alloc.ID, amt(5)); w.Code != http.StatusNotFound {
		t.Errorf("no current cycle: want 404, got %d", w.Code)
	}
}

// Every deposit kind can go back to the budget: here the carry-over move
// (and then the allocation), each exact and net-zero.
func TestReturnFromCarryOverAndAllocationDeposits(t *testing.T) {
	u := newTZUser(t, "returnkinds")
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 10.20, time.Minute) // remainder 393.80 → carried
	startUTC(t, u.ID, udate(0), udate(30))
	if w := callHandlerTZ(u.ID, nil, MoveCarryOverToSavings, "UTC"); w.Code != http.StatusCreated {
		t.Fatalf("move carry: %d", w.Code)
	}
	var carryMove models.Transaction
	database.DB.Where("user_id = ? AND source = ?", u.ID, carryOverToSavingsSource).First(&carryMove)
	var alloc models.Transaction
	database.DB.Where("user_id = ? AND description = ?", u.ID, savingsAllocationDescription).Order("id DESC").First(&alloc)
	before := moneyNow(t, u.ID)

	if w := returnToBudget(u.ID, carryMove.ID, amt(11)); w.Code != http.StatusOK {
		t.Fatalf("return from carry move: %d %s", w.Code, w.Body.String())
	}
	if w := returnToBudget(u.ID, alloc.ID, nil); w.Code != http.StatusOK {
		t.Fatalf("return from allocation: %d %s", w.Code, w.Body.String())
	}
	after := moneyNow(t, u.ID)
	approx(t, "spendable +11 +100", after.SpendableRemaining, before.SpendableRemaining+111)
	approx(t, "savings −111", after.SavedMoneyBalance, before.SavedMoneyBalance-111)
	approx(t, "money on hand unchanged", after.MoneyOnHand, before.MoneyOnHand)
}
