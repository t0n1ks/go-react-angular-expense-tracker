package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// setupFlowDB spins up an isolated SQLite DB that mirrors the production
// AutoMigrate set, then assigns it to the package-global database.DB so the
// handlers operate against it exactly as they do in production.
func setupFlowDB(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "flow.db")
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{}, &models.SalaryCycle{}, &models.FixedExpense{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Close the handle before t.TempDir cleanup, or Windows refuses to unlink
	// the still-open DB file and fails the test.
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	database.DB = db
}

// callHandler invokes a gin handler with the given userID + JSON body and
// returns the response recorder.
func callHandler(uid uint, body any, h gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(body)
	c.Request = httptest.NewRequest(http.MethodPost, "/", &buf)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("userID", uid)
	h(c)
	return w
}

// TestStartCycleThenSavings_AfterHeal reproduces the live bug:
//  1. A user already has a cycle whose category IDs were reset to 0 by the
//     heal script (simulating an existing/corrupted account).
//  2. The user starts a brand-new, non-overlapping cycle.
//  3. The user adds money to the savings pool manually.
func TestStartCycleThenSavings_AfterHeal(t *testing.T) {
	setupFlowDB(t)

	user := models.User{Username: "alice", Password: "x"}
	if err := database.DB.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	// Existing (old) cycle that the heal script left with category IDs = 0.
	oldStart := time.Now().AddDate(0, 0, -60)
	oldPayday := oldStart.AddDate(0, 0, 30)
	oldCycle := models.SalaryCycle{
		UserID:               user.ID,
		BaseSalary:           2000,
		TotalIncome:          2000,
		NeedsPct:             50,
		WantsPct:             30,
		SavingsPct:           20,
		CycleStartAt:         oldStart,
		NextPaydayAt:         &oldPayday,
		FixedExpCategoryID:   0,
		SavedMoneyCategoryID: 0,
		CreatedAt:            oldStart,
		UpdatedAt:            oldStart,
	}
	if err := database.DB.Create(&oldCycle).Error; err != nil {
		t.Fatalf("create old cycle: %v", err)
	}
	// Salary tx so the old cycle isn't treated as a ghost.
	cat := models.Category{UserID: user.ID, Name: "Income"}
	database.DB.Create(&cat)
	database.DB.Create(&models.Transaction{
		UserID: user.ID, CategoryID: cat.ID, Amount: 2000,
		Description: "Salary", Date: oldStart, Type: "income",
		CreatedAt: oldStart, UpdatedAt: oldStart,
	})

	// ── Step 1: start a brand new cycle today ──────────────────────────────
	startBody := map[string]any{
		"base_salary":      2500.0,
		"bonuses":          0.0,
		"received_at_date": time.Now().Format("2006-01-02"),
		"next_payday_date": time.Now().AddDate(0, 0, 30).Format("2006-01-02"),
		"language":         "en",
		"needs_pct":        50.0,
		"wants_pct":        30.0,
		"savings_pct":      20.0,
		"fixed_expenses": []map[string]any{
			{"amount": 600.0, "description": "Rent", "category_type": "need"},
		},
	}
	w := callHandler(user.ID, startBody, StartSalaryCycle)
	if w.Code != http.StatusCreated {
		t.Fatalf("StartSalaryCycle: expected 201, got %d — body: %s", w.Code, w.Body.String())
	}
	t.Logf("StartSalaryCycle OK: %s", w.Body.String())

	// ── Step 2: add manual savings ─────────────────────────────────────────
	savingsBody := map[string]any{"amount": 150.0, "description": "Extra deposit"}
	w2 := callHandler(user.ID, savingsBody, AddSavingsManual)
	if w2.Code != http.StatusCreated {
		t.Fatalf("AddSavingsManual: expected 201, got %d — body: %s", w2.Code, w2.Body.String())
	}
	t.Logf("AddSavingsManual OK: %s", w2.Body.String())
}
