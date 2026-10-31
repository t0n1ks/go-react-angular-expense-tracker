package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	// A stored health of 60 from five days ago, with an open quest; silent
	// since then.
	asked := now.AddDate(0, 0, -6)
	silent := now.AddDate(0, 0, -5)
	database.DB.Create(&models.CompanionState{
		UserID: u.ID, BaseHealth: 60, BaseDay: localDayKey(now.AddDate(0, 0, -5), k),
		QuestAskedAt: &asked, SilentSince: &silent,
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
	// One normal step from the kept 60 towards today's target, within the
	// +100/7 daily rise: 74.
	if v.Health != 74 {
		t.Fatalf("unsilenced: health should step 60 → 74, got %d", v.Health)
	}
	if !v.Glitch {
		t.Fatal("unsilenced after 5 silent days: the glitch cue should be set")
	}
	var resumed models.CompanionState // fresh: GORM leaves NULLs unset on a reused struct
	database.DB.First(&resumed, "user_id = ?", u.ID)
	if resumed.SilentSince != nil {
		t.Fatal("unsilenced: the silence mark must be cleared")
	}
	if w := callHandlerTZ(u.ID, map[string]any{"kind": "cow"}, CatchCompanionEntity, "UTC"); w.Code != http.StatusOK {
		t.Fatalf("catch: %d", w.Code)
	}
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.LastCatchAt == nil {
		t.Fatal("unsilenced: a catch must be recorded again")
	}
}

// An open quest's penalty does not grow over silent days, even when the
// dashboard was never opened during the silence: no HP is lost for them.
func TestRadioSilenceQuestPenaltyPaused(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "quest", Password: "x", MonthlySpendingGoal: 100}
	database.DB.Create(&u)

	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	k := newCycleClock(now, time.UTC)
	// Asked on Oct 22 (penalty 3 on Oct 23), silent from Oct 23 to today.
	asked := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	silent := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	database.DB.Create(&models.CompanionState{
		UserID: u.ID, BaseHealth: 95, BaseDay: "2026-10-22",
		QuestAskedAt: &asked, SilentSince: &silent,
	})

	v := companionCheck(u, k, "", false)
	// Without the pause the quest would drain to its 15 cap (health ≈ 85).
	// With it the penalty is still 3: one step from 95 up to 97.
	if v.Health != 97 {
		t.Fatalf("health after silence = %d, want 97 (no quest drain for silent days)", v.Health)
	}
	if !v.Glitch || !v.Quest.Open {
		t.Fatalf("glitch=%v open=%v, want both true", v.Glitch, v.Quest.Open)
	}
	var st models.CompanionState
	database.DB.First(&st, "user_id = ?", u.ID)
	if got := st.QuestAskedAt.Format("2006-01-02 15:04"); got != "2026-10-28 10:00" {
		t.Fatalf("quest clock moved to %s, want 2026-10-28 10:00", got)
	}
	if st.BaseHealth != 95 {
		t.Fatalf("stored base %v, want the kept 95", st.BaseHealth)
	}

	// The cue fires once only.
	if v = companionCheck(u, k, "", false); v.Glitch || v.Health != 97 {
		t.Fatalf("second check: glitch=%v health=%d, want false / 97", v.Glitch, v.Health)
	}
}

// Days before the silence that nobody looked at still count as usual; only
// the silent days are skipped. A same-day silence gives no glitch cue.
func TestRadioSilenceCatchesUpBeforeSilence(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "gap", Password: "x", MonthlySpendingGoal: 100}
	database.DB.Create(&u)
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	k := newCycleClock(now, time.UTC)
	silent := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	database.DB.Create(&models.CompanionState{UserID: u.ID, BaseHealth: 50, BaseDay: "2026-10-20", SilentSince: &silent})

	// Oct 21 and 22 roll (+100/7 each), Oct 23–28 are skipped, today steps once.
	if v := companionCheck(u, k, "", false); v.Health != 93 {
		t.Fatalf("health = %d, want 93", v.Health)
	}

	sameDay := now.Add(-2 * time.Hour)
	database.DB.Model(&models.CompanionState{}).Where("user_id = ?", u.ID).Update("silent_since", sameDay)
	if v := companionCheck(u, k, "", false); v.Glitch {
		t.Fatal("a same-day silence must not cue the glitch")
	}
}

// Turning humour off in the profile marks when the silence began (once).
func TestProfileMarksSilence(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "mark", Password: "x"}
	database.DB.Create(&u)
	database.DB.Create(&models.CompanionState{UserID: u.ID, BaseHealth: 80, BaseDay: "2026-10-28"})

	if w := callHandler(u.ID, map[string]any{"ai_humor_enabled": false, "ai_advice_enabled": true}, UpdateProfile); w.Code != http.StatusOK {
		t.Fatalf("profile: %d", w.Code)
	}
	var st models.CompanionState
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.SilentSince == nil {
		t.Fatal("humour off: silent_since should be set")
	}
	first := *st.SilentSince
	callHandler(u.ID, map[string]any{"ai_humor_enabled": false, "ai_advice_enabled": true}, UpdateProfile)
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.SilentSince == nil || !st.SilentSince.Equal(first) {
		t.Fatal("staying silent must keep the original start")
	}
}

// Lite hides tips, so the next-action proxy asks the brain not to serve one
// (the day's tip stays unspent). Extended asks exactly as before.
func TestNextActionSkipsTipOnlyInLite(t *testing.T) {
	setupFlowDB(t)
	var mu sync.Mutex
	var queries []string
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/tamagotchi/next-action" {
			mu.Lock()
			queries = append(queries, r.URL.RawQuery)
			mu.Unlock()
		}
		_, _ = w.Write([]byte(`{"type":"RANDOM_ANIMATION","content":null,"animation_hint":"FLY_BY_MOON"}`))
	}))
	defer brain.Close()
	t.Setenv("AI_SERVICE_URL", brain.URL)

	lite := models.User{Username: "litetip", Password: "x", LiteMode: true}
	ext := models.User{Username: "exttip", Password: "x"}
	database.DB.Create(&lite)
	database.DB.Create(&ext)

	callHandlerGET(lite.ID, "language=en", GetNextAction)
	callHandlerGET(ext.ID, "language=en", GetNextAction)
	if len(queries) != 2 {
		t.Fatalf("brain calls = %d, want 2", len(queries))
	}
	if !strings.Contains(queries[0], "skip_tip=1") {
		t.Errorf("Lite query %q should carry skip_tip=1", queries[0])
	}
	if strings.Contains(queries[1], "skip_tip") {
		t.Errorf("extended query %q must be unchanged (no skip_tip)", queries[1])
	}
}
