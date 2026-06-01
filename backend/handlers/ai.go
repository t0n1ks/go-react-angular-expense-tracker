package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var afkPhrases = []string{
	"[AFK-mode] I've been orbiting your budget in silence... 🛸",
	"[AFK-mode] System idle. The UFO waits, the numbers multiply.",
	"[AFK-mode] Running diagnostics. Everything checks out — except your snack spending.",
	"[AFK-mode] Deep space detected no anomalies. Your wallet, however...",
	"[AFK-mode] Maintenance mode: polishing the abduction beam. Back soon.",
	"[AFK-mode] Low-power mode. Recharging on stardust and good vibes.",
	"[AFK-mode] Autonomous protocol active. Brain offline, instincts online.",
	"[AFK-mode] Signal lost with HQ. Proceeding on last known coordinates.",
	"[AFK-mode] Local AI engaged. The cloud is sleeping — I am not.",
	"[AFK-mode] Fallback systems nominal. No brain, no problem. Probably.",
}

var brainClient = &http.Client{Timeout: 15 * time.Second}

// brainStatus: 0=initializing, 1=online, 2=autonomous
var brainStatus int32

// warmupRunning prevents concurrent warm-up goroutines from stacking up.
var warmupRunning int32

func getBrainBaseURL() string {
	if url := os.Getenv("AI_SERVICE_URL"); url != "" {
		return url
	}
	return "http://localhost:8001"
}

func tryPingBrain() bool {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, getBrainBaseURL()+"/health", nil)
	if err != nil {
		return false
	}
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))
	resp, err := brainClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// WarmUpBrain pings the AI service once and updates brainStatus atomically.
// Safe to run in a goroutine; exits early if already online or if another
// check is already in progress.
func WarmUpBrain() {
	if atomic.LoadInt32(&brainStatus) == 1 {
		return
	}
	if !atomic.CompareAndSwapInt32(&warmupRunning, 0, 1) {
		return
	}
	defer atomic.StoreInt32(&warmupRunning, 0)

	if tryPingBrain() {
		prev := atomic.LoadInt32(&brainStatus)
		atomic.StoreInt32(&brainStatus, 1)
		log.Printf("[ai] brain online — status %d → 1", prev)
	} else {
		log.Printf("[ai] brain unreachable — autonomous mode")
		atomic.StoreInt32(&brainStatus, 2)
	}
}

// StartBrainRepoller runs a background loop that checks brain availability
// every 5 minutes and re-runs WarmUpBrain if the service is not online.
func StartBrainRepoller() {
	go func() {
		for {
			time.Sleep(5 * time.Minute)
			if atomic.LoadInt32(&brainStatus) != 1 {
				go WarmUpBrain()
			}
		}
	}()
}

// GetAIServiceStatus returns the current AI service availability mode.
// If the service is not online, it fires a background re-warm so open tabs
// can recover without requiring the user to re-login.
func GetAIServiceStatus(c *gin.Context) {
	status := atomic.LoadInt32(&brainStatus)
	if status != 1 {
		go WarmUpBrain()
	}
	switch status {
	case 1:
		c.JSON(http.StatusOK, gin.H{"mode": "online"})
	case 2:
		c.JSON(http.StatusOK, gin.H{"mode": "autonomous"})
	default:
		c.JSON(http.StatusOK, gin.H{"mode": "initializing"})
	}
}

func normalizeLangForBrain(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))
	if lang == "" {
		lang = "en"
	}
	return lang
}

// checkAndUpdateHearts awards one heart if the user stayed within budget every day for 60 days.
// Designed to run in a goroutine after login — never blocks the response.
func checkAndUpdateHearts(userID uint) {
	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		return
	}
	if user.HeartsCount >= 5 || user.MonthlySpendingGoal == 0 {
		return
	}

	since := time.Now().AddDate(0, 0, -60)
	var txs []models.Transaction
	if err := database.DB.Where("user_id = ? AND type = 'expense' AND date >= ?", userID, since).
		Find(&txs).Error; err != nil {
		return
	}
	if len(txs) == 0 {
		return
	}

	dailyTotals := make(map[string]float64)
	for _, tx := range txs {
		day := tx.Date.Format("2006-01-02")
		dailyTotals[day] += tx.Amount
	}

	dailyLimit := user.MonthlySpendingGoal / 30
	for _, total := range dailyTotals {
		if total > dailyLimit {
			return
		}
	}

	database.DB.Model(&models.User{}).Where("id = ?", userID).
		Update("hearts_count", user.HeartsCount+1)
}

