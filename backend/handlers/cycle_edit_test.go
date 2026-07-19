package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func dstr(days int) string { return time.Now().AddDate(0, 0, days).Format("2006-01-02") }

func patchPayday(uid uint, date string, preview bool) *httptest.ResponseRecorder {
	body := map[string]any{"next_payday": date}
	if preview {
		body["preview"] = true
	}
	return callHandler(uid, body, UpdateCycleNextPayday)
}

func decode(w *httptest.ResponseRecorder) map[string]any {
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return m
}

func startEditUser(t *testing.T, name string) models.User {
	t.Helper()
	u := models.User{Username: name, Password: "x"}
	database.DB.Create(&u)
	// Start 3 days ago so the active-cycle lookup is robust to the UTC/local
	// midnight boundary; ends 30 days out. Min end = start+7 = today+4.
	startCycle(t, u.ID, dstr(-3), dstr(30))
	return u
}

func TestEditEnd_TooShortRejected(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "short")
	w := patchPayday(u.ID, dstr(3), false) // 3 days < 7
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", w.Code)
	}
	if decode(w)["code"] != "CYCLE_TOO_SHORT" {
		t.Errorf("want CYCLE_TOO_SHORT, got %v", decode(w)["code"])
	}
}

func TestEditEnd_ValidExtendRecomputesAndPreservesTx(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "extend")

	var before int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", u.ID).Count(&before)

	w := patchPayday(u.ID, dstr(45), false)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — %s", w.Code, w.Body.String())
	}
	body := decode(w)
	if body["cycle_stats"] == nil {
		t.Error("expected recomputed cycle_stats in the apply response")
	}
	// The window persisted.
	var cyc models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).Order("cycle_start_at DESC").First(&cyc)
	if cyc.NextPaydayAt == nil || toDateOnly(*cyc.NextPaydayAt).Format("2006-01-02") != dstr(45) {
		t.Errorf("end date not persisted: %v", cyc.NextPaydayAt)
	}
	// No transaction deleted or moved.
	var after int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", u.ID).Count(&after)
	if after != before {
		t.Errorf("transactions changed: before=%d after=%d", before, after)
	}
}

func TestEditEnd_OrphanRejected(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "orphan")

	// An expense recorded 20 days into the cycle.
	cat := models.Category{UserID: u.ID, Name: "Food"}
	database.DB.Create(&cat)
	txTime := time.Now().AddDate(0, 0, 20)
	database.DB.Create(&models.Transaction{
		UserID: u.ID, CategoryID: cat.ID, Amount: 25, Type: "expense",
		Date: txTime, CreatedAt: txTime, UpdatedAt: txTime,
	})

	// Shortening the end to day 10 would orphan that day-20 expense.
	w := patchPayday(u.ID, dstr(10), false)
	if w.Code != http.StatusBadRequest || decode(w)["code"] != "CYCLE_END_BEFORE_LAST_TX" {
		t.Errorf("want 400 CYCLE_END_BEFORE_LAST_TX, got %d %v", w.Code, decode(w)["code"])
	}
}

func TestEditEnd_OverlapNextCycleRejected(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "overlap")

	// A later cycle starting on day 40 (future — doesn't cover today).
	laterStart := time.Now().AddDate(0, 0, 40)
	database.DB.Create(&models.SalaryCycle{
		UserID: u.ID, BaseSalary: 1000, TotalIncome: 1000,
		NeedsPct: 50, WantsPct: 30, SavingsPct: 20,
		CycleStartAt: laterStart, CreatedAt: laterStart, UpdatedAt: laterStart,
	})

	// Moving the active cycle's end to day 50 crosses into the later cycle.
	w := patchPayday(u.ID, dstr(50), false)
	if w.Code != http.StatusBadRequest || decode(w)["code"] != "CYCLE_END_TOO_LATE" {
		t.Errorf("want 400 CYCLE_END_TOO_LATE, got %d %v", w.Code, decode(w)["code"])
	}
}

func TestEditEnd_PreviewDoesNotPersist(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "preview")

	w := patchPayday(u.ID, dstr(60), true) // preview
	if w.Code != http.StatusOK || decode(w)["preview"] != true {
		t.Fatalf("want 200 preview=true, got %d %v", w.Code, decode(w)["preview"])
	}
	if decode(w)["cycle_stats"] == nil {
		t.Error("preview should include projected cycle_stats")
	}
	// DB end date unchanged (still day 30).
	var cyc models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).Order("cycle_start_at DESC").First(&cyc)
	if cyc.NextPaydayAt == nil || toDateOnly(*cyc.NextPaydayAt).Format("2006-01-02") != dstr(30) {
		t.Errorf("preview must NOT persist; end=%v", cyc.NextPaydayAt)
	}
}

func TestEditEnd_IdempotentNoop(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "idem")
	w := patchPayday(u.ID, dstr(30), false) // same as current
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	if msg, _ := decode(w)["message"].(string); msg != "Next payday unchanged" {
		t.Errorf("expected no-op message, got %q", msg)
	}
}

func TestEditEnd_StoppedCycleNotEditable(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "stopped")
	callHandler(u.ID, nil, StopSalaryCycle) // stop → no active cycle

	w := patchPayday(u.ID, dstr(45), false)
	if w.Code != http.StatusNotFound || decode(w)["code"] != "NO_ACTIVE_CYCLE" {
		t.Errorf("want 404 NO_ACTIVE_CYCLE, got %d %v", w.Code, decode(w)["code"])
	}
}

// Money identity holds to the cent in the projected stats (reconcile check).
func TestEditEnd_TotalsReconcileToCent(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "reconcile")
	w := patchPayday(u.ID, dstr(45), true)
	var resp struct {
		CycleStats CycleStats `json:"cycle_stats"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	s := resp.CycleStats
	want := math.Max(0, s.CycleIncome-s.DynamicSavings-s.CycleFixedExpenses)
	if math.Abs(want-s.VariableAllowance) > 0.005 {
		t.Errorf("variable_allowance %.2f != income-savings-fixed %.2f", s.VariableAllowance, want)
	}
}
