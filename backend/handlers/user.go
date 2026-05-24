package handlers

import (
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var jwtSecret []byte

// InitJWTSecret must be called from main() after env vars are loaded.
// Exits the process immediately if JWT_SECRET is not set.
func InitJWTSecret() {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		log.Fatal("FATAL: JWT_SECRET env var is not set — refusing to start")
	}
	jwtSecret = []byte(secret)
}

func RegisterUser(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Language string `json:"language"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	req.Username = strings.ToLower(strings.TrimSpace(req.Username))
	req.Password = strings.TrimSpace(req.Password)

	if strings.ContainsAny(req.Username, " \t") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid username: spaces are not allowed"})
		return
	}
	if req.Username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username cannot be empty"})
		return
	}
	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 6 characters"})
		return
	}
	if len(req.Password) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be 128 characters or fewer"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := models.User{
		Username:        req.Username,
		Password:        string(hashedPassword),
		Currency:        "USD",
		AIAdviceEnabled: true,
	}
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	if result := database.DB.Create(&user); result.Error != nil {
		if isDuplicateUsername(result.Error) {
			c.JSON(http.StatusConflict, gin.H{"error": "username_already_exists"})
			return
		}
		log.Printf("register: create user err=%v", result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	lang := strings.ToLower(strings.SplitN(req.Language, "-", 2)[0])
	createDefaultCategories(user.ID, lang)

	log.Printf("user registered: id=%d username=%s", user.ID, user.Username)
	c.JSON(http.StatusCreated, gin.H{"message": "User registered successfully", "user_id": user.ID, "username": user.Username})
}

func createDefaultCategories(userID uint, language string) {
	names := map[string][]string{
		"en": {"Food", "Clothing", "Entertainment", "Beauty", "Income"},
		"de": {"Essen", "Kleidung", "Unterhaltung", "Beauty", "Einkommen"},
		"ru": {"Еда", "Одежда", "Развлечения", "Красота", "Доход"},
		"uk": {"Їжа", "Одяг", "Розваги", "Краса", "Дохід"},
	}
	cats, ok := names[language]
	if !ok {
		cats = names["en"]
	}
	now := time.Now()
	for _, name := range cats {
		cat := models.Category{UserID: userID, Name: name, CreatedAt: now, UpdatedAt: now}
		if err := database.DB.Create(&cat).Error; err != nil {
			log.Printf("warning: default category %q failed for user %d: %v", name, userID, err)
		}
	}
}

func LoginUser(c *gin.Context) {
	var loginRequest struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&loginRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	loginRequest.Username = strings.ToLower(strings.TrimSpace(loginRequest.Username))
	loginRequest.Password = strings.TrimSpace(loginRequest.Password)

	if strings.ContainsAny(loginRequest.Username, " \t") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	var user models.User
	if result := database.DB.Where("username = ?", loginRequest.Username).First(&user); result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginRequest.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(time.Hour * 24 * 7).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	go checkAndUpdateHearts(user.ID)
	go WarmUpBrain()

	c.JSON(http.StatusOK, gin.H{
		"token":    tokenString,
		"user_id":  user.ID,
		"username": user.Username,
	})
}

func GetJWTSecret() []byte {
	return jwtSecret
}

func GetProfile(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID.(uint)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	currency := user.Currency
	if currency == "" {
		currency = "USD"
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                    user.ID,
		"username":              user.Username,
		"currency":              currency,
		"ai_advice_enabled":    user.AIAdviceEnabled,
		"ai_humor_enabled":     user.AIHumorEnabled,
		"monthly_spending_goal": user.MonthlySpendingGoal,
		"expected_salary":      user.ExpectedSalary,
		"payday_mode":          user.PaydayMode,
		"fixed_payday":         user.FixedPayday,
		"manual_next_payday":   user.ManualNextPayday,
		"hearts_count":         user.HeartsCount,
		"reputation_score":     user.ReputationScore,
	})
}

func UpdateProfile(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var req struct {
		Currency            string  `json:"currency"`
		AIAdviceEnabled     bool    `json:"ai_advice_enabled"`
		AIHumorEnabled      bool    `json:"ai_humor_enabled"`
		MonthlySpendingGoal float64 `json:"monthly_spending_goal"`
		ExpectedSalary      float64 `json:"expected_salary"`
		PaydayMode          string  `json:"payday_mode"`
		FixedPayday         int     `json:"fixed_payday"`
		ManualNextPayday    string  `json:"manual_next_payday"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	validCurrencies := map[string]bool{"USD": true, "EUR": true, "UAH": true}
	if req.Currency == "" {
		req.Currency = "USD"
	} else if !validCurrencies[req.Currency] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid currency"})
		return
	}

	if req.PaydayMode != "fixed" {
		req.PaydayMode = "smart"
	}
	if req.FixedPayday < 0 || req.FixedPayday > 31 {
		req.FixedPayday = 0
	}

	updates := map[string]interface{}{
		"currency":              req.Currency,
		"ai_advice_enabled":    req.AIAdviceEnabled,
		"ai_humor_enabled":     req.AIHumorEnabled,
		"monthly_spending_goal": req.MonthlySpendingGoal,
		"expected_salary":      req.ExpectedSalary,
		"payday_mode":          req.PaydayMode,
		"fixed_payday":         req.FixedPayday,
		"manual_next_payday":   req.ManualNextPayday,
	}
	if err := database.DB.Model(&models.User{}).Where("id = ?", userID.(uint)).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update profile"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated"})
}

func DeleteAccount(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	// Manual cascade: transactions → categories → user (no ON DELETE CASCADE in schema)
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Where("user_id = ?", uid).Delete(&models.Transaction{}).Error; err != nil {
			return err
		}
		if err := tx.Unscoped().Where("user_id = ?", uid).Delete(&models.Category{}).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&models.User{}, uid).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete account"})
		return
	}

	log.Printf("account deleted: user_id=%d", uid)
	c.JSON(http.StatusOK, gin.H{"message": "Account deleted successfully"})
}

// isDuplicateUsername detects unique constraint violations for both PostgreSQL (code 23505)
// and SQLite ("UNIQUE constraint failed"), so raw DB errors are never sent to the client.
func isDuplicateUsername(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return strings.Contains(err.Error(), "UNIQUE constraint failed")
}