// GetNextAction proxies GET /v1/tamagotchi/next-action from the Python AI brain service.
func GetNextAction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	// Language is set exclusively by the frontend query param — never inferred from
	// browser headers, so the UI locale is always the single source of truth.
	lang := normalizeLangForBrain(strings.SplitN(c.Query("language"), "-", 2)[0])
	log.Printf("[ai] next-action uid=%v frontend_lang=%q → python_lang=%q", userID, c.Query("language"), lang)

	url := fmt.Sprintf("%s/v1/tamagotchi/next-action?user_id=%d&language=%s",
		getBrainBaseURL(), userID.(uint), lang)

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, url, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
		return
	}
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))

	resp, err := brainClient.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"type": "AFK", "content": afkPhrases[rand.Intn(len(afkPhrases))], "animation_hint": "FLY_BY_MOON"})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"type": "AFK", "content": afkPhrases[rand.Intn(len(afkPhrases))], "animation_hint": "FLY_BY_MOON"})
		return
	}

	// Return 200 with empty payload for any non-2xx Python response so the
	// browser never logs a console network error for unsupported languages or
	// when the AI service is offline.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusOK, gin.H{"type": "AFK", "content": afkPhrases[rand.Intn(len(afkPhrases))], "animation_hint": "FLY_BY_MOON"})
		return
	}

	c.Data(resp.StatusCode, "application/json", respBody)
}

type aiUserProfile struct {
	UserID              int     `json:"user_id"`
	Currency            string  `json:"currency"`
	MonthlySpendingGoal float64 `json:"monthly_spending_goal"`
	ExpectedSalary      float64 `json:"expected_salary"`
	PaydayMode          string  `json:"payday_mode"`
	FixedPayday         int     `json:"fixed_payday"`
	ManualNextPayday    *string `json:"manual_next_payday"`
	AIHumorEnabled      bool    `json:"ai_humor_enabled"`
	Language            string  `json:"language"`
	FixedExpCategoryID  int     `json:"fixed_exp_category_id"`
}

type aiSalaryCycleInfo struct {
	TotalIncome          float64 `json:"total_income"`
	NeedsPct             float64 `json:"needs_pct"`
	WantsPct             float64 `json:"wants_pct"`
	SavingsPct           float64 `json:"savings_pct"`
	SavingsLimit         float64 `json:"savings_limit"`
	FixedNeedsTotal      float64 `json:"fixed_needs_total"`
	FixedWantsTotal      float64 `json:"fixed_wants_total"`
	VarNeedsBudget       float64 `json:"var_needs_budget"`
	VarWantsBudget       float64 `json:"var_wants_budget"`
	FixedExpCategoryID   int     `json:"fixed_exp_category_id"`
	SavedMoneyCategoryID int     `json:"saved_money_category_id"`
	SavedMoneyBalance    float64 `json:"saved_money_balance"`
	CycleStartAt         string  `json:"cycle_start_at"`
	NextPaydayAt         string  `json:"next_payday_at"`
}

type aiCategoryRef struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type aiTransaction struct {
	ID          int           `json:"id"`
	Amount      float64       `json:"amount"`
	Category    aiCategoryRef `json:"category"`
	Date        string        `json:"date"`
	Type        string        `json:"type"`
	IncomeType  string        `json:"income_type"`
	Description string        `json:"description"`
}

type analyzeBehaviorRequest struct {
	UserProfile    aiUserProfile      `json:"user_profile"`
	Transactions   []aiTransaction    `json:"transactions"`
	AnalysisDate   string             `json:"analysis_date"`
	UserCategories []string           `json:"user_categories"`
	SalaryCycle    *aiSalaryCycleInfo `json:"salary_cycle"`
}

