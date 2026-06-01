package handlers

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ── Per-user salary-cycle stats cache (Phase 4: cost / resource guardrail) ────
//
// computeCycleStats runs several aggregate queries against the database on
// every /salary-cycle/current read. On a free-tier Supabase/Postgres instance
// that is the dominant per-request cost, and the dashboard re-reads it often
// (mount, refreshes, multiple open tabs).
//
// This cache serves a user's last-computed cycle payload until either:
//   - a write mutation invalidates it (Create/Update/Delete of a transaction,
//     savings/income entry, or any salary-cycle change), or
//   - a short TTL expires (so day-rollover and any missed invalidation still
//     self-heal without a mutation).
//
// It is intentionally tiny and dependency-free: a write only happens on cache
// miss or mutation, never on every read, so heavy recomputation/DB load is
// confined to actual state changes.

type cycleCacheEntry struct {
	payload   gin.H
	expiresAt time.Time
}

var (
	cycleCacheMu sync.RWMutex
	cycleCache   = make(map[uint]cycleCacheEntry)
)

// cycleCacheTTL bounds staleness of time-derived fields (days_elapsed,
// days_remaining) so a cached payload can never drift more than this far behind
// real time even if an invalidation is somehow missed.
const cycleCacheTTL = 60 * time.Second

// getCachedCycle returns a user's cached cycle payload when present and fresh.
func getCachedCycle(uid uint) (gin.H, bool) {
	cycleCacheMu.RLock()
	e, ok := cycleCache[uid]
	cycleCacheMu.RUnlock()
	if !ok || time.Now().After(e.expiresAt) {
		return nil, false
	}
	return e.payload, true
}

// setCachedCycle stores a freshly computed cycle payload for a user.
func setCachedCycle(uid uint, payload gin.H) {
	cycleCacheMu.Lock()
	cycleCache[uid] = cycleCacheEntry{payload: payload, expiresAt: time.Now().Add(cycleCacheTTL)}
	cycleCacheMu.Unlock()
}

// InvalidateCycleCache drops a user's cached cycle payload. Call after ANY write
// that changes the cycle's derived stats so the next read recomputes from fresh
// DB state. Safe to call when nothing is cached (no-op).
func InvalidateCycleCache(uid uint) {
	cycleCacheMu.Lock()
	delete(cycleCache, uid)
	cycleCacheMu.Unlock()
}
