package handlers

import (
	"net/http"
	"testing"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func startCycleBody(receivedAt, nextPayday string) map[string]any {
	body := map[string]any{
		"base_salary": 2000.0, "bonuses": 0.0,
		"received_at_date": receivedAt, "language": "en",
		"needs_pct": 50.0, "wants_pct": 30.0, "savings_pct": 20.0,
	}
	if nextPayday != "" {
		body["next_payday_date"] = nextPayday
	}
	return body
}

// §3: a new cycle overlapping an existing (bounded) cycle is rejected; one that
// starts after the existing cycle ends is allowed.
func TestOverlap_CreateRejected(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "overlap")        // A active [today-3, +30]
	callHandler(u.ID, nil, StopSalaryCycle) // stop A — it still occupies its period

	// B overlaps A's window → rejected with a structured code.
	w := callHandler(u.ID, startCycleBody(dstr(0), dstr(40)), StartSalaryCycle)
	if w.Code != http.StatusBadRequest || decode(w)["code"] != "CYCLE_OVERLAP" {
		t.Errorf("overlapping create: want 400 CYCLE_OVERLAP, got %d %v", w.Code, decode(w)["code"])
	}

	// A cycle starting after A ends does NOT overlap → allowed.
	w2 := callHandler(u.ID, startCycleBody(dstr(31), dstr(61)), StartSalaryCycle)
	if w2.Code != http.StatusCreated {
		t.Errorf("non-overlapping create should succeed, got %d %s", w2.Code, w2.Body.String())
	}
}

// §3: stopping a cycle must NOT change its dates (no tail trimming on stop).
func TestOverlap_StopKeepsDates(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "keepdates")

	var before models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).First(&before)

	callHandler(u.ID, nil, StopSalaryCycle)

	var after models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).First(&after)

	if !before.CycleStartAt.Equal(after.CycleStartAt) {
		t.Errorf("cycle_start_at changed on stop: %v -> %v", before.CycleStartAt, after.CycleStartAt)
	}
	switch {
	case (before.NextPaydayAt == nil) != (after.NextPaydayAt == nil):
		t.Errorf("next_payday nullability changed on stop")
	case before.NextPaydayAt != nil && !before.NextPaydayAt.Equal(*after.NextPaydayAt):
		t.Errorf("next_payday_at changed on stop: %v -> %v", *before.NextPaydayAt, *after.NextPaydayAt)
	}
}