func AnalyzeBehavior(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var user models.User
	if err := database.DB.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	// Limit to the last 90 days — enough history for ML forecasting and mood
	// detection while preventing the payload from growing unbounded for users
	// with years of data.  Income transactions from the last pay cycle are
	// always within this window for any sane pay frequency.
	since := time.Now().AddDate(0, 0, -90)
	var txs []models.Transaction
	if err := database.DB.Preload("Category").
		Where("user_id = ? AND date >= ?", uid, since).
		Find(&txs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
		return
	}

	analyzeLang := normalizeLangForBrain(strings.SplitN(c.Query("language"), "-", 2)[0])
	log.Printf("[ai] analyze uid=%v frontend_lang=%q → python_lang=%q", uid, c.Query("language"), analyzeLang)

	var manualNextPayday *string
	if user.ManualNextPayday != "" {
		s := user.ManualNextPayday
		manualNextPayday = &s
	}

	// Fetch the active salary cycle for AI analysis context
	var activeCycle models.SalaryCycle
	var cyclePayload *aiSalaryCycleInfo
	if err := database.DB.Where("user_id = ?", uid).Order("cycle_start_at DESC").First(&activeCycle).Error; err == nil {
		// Compute the authoritative savings pool balance for the AI service
		// so the forecast uses real pool data, not a generic income-expense net.
		var savedMoneyBalance float64
		if activeCycle.SavedMoneyCategoryID > 0 {
			var pool []models.Transaction
			database.DB.
				Where("user_id = ? AND category_id = ?", uid, activeCycle.SavedMoneyCategoryID).
				Find(&pool)
			for _, p := range pool {
				if p.Type == "income" || p.Type == "savings_deposit" {
					savedMoneyBalance += p.Amount
				} else {
					savedMoneyBalance -= p.Amount
				}
			}
		}
		cyclePayload = &aiSalaryCycleInfo{
			TotalIncome:          activeCycle.TotalIncome,
			NeedsPct:             activeCycle.NeedsPct,
			WantsPct:             activeCycle.WantsPct,
			SavingsPct:           activeCycle.SavingsPct,
			SavingsLimit:         activeCycle.SavingsLimit,
			FixedNeedsTotal:      activeCycle.FixedNeedsTotal,
			FixedWantsTotal:      activeCycle.FixedWantsTotal,
			VarNeedsBudget:       activeCycle.VarNeedsBudget,
			VarWantsBudget:       activeCycle.VarWantsBudget,
			FixedExpCategoryID:   int(activeCycle.FixedExpCategoryID),
			SavedMoneyCategoryID: int(activeCycle.SavedMoneyCategoryID),
			SavedMoneyBalance:    savedMoneyBalance,
			CycleStartAt:         activeCycle.CycleStartAt.Format(time.RFC3339),
		}
		if activeCycle.NextPaydayAt != nil {
			cyclePayload.NextPaydayAt = activeCycle.NextPaydayAt.Format(time.RFC3339)
		}
	}

	profile := aiUserProfile{
		UserID:              int(uid),
		Currency:            user.Currency,
		MonthlySpendingGoal: user.MonthlySpendingGoal,
		ExpectedSalary:      user.ExpectedSalary,
		PaydayMode:          user.PaydayMode,
		FixedPayday:         user.FixedPayday,
		ManualNextPayday:    manualNextPayday,
		AIHumorEnabled:      user.AIHumorEnabled,
		Language:            analyzeLang,
		FixedExpCategoryID:  int(activeCycle.FixedExpCategoryID),
	}

	var cats []models.Category
	if err := database.DB.Where("user_id = ?", uid).Find(&cats).Error; err != nil {
		cats = nil
	}
	catNames := make([]string, 0, len(cats))
	for _, cat := range cats {
		catNames = append(catNames, cat.Name)
	}

	aiTxs := make([]aiTransaction, 0, len(txs))
	for _, tx := range txs {
		aiTxs = append(aiTxs, aiTransaction{
			ID:     int(tx.ID),
			Amount: tx.Amount,
			Category: aiCategoryRef{
				ID:   int(tx.CategoryID),
				Name: tx.Category.Name,
			},
			Date:        tx.Date.Format("2006-01-02"),
			Type:        tx.Type,
			IncomeType:  tx.IncomeType,
			Description: tx.Description,
		})
	}

	payload := analyzeBehaviorRequest{
		UserProfile:    profile,
		Transactions:   aiTxs,
		AnalysisDate:   time.Now().Format("2006-01-02"),
		UserCategories: catNames,
		SalaryCycle:    cyclePayload,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build request"})
		return
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, getBrainBaseURL()+"/v1/analyze-behavior", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))

	analyzeResp, err := brainClient.Do(req)
	if err != nil {
		log.Printf("[ai] analyze: HTTP request failed — marking autonomous: %v", err)
		atomic.StoreInt32(&brainStatus, 2)
		c.JSON(http.StatusOK, gin.H{
			"tamagotchi_mood":                "content",
			"smart_nudge":                    "",
			"spending_tier":                  "pacing_good",
			"risk_flags":                     []string{},
			"financial_health_score":         nil,
			"sustainability_score":           nil,
			"predicted_end_of_month_balance": nil,
		})
		return
	}
	defer analyzeResp.Body.Close()

	respBody, err := io.ReadAll(analyzeResp.Body)
	if err != nil || analyzeResp.StatusCode < 200 || analyzeResp.StatusCode >= 300 {
		log.Printf("[ai] analyze: bad response (status %d) — marking autonomous", analyzeResp.StatusCode)
		atomic.StoreInt32(&brainStatus, 2)
		c.JSON(http.StatusOK, gin.H{
			"tamagotchi_mood":                "content",
			"smart_nudge":                    "",
			"spending_tier":                  "pacing_good",
			"risk_flags":                     []string{},
			"financial_health_score":         nil,
			"sustainability_score":           nil,
			"predicted_end_of_month_balance": nil,
		})
		return
	}

	if prev := atomic.LoadInt32(&brainStatus); prev != 1 {
		log.Printf("[ai] analyze succeeded — status %d → 1 (online)", prev)
	}
	atomic.StoreInt32(&brainStatus, 1)
	c.Data(analyzeResp.StatusCode, "application/json", respBody)
}

// SendFeedback proxies POST /v1/tamagotchi/feedback to the Python AI brain service.
// Rejection signals let Python activate apology mode after repeated dismissals.
// Always returns 200 — the client must never see a service-down error on feedback.
func SendFeedback(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var incoming struct {
		Accepted bool `json:"accepted"`
	}
	if err := c.ShouldBindJSON(&incoming); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	type feedbackPayload struct {
		UserID   uint `json:"user_id"`
		Accepted bool `json:"accepted"`
	}
	payload, _ := json.Marshal(feedbackPayload{UserID: userID.(uint), Accepted: incoming.Accepted})

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
		getBrainBaseURL()+"/v1/tamagotchi/feedback", bytes.NewReader(payload))
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))

	resp, err := brainClient.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
		return
	}
	resp.Body.Close()
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
