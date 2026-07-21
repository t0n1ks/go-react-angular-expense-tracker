package handlers

import (
	"testing"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// §1: stopping a cycle must not change its income; resuming restores it exactly.
// (Data integrity: the cycle's income is computed over its own window and stop
// only flips a flag — this locks that the backend figure never drifts.)
func TestHotfix_IncomeStableAcrossStopResume(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "income") // active cycle

	before := getCurrent(t, u.ID)
	beforeStats, _ := before["cycle_stats"].(map[string]any)
	if beforeStats == nil {
		t.Fatal("expected cycle_stats before stop")
	}
	incBefore := beforeStats["cycle_income"]

	callHandler(u.ID, nil, StopSalaryCycle)
	// While stopped, recompute the cycle's own income directly — must be unchanged.
	var cyc models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).Order("cycle_start_at DESC").First(&cyc)
	if s := computeCycleStats(u.ID, cyc); s.CycleIncome != incBefore {
		t.Errorf("stopped cycle income changed: before=%v stopped=%v", incBefore, s.CycleIncome)
	}

	callHandler(u.ID, nil, ResumeSalaryCycle)
	after := getCurrent(t, u.ID)
	afterStats, _ := after["cycle_stats"].(map[string]any)
	if afterStats == nil || afterStats["cycle_income"] != incBefore {
		t.Errorf("income after resume != before: before=%v after=%v", incBefore, afterStats)
	}
}
