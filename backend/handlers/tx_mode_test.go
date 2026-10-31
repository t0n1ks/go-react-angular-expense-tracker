package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func listTxAmounts(t *testing.T, uid uint) []float64 {
	t.Helper()
	var resp struct {
		Transactions []models.Transaction `json:"transactions"`
	}
	w := callHandlerTZ(uid, nil, GetTransactions, "UTC")
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d", w.Code)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	out := make([]float64, 0, len(resp.Transactions))
	for _, tx := range resp.Transactions {
		out = append(out, tx.Amount)
	}
	return out
}

func setLite(t *testing.T, uid uint, on bool) {
	t.Helper()
	body := map[string]any{"currency": "EUR", "monthly_spending_goal": 500, "lite_mode": on}
	if w := callHandler(uid, body, UpdateProfile); w.Code != http.StatusOK {
		t.Fatalf("set lite=%v: %d", on, w.Code)
	}
}

func addModeExpense(t *testing.T, uid, cat uint, amount float64, date string) {
	t.Helper()
	w := callHandlerTZ(uid, map[string]any{
		"category_id": cat, "amount": amount, "date": date, "type": "expense",
	}, CreateTransaction, "UTC")
	if w.Code != http.StatusCreated {
		t.Fatalf("create %.2f: %d", amount, w.Code)
	}
}

func loadModeTestUser(uid uint) models.User {
	var u models.User
	database.DB.First(&u, uid)
	return u
}

// Extended → Lite → extended → Lite again: each mode sees only its own
// entries; Lite lists every Lite entry (all periods) and its budget counts
// the current calendar month; extended figures never move.
func TestLiteSeparation(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "sep", Password: "x", MonthlySpendingGoal: 500}
	database.DB.Create(&u)
	cat := models.Category{UserID: u.ID, Name: "Food"}
	database.DB.Create(&cat)

	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	today := now.Format("2006-01-02")
	firstOfMonth := monthStart.Format("2006-01-02")
	lastMonth := monthStart.AddDate(0, 0, -1).Format("2006-01-02")

	// Extended entries.
	addModeExpense(t, u.ID, cat.ID, 40, today)
	addModeExpense(t, u.ID, cat.ID, 10, firstOfMonth)
	if n := countTx(u.ID, "mode = ?", models.TxModeExtended); n != 2 {
		t.Fatalf("extended rows tagged extended: got %d", n)
	}
	before := computeBudgetWindow(u.ID, 500, now)
	listBefore := listTxAmounts(t, u.ID)

	// Lite on: no Lite entries yet → an empty list.
	setLite(t, u.ID, true)
	lu := loadModeTestUser(u.ID)
	if lu.LitePeriod != 1 || lu.LiteStartedAt == nil {
		t.Fatalf("lite period not opened: %+v", lu)
	}
	if got := listTxAmounts(t, u.ID); len(got) != 0 {
		t.Fatalf("Lite list must hold no extended rows, got %v", got)
	}
	addModeExpense(t, u.ID, cat.ID, 7, today)
	addModeExpense(t, u.ID, cat.ID, 2, firstOfMonth) // this month, before Lite began
	addModeExpense(t, u.ID, cat.ID, 3, lastMonth)    // a past month
	if got := listTxAmounts(t, u.ID); len(got) != 3 {
		t.Fatalf("Lite list shows all its own rows, got %v", got)
	}
	// «Потрачено»: the current calendar month only (past months excluded).
	lite := computeLiteBudgetWindow(lu, now)
	approx(t, "lite spent (current month)", lite.SpentThisWindow, 9)
	approx(t, "lite remaining", lite.Remaining, 491)
	if !lite.WindowStart.Equal(monthStart) {
		t.Fatalf("lite window starts %v, want %v", lite.WindowStart, monthStart)
	}

	// Extended figures are untouched while Lite has entries.
	if got := computeBudgetWindow(u.ID, 500, now); got != before {
		t.Fatalf("extended budget moved:\n got  %+v\n want %+v", got, before)
	}

	// Lite off: Lite rows hidden, extended rows (incl. pre-Lite) all back.
	setLite(t, u.ID, false)
	if got := listTxAmounts(t, u.ID); len(got) != len(listBefore) {
		t.Fatalf("extended list: got %v, want %v", got, listBefore)
	}
	if got := computeBudgetWindow(u.ID, 500, now); got != before {
		t.Fatalf("extended budget changed after Lite:\n got  %+v\n want %+v", got, before)
	}
	addModeExpense(t, u.ID, cat.ID, 5, today)
	if n := countTx(u.ID, "mode = ?", models.TxModeExtended); n != 3 {
		t.Fatalf("new extended entry tagged extended: got %d", n)
	}

	// Lite again: every earlier Lite entry is still listed; the figure is
	// still this month's Lite spend.
	setLite(t, u.ID, true)
	lu = loadModeTestUser(u.ID)
	if lu.LitePeriod != 2 {
		t.Fatalf("second Lite period: got %d", lu.LitePeriod)
	}
	if got := listTxAmounts(t, u.ID); len(got) != 3 {
		t.Fatalf("Lite entries must survive Lite off/on, got %v", got)
	}
	approx(t, "lite spent after off/on", computeLiteBudgetWindow(lu, now).SpentThisWindow, 9)
}
