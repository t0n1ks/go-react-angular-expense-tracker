package middleware

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// limitEntry pairs a token-bucket limiter with its last-access timestamp so
// the eviction goroutine can reclaim memory for idle IPs/users.
type limitEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// limiterStore is a concurrency-safe map of key → rate limiter.
type limiterStore struct {
	mu      sync.Mutex
	entries map[string]*limitEntry
	r       rate.Limit
	burst   int
}

func newLimiterStore(r rate.Limit, burst int) *limiterStore {
	s := &limiterStore{
		entries: make(map[string]*limitEntry),
		r:       r,
		burst:   burst,
	}
	go s.evictStale()
	return s
}

// allow returns true if the key is within its rate limit.
func (s *limiterStore) allow(key string) bool {
	s.mu.Lock()
	e, ok := s.entries[key]
	if !ok {
		e = &limitEntry{limiter: rate.NewLimiter(s.r, s.burst)}
		s.entries[key] = e
	}
	e.lastSeen = time.Now()
	ok = e.limiter.Allow()
	s.mu.Unlock()
	return ok
}

// evictStale removes entries unseen for more than 30 minutes to bound
// memory growth without requiring an external cache.
func (s *limiterStore) evictStale() {
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-30 * time.Minute)
		s.mu.Lock()
		for k, e := range s.entries {
			if e.lastSeen.Before(cutoff) {
				delete(s.entries, k)
			}
		}
		s.mu.Unlock()
	}
}

// PerIP returns a Gin middleware that rate-limits by client IP address using a
// token-bucket algorithm.  Each call to PerIP creates an independent store, so
// different routes can have different limits.
//
// Example — 10 requests per minute with burst of 10:
//
//	PerIP(rate.Every(6*time.Second), 10)
func PerIP(r rate.Limit, burst int) gin.HandlerFunc {
	store := newLimiterStore(r, burst)
	return func(c *gin.Context) {
		if !store.allow(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests — please wait before trying again",
			})
			return
		}
		c.Next()
	}
}

// PerUser returns a Gin middleware that rate-limits by authenticated user ID.
// Must be placed after AuthMiddleware so "userID" is already in the context.
//
// Example — 30 AI analysis calls per minute per user:
//
//	PerUser(rate.Every(2*time.Second), 5)
func PerUser(r rate.Limit, burst int) gin.HandlerFunc {
	store := newLimiterStore(r, burst)
	return func(c *gin.Context) {
		userID, _ := c.Get("userID")
		if !store.allow(fmt.Sprintf("%v", userID)) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests — please wait before trying again",
			})
			return
		}
		c.Next()
	}
}
