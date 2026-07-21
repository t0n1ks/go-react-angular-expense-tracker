package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Stop then resume restores the active cycle with all data intact, and a repeat
// resume is a harmless no-op.
func TestResume_RestoresActiveAndPreservesData(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "resume") // active cycle: start-3, end+30

	var txBefore int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", u.ID).Count(&txBefore)

	// Stop → no active cycle, but it stays resumable (today still in its window).
	callHandler(u.ID, nil, StopSalaryCycle)
	cur := getCurrent(t, u.ID)
	if cur["has_active_cycle"] != false {
		t.Fatalf("after stop: expected has_active_cycle=false, got %v", cur["has_active_cycle"])
	}
	if cur["resumable_cycle"] == nil {
		t.Fatal("after stop: expected resumable_cycle to be present")
	}

	// Resume.
	w := callHandler(u.ID, nil, ResumeSalaryCycle)
	if w.Code != http.StatusOK || decode(w)["resumed"] != true {
		t.Fatalf("resume: want 200 resumed=true, got %d %v", w.Code, decode(w)["resumed"])
	}
	cur2 := getCurrent(t, u.ID)
	if cur2["has_active_cycle"] != true {
		t.Errorf("after resume: expected active cycle, got %v", cur2["has_active_cycle"])
	}

	// Nothing recreated or moved.
	var txAfter int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", u.ID).Count(&txAfter)
	if txAfter != txBefore {
		t.Errorf("transactions changed across stop/resume: before=%d after=%d", txBefore, txAfter)
	}

	// Idempotent: a second resume is a no-op (already active).
	w2 := callHandler(u.ID, nil, ResumeSalaryCycle)
	if w2.Code != http.StatusOK {
		t.Errorf("second resume should be a no-op 200, got %d", w2.Code)
	}
}

// A stopped cycle whose window is entirely in the past cannot be resumed.
func TestResume_BlockedOutsideWindow(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "past", Password: "x"}
	database.DB.Create(&u)

	start := time.Now().AddDate(0, 0, -60)
	end := time.Now().AddDate(0, 0, -30)
	stopped := time.Now().AddDate(0, 0, -31)
	database.DB.Create(&models.SalaryCycle{
		UserID: u.ID, BaseSalary: 1000, TotalIncome: 1000,
		NeedsPct: 50, WantsPct: 30, SavingsPct: 20,
		CycleStartAt: start, NextPaydayAt: &end, StoppedAt: &stopped,
		CreatedAt: start, UpdatedAt: start,
	})

	// Not resumable → no active cycle, resumed=false.
	w := callHandler(u.ID, nil, ResumeSalaryCycle)
	if w.Code != http.StatusOK || decode(w)["resumed"] != false {
		t.Errorf("want 200 resumed=false for a past window, got %d %v", w.Code, decode(w)["resumed"])
	}
	cur := getCurrent(t, u.ID)
	if cur["resumable_cycle"] != nil {
		t.Errorf("a past cycle must not be resumable, got %v", cur["resumable_cycle"])
	}
}

// Resume is blocked (409) when another cycle is currently active.
func TestResume_BlockedWhenAnotherActive(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "twoactive") // cycle A active: start-3, end+30

	callHandler(u.ID, nil, StopSalaryCycle) // stop A (still resumable)
	// Start cycle B (active, covers today). A stays stopped-but-resumable.
	startCycle(t, u.ID, dstr(-1), dstr(30))

	w := callHandler(u.ID, nil, ResumeSalaryCycle)
	if w.Code != http.StatusConflict || decode(w)["code"] != "ANOTHER_CYCLE_ACTIVE" {
		t.Errorf("want 409 ANOTHER_CYCLE_ACTIVE, got %d %v", w.Code, decode(w)["code"])
	}
}
