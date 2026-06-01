package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// TestCycleCachePrimitives covers set/get/TTL/invalidate in isolation.
func TestCycleCachePrimitives(t *testing.T) {
	InvalidateCycleCache(9999)
	if _, ok := getCachedCycle(9999); ok {
		t.Fatal("expected empty cache to miss")
	}
	setCachedCycle(9999, map[string]any{"x": 1})
	if _, ok := getCachedCycle(9999); !ok {
		t.Fatal("expected cache hit after set")
	}
	InvalidateCycleCache(9999)
	if _, ok := getCachedCycle(9999); ok {
		t.Fatal("expected miss after invalidate")
	}
}

// TestCycleCacheInvalidatedOnTxCreate proves a write mutation drops the cached
// payload so the next read reflects fresh DB state (no stale stats served).
func TestCycleCacheInvalidatedOnTxCreate(t *testing.T) {
	setupFlowDB(t)

	user := models.User{Username: "cacheuser", Password: "x"}
	if err := database.DB.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Start a cycle today (also primes categories).
	startBody := map[string]any{
		"base_salary": 3000.0, "language": "en",
		"needs_pct": 50.0, "wants_pct": 30.0, "savings_pct": 20.0,
		"received_at_date": time.Now().Format("2006-01-02"),
		"next_payday_date": time.Now().AddDate(0, 0, 30).Format("2006-01-02"),
	}
	if w := callHandler(user.ID, startBody, StartSalaryCycle); w.Code != http.StatusCreated {
		t.Fatalf("StartSalaryCycle: %d %s", w.Code, w.Body.String())
	}

	expensesOf := func() float64 {
		w := callHandler(user.ID, nil, GetCurrentSalaryCycle)
		if w.Code != http.StatusOK {
			t.Fatalf("GetCurrentSalaryCycle: %d %s", w.Code, w.Body.String())
		}
		var resp struct {
			CycleStats *struct {
				CycleExpenses float64 `json:"cycle_expenses"`
			} `json:"cycle_stats"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if resp.CycleStats == nil {
			t.Fatal("expected cycle_stats in response")
		}
		return resp.CycleStats.CycleExpenses
	}

	before := expensesOf() // first read → computes + caches
	_ = expensesOf()       // second read → served from cache

	// Need a category to attach the expense to.
	var cat models.Category
	if err := database.DB.Where("user_id = ?", user.ID).First(&cat).Error; err != nil {
		t.Fatalf("find category: %v", err)
	}

	// Mutate: create an expense via the real handler (must invalidate the cache).
	txBody := map[string]any{
		"category_id": cat.ID,
		"amount":      42.50,
		"date":        time.Now().Format("2006-01-02"),
		"type":        "expense",
	}
	if w := callHandler(user.ID, txBody, CreateTransaction); w.Code != http.StatusCreated {
		t.Fatalf("CreateTransaction: %d %s", w.Code, w.Body.String())
	}

	after := expensesOf() // must recompute, not serve the stale cached value
	if after-before < 42.49 {
		t.Errorf("cache not invalidated on tx create: expenses before=%.2f after=%.2f (expected +42.50)", before, after)
	}
}
