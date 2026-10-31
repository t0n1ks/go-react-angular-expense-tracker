package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Radio silence (humour & interaction OFF): no message, health frozen (kept,
// not reset; silent days skipped), catches ignored. Back ON → normal again.
func TestRadioSilencePausesHealth(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "quiet", Password: "x", MonthlySpendingGoal: 100}
	database.DB.Create(&u)
	database.DB.Model(&u).Update("ai_humor_enabled", false) // bool default:true on create
	database.DB.First(&u, u.ID)
	if u.AIHumorEnabled {
		t.Fatal("setup: humour should be off")
	}

	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	k := newCycleClock(now, time.UTC)
	// A stored health of 60 from five days ago, with an open quest.
	asked := now.AddDate(0, 0, -6)
	database.DB.Create(&models.CompanionState{
		UserID: u.ID, BaseHealth: 60, BaseDay: localDayKey(now.AddDate(0, 0, -5), k),
		QuestAskedAt: &asked,
	})

	v := companionCheck(u, k, "", true)
	if v.Message != nil {
		t.Fatalf("silenced: no message may be delivered, got %+v", v.Message)
	}
	if v.Health != 60 {
		t.Fatalf("silenced: health must stay 60, got %d", v.Health)
	}
	var st models.CompanionState
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.BaseHealth != 60 || st.BaseDay != localDayKey(now.AddDate(0, 0, -1), k) {
		t.Fatalf("silenced: stored health %v / day %s (want 60, yesterday)", st.BaseHealth, st.BaseDay)
	}

	// A catch while silenced has no effect.
	if w := callHandlerTZ(u.ID, map[string]any{"kind": "cow"}, CatchCompanionEntity, "UTC"); w.Code != http.StatusOK {
		t.Fatalf("catch: %d", w.Code)
	}
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.LastCatchAt != nil {
		t.Fatal("silenced: a catch must not be recorded")
	}

	// Back ON: health rolls normally again from the kept value.
	database.DB.Model(&u).Update("ai_humor_enabled", true)
	database.DB.First(&u, u.ID)
	v = companionCheck(u, k, "", false)
	// One normal step from the kept 60 towards today's target (100 − the open
	// quest's 15 = 85), within the +100/7 daily rise: 74.
	if v.Health != 74 {
		t.Fatalf("unsilenced: health should step 60 → 74, got %d", v.Health)
	}
	if w := callHandlerTZ(u.ID, map[string]any{"kind": "cow"}, CatchCompanionEntity, "UTC"); w.Code != http.StatusOK {
		t.Fatalf("catch: %d", w.Code)
	}
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.LastCatchAt == nil {
		t.Fatal("unsilenced: a catch must be recorded again")
	}
}
