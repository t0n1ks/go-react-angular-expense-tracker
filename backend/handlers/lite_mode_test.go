package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// callHandlerGET drives a handler with a query string (needed for the content
// endpoint, which reads ?category=…).
func callHandlerGET(uid uint, query string, h gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/?"+query, nil)
	c.Set("userID", uid)
	h(c)
	return w
}

// A Lite user must trigger NO analytics/forecast call to Python, but the advisor
// (joke/fact) path must still reach Python. Verifies §5 of the Lite-mode spec.
func TestLiteMode_GatesAnalyticsButNotAdvisor(t *testing.T) {
	setupFlowDB(t)

	var analyzeHits, contentHits int32
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/analyze-behavior":
			atomic.AddInt32(&analyzeHits, 1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
		case "/v1/tamagotchi/content":
			atomic.AddInt32(&contentHits, 1)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"type":"JOKE","content":"ha","animation_hint":"COW_ABDUCTION"}`))
		default:
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer brain.Close()
	t.Setenv("AI_SERVICE_URL", brain.URL)

	lite := models.User{Username: "lite", Password: "x", LiteMode: true}
	database.DB.Create(&lite)

	// Analytics must be short-circuited: Python not hit, neutral payload returned.
	w := callHandler(lite.ID, nil, AnalyzeBehavior)
	if w.Code != http.StatusOK {
		t.Fatalf("analyze: got %d", w.Code)
	}
	if got := atomic.LoadInt32(&analyzeHits); got != 0 {
		t.Errorf("Lite user hit Python analyze %d times, want 0", got)
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["financial_health_score"] != nil {
		t.Errorf("expected neutral (nil) health score for Lite user, got %v", resp["financial_health_score"])
	}

	// Advisor content must still reach Python.
	w2 := callHandlerGET(lite.ID, "category=joke&language=en", GetCategorizedContent)
	if w2.Code != http.StatusOK {
		t.Fatalf("content: got %d", w2.Code)
	}
	if got := atomic.LoadInt32(&contentHits); got < 1 {
		t.Errorf("Lite user should still get jokes/facts; Python content hits=%d, want >=1", got)
	}
}

// A non-Lite user's analysis DOES reach Python — proving the gate (not some
// unrelated failure) is what suppresses it for Lite users.
func TestLiteMode_NonLiteStillCallsAnalytics(t *testing.T) {
	setupFlowDB(t)

	var analyzeHits int32
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/analyze-behavior" {
			atomic.AddInt32(&analyzeHits, 1)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer brain.Close()
	t.Setenv("AI_SERVICE_URL", brain.URL)

	normal := models.User{Username: "normal", Password: "x", LiteMode: false}
	database.DB.Create(&normal)

	callHandler(normal.ID, nil, AnalyzeBehavior)
	if got := atomic.LoadInt32(&analyzeHits); got != 1 {
		t.Errorf("non-Lite user should reach Python analyze once, got %d", got)
	}
}
