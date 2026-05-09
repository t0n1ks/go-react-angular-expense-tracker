package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var brainClient = &http.Client{Timeout: 10 * time.Second}

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

	brainURL := os.Getenv("AI_SERVICE_URL")
	if brainURL == "" {
		brainURL = "http://localhost:8001"
	}

	url := fmt.Sprintf("%s/v1/tamagotchi/next-action?user_id=%d&language=%s",
		brainURL, userID.(uint), lang)

	log.Printf("[ai] next-action → calling URL: %s", url)
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, url, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
		return
	}
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))

	resp, err := brainClient.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"type": "NONE", "content": ""})
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"type": "NONE", "content": ""})
		return
	}

	// Return 200 with empty payload for any non-2xx Python response so the
	// browser never logs a console network error for unsupported languages or
	// when the AI service is offline.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusOK, gin.H{"type": "NONE", "content": ""})
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
	UserProfile  aiUserProfile   `json:"user_profile"`
	Transactions []aiTransaction `json:"transactions"`
	AnalysisDate string          `json:"analysis_date"`
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

	var txs []models.Transaction
	if err := database.DB.Preload("Category").Where("user_id = ?", uid).Find(&txs).Error; err != nil {
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
		UserProfile:  profile,
		Transactions: aiTxs,
		AnalysisDate: time.Now().Format("2006-01-02"),
	}

	body, err := json.Marshal(payload)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build request"})
		return
	}

	brainURL := os.Getenv("AI_SERVICE_URL")
	if brainURL == "" {
		brainURL = "http://localhost:8001"
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, brainURL+"/v1/analyze-behavior", bytes.NewReader(body))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))

	analyzeResp, err := brainClient.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"tamagotchi_mood": "content", "smart_nudge": "", "spending_tier": "pacing_good", "risk_flags": []string{}})
		return
	}
	defer analyzeResp.Body.Close()

	respBody, err := io.ReadAll(analyzeResp.Body)
	if err != nil || analyzeResp.StatusCode < 200 || analyzeResp.StatusCode >= 300 {
		c.JSON(http.StatusOK, gin.H{"tamagotchi_mood": "content", "smart_nudge": "", "spending_tier": "pacing_good", "risk_flags": []string{}})
		return
	}

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

	brainURL := os.Getenv("AI_SERVICE_URL")
	if brainURL == "" {
		brainURL = "http://localhost:8001"
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost,
		brainURL+"/v1/tamagotchi/feedback", bytes.NewReader(payload))
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
