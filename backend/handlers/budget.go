package handlers

import (
	"log"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// DefaultMonthlyBudget is the sensible default surfaced by the "auto-generate"
// option for users who don't want to type their own limit. It is a DEFAULT, not
// a floor — the user can change it afterwards. Sent to the client so the €500
// figure lives in exactly one place.
const DefaultMonthlyBudget = 500.0

// BudgetWindow is the server-authoritative monthly budget view for users who do
// NOT run a salary cycle. It reuses the same safe "spread the remainder, cap at
// what's left" allowance rule as the cycle engine, so the fragile client-side
// formula is no longer the source of truth for these users.
//
// It creates NO rows and fabricates NO transactions — it is a pure read over the
// user's profile goal + existing expenses, scoped to the current calendar month
// (a stateless, auto-advancing window that matches the donut/forecaster default).
type BudgetWindow struct {
	HasGoal       bool    `json:"has_goal"`
	DefaultGoal   float64 `json:"default_goal"`
	MonthlyBudget float64 `json:"monthly_budget"`

	WindowStart time.Time `json:"window_start"`
	WindowEnd   time.Time `json:"window_end"`

	SpentThisWindow float64 `json:"spent_this_window"`
	Remaining       float64 `json:"remaining"`

	CurrentWeekAllowance float64 `json:"current_week_allowance"`
	CurrentWeekSpent     float64 `json:"current_week_spent"`

	DaysTotal     int `json:"days_total"`
	DaysElapsed   int `json:"days_elapsed"`
	DaysRemaining int `json:"days_remaining"`
}

// round2 rounds to 2 decimals, half-up, so money figures reconcile to the cent.
func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

// startOfWeekMonday returns 00:00 on the Monday of t's week, in t's location.
func startOfWeekMonday(t time.Time) time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	// time.Weekday: Sunday=0 … Saturday=6. Shift so Monday is the anchor.
	offset := (int(d.Weekday()) + 6) % 7
	return d.AddDate(0, 0, -offset)
}

// computeBudgetWindow builds the monthly BudgetWindow for a user. Exposed
// (unexported) helper so it can be unit-tested against a real DB.
func computeBudgetWindow(uid uint, goal float64, now time.Time) BudgetWindow {
	loc := now.Location()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	// Last instant of the month = start of next month minus 1ns.
	monthEnd := monthStart.AddDate(0, 1, 0).Add(-time.Nanosecond)

	daysTotal := monthEnd.Day()
	daysElapsed := now.Day()
	daysRemaining := daysTotal - daysElapsed + 1 // inclusive of today
	if daysRemaining < 1 {
		daysRemaining = 1
	}

	// Variable spend this month. No salary cycle ⇒ no fixed/savings categories,
	// so every live expense counts. Windowed by created_at to match the cycle
	// engine and the category donut.
	var txs []models.Transaction
	database.DB.
		Where("user_id = ? AND type = ? AND created_at >= ? AND created_at <= ?",
			uid, "expense", monthStart, monthEnd).
		Find(&txs)

	weekStart := startOfWeekMonday(now)
	if weekStart.Before(monthStart) {
		weekStart = monthStart
	}

	var spent, weekSpent float64
	for _, t := range txs {
		spent += t.Amount
		if !t.CreatedAt.Before(weekStart) {
			weekSpent += t.Amount
		}
	}

	remaining := math.Max(0, goal-spent)
	// Even-pace one-week share of the remainder, never more than what's left —
	// the same guardrail computeLegacyWeeklyAllowance enforces on the client.
	weekAllowance := math.Min(remaining/float64(daysRemaining)*7, remaining)

	return BudgetWindow{
		HasGoal:              goal > 0,
		DefaultGoal:          DefaultMonthlyBudget,
		MonthlyBudget:        round2(goal),
		WindowStart:          monthStart,
		WindowEnd:            monthEnd,
		SpentThisWindow:      round2(spent),
		Remaining:            round2(remaining),
		CurrentWeekAllowance: round2(weekAllowance),
		CurrentWeekSpent:     round2(weekSpent),
		DaysTotal:            daysTotal,
		DaysElapsed:          daysElapsed,
		DaysRemaining:        daysRemaining,
	}
}

// GetCurrentBudget → GET /api/budget/current
// Server-authoritative monthly budget for users without a salary cycle.
func GetCurrentBudget(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var user models.User
	if err := database.DB.First(&user, uid).Error; err != nil {
		log.Printf("get current budget: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load profile"})
		return
	}

	c.JSON(http.StatusOK, computeBudgetWindow(uid, user.MonthlySpendingGoal, time.Now()))
}
