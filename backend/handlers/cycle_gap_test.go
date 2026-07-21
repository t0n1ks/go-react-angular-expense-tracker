package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// helper: start a cycle via the handler with explicit dates
func startCycle(t *testing.T, uid uint, receivedAt, nextPayday string) map[string]any {
	t.Helper()
	body := map[string]any{
		"base_salary":      2000.0,
		"bonuses":          0.0,
		"received_at_date": receivedAt,
		"language":         "en",
		"needs_pct":        50.0,
		"wants_pct":        30.0,
		"savings_pct":      20.0,
	}
	if nextPayday != "" {
		body["next_payday_date"] = nextPayday
	}
	w := callHandler(uid, body, StartSalaryCycle)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Fatalf("StartSalaryCycle: got %d — %s", w.Code, w.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

func getCurrent(t *testing.T, uid uint) map[string]any {
	t.Helper()
	InvalidateCycleCache(uid)
	w := callHandler(uid, nil, GetCurrentSalaryCycle)
	if w.Code != http.StatusOK {
		t.Fatalf("GetCurrentSalaryCycle: got %d — %s", w.Code, w.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return out
}

// Scenario A: OLD cycle is properly CLOSED (next_payday in the past), a gap,
// then a NEW cycle created today. Expect has_active_cycle=true and cycle=new.
func TestGap_ClosedOldCycle(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "alice", Password: "x"}
	database.DB.Create(&user)

	// Old cycle: started 90 days ago, ended 60 days ago.
	startCycle(t, user.ID,
		time.Now().AddDate(0, 0, -90).Format("2006-01-02"),
		time.Now().AddDate(0, 0, -60).Format("2006-01-02"))

	// New cycle covering today (started a few days back so the active-cycle
	// lookup is robust to the UTC/local midnight boundary).
	startCycle(t, user.ID,
		time.Now().AddDate(0, 0, -3).Format("2006-01-02"),
		time.Now().AddDate(0, 0, 30).Format("2006-01-02"))

	cur := getCurrent(t, user.ID)
	t.Logf("ClosedOldCycle current: has_active=%v", cur["has_active_cycle"])
	if cur["has_active_cycle"] != true {
		t.Errorf("expected has_active_cycle=true, got %v", cur["has_active_cycle"])
	}
	cycle := cur["cycle"].(map[string]any)
	t.Logf("  cycle id=%v start=%v", cycle["id"], cycle["cycle_start_at"])
}

// Scenario B: OLD cycle is OPEN-ENDED (next_payday nil — user never set one),
// a gap, then a NEW cycle created today.
func TestGap_OpenEndedOldCycle(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "bob", Password: "x"}
	database.DB.Create(&user)

	// Old cycle: started 90 days ago, NO next payday (open-ended).
	firstOut := startCycle(t, user.ID,
		time.Now().AddDate(0, 0, -90).Format("2006-01-02"),
		"")
	firstCycle := firstOut["cycle"].(map[string]any)
	t.Logf("old cycle id=%v next_payday=%v", firstCycle["id"], firstCycle["next_payday_at"])

	// New cycle covering today (started yesterday so it's robust to the
	// UTC/local midnight boundary while still "recent").
	secondOut := startCycle(t, user.ID,
		time.Now().AddDate(0, 0, -1).Format("2006-01-02"),
		time.Now().AddDate(0, 0, 30).Format("2006-01-02"))
	secondCycle := secondOut["cycle"].(map[string]any)
	t.Logf("returned-from-start cycle id=%v start=%v", secondCycle["id"], secondCycle["cycle_start_at"])

	cur := getCurrent(t, user.ID)
	t.Logf("OpenEndedOldCycle current: has_active=%v", cur["has_active_cycle"])
	cycle := cur["cycle"].(map[string]any)
	t.Logf("  current cycle id=%v start=%v next_payday=%v",
		cycle["id"], cycle["cycle_start_at"], cycle["next_payday_at"])

	// The "active" cycle a user just created should start today, not 90 days ago.
	startStr := cycle["cycle_start_at"].(string)
	startT, _ := time.Parse(time.RFC3339, startStr)
	daysAgo := int(time.Since(startT).Hours() / 24)
	if daysAgo > 2 {
		t.Errorf("active cycle starts %d days ago — donut will show ~all-time, not the new cycle", daysAgo)
	}
}
