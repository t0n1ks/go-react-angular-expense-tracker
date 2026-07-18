package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Soft-stopping an active cycle makes it inactive (user → monthly budget) while
// preserving all rows/history, and a fresh cycle can be started afterwards.
func TestStopCycle_SoftStopPreservesDataAndAllowsRestart(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "jobloss", Password: "x"}
	database.DB.Create(&user)

	// Start a cycle today.
	startCycle(t, user.ID,
		time.Now().Format("2006-01-02"),
		time.Now().AddDate(0, 0, 30).Format("2006-01-02"))

	// Sanity: it's active.
	cur := getCurrent(t, user.ID)
	if cur["has_active_cycle"] != true {
		t.Fatalf("expected active cycle before stop, got %v", cur["has_active_cycle"])
	}

	// Count the auto-provisioned transactions (salary, savings, etc.) so we can
	// prove none are deleted by the stop.
	var txCountBefore int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", user.ID).Count(&txCountBefore)
	if txCountBefore == 0 {
		t.Fatal("expected the started cycle to have created transactions")
	}
	var cycleCountBefore int64
	database.DB.Model(&models.SalaryCycle{}).Where("user_id = ?", user.ID).Count(&cycleCountBefore)

	// ── Stop ──
	w := callHandler(user.ID, nil, StopSalaryCycle)
	if w.Code != http.StatusOK {
		t.Fatalf("stop: got %d — %s", w.Code, w.Body.String())
	}
	var stopResp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &stopResp)
	if stopResp["stopped"] != true {
		t.Errorf("expected stopped=true, got %v", stopResp["stopped"])
	}

	// Now inactive → user falls back to the monthly budget.
	cur2 := getCurrent(t, user.ID)
	if cur2["has_active_cycle"] != false {
		t.Errorf("expected has_active_cycle=false after stop, got %v", cur2["has_active_cycle"])
	}

	// Nothing deleted: transactions and the cycle row are all still there.
	var txCountAfter, cycleCountAfter int64
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", user.ID).Count(&txCountAfter)
	database.DB.Model(&models.SalaryCycle{}).Where("user_id = ?", user.ID).Count(&cycleCountAfter)
	if txCountAfter != txCountBefore {
		t.Errorf("transactions must be preserved: before=%d after=%d", txCountBefore, txCountAfter)
	}
	if cycleCountAfter != cycleCountBefore {
		t.Errorf("cycle row must be preserved: before=%d after=%d", cycleCountBefore, cycleCountAfter)
	}

	// Stopping again is a harmless no-op.
	w2 := callHandler(user.ID, nil, StopSalaryCycle)
	var stopResp2 map[string]any
	_ = json.Unmarshal(w2.Body.Bytes(), &stopResp2)
	if stopResp2["stopped"] != false {
		t.Errorf("second stop should be a no-op (stopped=false), got %v", stopResp2["stopped"])
	}

	// Re-employment: a brand-new cycle can be started and is active again.
	startCycle(t, user.ID,
		time.Now().Format("2006-01-02"),
		time.Now().AddDate(0, 0, 30).Format("2006-01-02"))
	cur3 := getCurrent(t, user.ID)
	if cur3["has_active_cycle"] != true {
		t.Errorf("expected a new active cycle after restart, got %v", cur3["has_active_cycle"])
	}
	// The stopped cycle plus the new one both persist in history.
	var finalCycleCount int64
	database.DB.Model(&models.SalaryCycle{}).Where("user_id = ?", user.ID).Count(&finalCycleCount)
	if finalCycleCount < cycleCountBefore+1 {
		t.Errorf("expected the stopped cycle to remain alongside the new one, count=%d", finalCycleCount)
	}
}
