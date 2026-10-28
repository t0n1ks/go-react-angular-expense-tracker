package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// ── Go → Python contextual stream (Phase 3) ───────────────────────────────────
//
// On every transaction mutation we want the Python learner to fold in the
// user's latest spending/savings signal. Pushing synchronously on each write
// would (a) add latency to the user's request and (b) hammer the free-tier AI
// instance during rapid edits. So pushes are:
//
//   - non-blocking: scheduled on a timer, never on the request goroutine, and
//   - debounced/coalesced per user: a burst of N mutations within the debounce
//     window collapses into a single push carrying the final state.

const brainResyncDebounce = 3 * time.Second

var (
	resyncMu     sync.Mutex
	resyncTimers = make(map[uint]*time.Timer)
)

// ScheduleBrainResync coalesces rapid mutations for a user into one debounced,
// non-blocking push to the Python learner. Returns immediately.
func ScheduleBrainResync(uid uint) {
	// Lite mode suppresses all analytics/learning pushes to Python (centralized
	// via userLiteMode). Advisor content is unaffected.
	if userLiteMode(uid) {
		return
	}
	resyncMu.Lock()
	defer resyncMu.Unlock()
	if t, ok := resyncTimers[uid]; ok {
		t.Stop() // reset the window — coalesce this mutation with the pending one
	}
	resyncTimers[uid] = time.AfterFunc(brainResyncDebounce, func() {
		resyncMu.Lock()
		delete(resyncTimers, uid)
		resyncMu.Unlock()
		pushLearnerObservation(uid)
	})
}

type learnObservation struct {
	UserID                int     `json:"user_id"`
	ObservedDailySpend    float64 `json:"observed_daily_spend"`
	ObservedDailySavings  float64 `json:"observed_daily_savings"`
	DaysRemaining         int     `json:"days_remaining"`
	CurrentSavingsBalance float64 `json:"current_savings_balance"`
}

// pushLearnerObservation derives the user's current spending/savings velocity
// from the authoritative cycle stats and streams it to the Python learner.
// Runs off the request path (timer goroutine); failures are logged, not fatal.
func pushLearnerObservation(uid uint) {
	all, err := loadUserCycles(uid)
	if err != nil {
		return
	}
	k := userClock(uid)
	cycle, _ := k.currentOrLatest(all)
	if cycle == nil {
		return // no cycle yet — nothing meaningful to learn
	}

	stats := computeCycleStatsAt(uid, *cycle, all, k)

	daysElapsed := stats.DaysElapsed
	if daysElapsed < 1 {
		daysElapsed = 1
	}
	daysTotal := stats.DaysTotal
	if daysTotal < 1 {
		daysTotal = 1
	}

	obs := learnObservation{
		UserID:                int(uid),
		ObservedDailySpend:    stats.CycleVariableExpenses / float64(daysElapsed),
		ObservedDailySavings:  stats.DynamicSavings / float64(daysTotal),
		DaysRemaining:         stats.DaysRemaining,
		CurrentSavingsBalance: stats.SavedMoneyBalance,
	}

	body, err := json.Marshal(obs)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, getBrainBaseURL()+"/v1/learn", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))

	resp, err := brainClient.Do(req)
	if err != nil {
		log.Printf("[ai] learner push uid=%d skipped (brain unreachable): %v", uid, err)
		return
	}
	defer resp.Body.Close()
	log.Printf("[ai] learner push uid=%d dailySpend=%.2f → status %d", uid, obs.ObservedDailySpend, resp.StatusCode)
}
