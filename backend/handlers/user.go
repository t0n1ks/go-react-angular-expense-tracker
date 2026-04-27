package handlers

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var jwtSecret = func() []byte {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "supersecretkey_change_me_in_production"
		log.Println("WARNING: JWT_SECRET not set, using default insecure secret")
	}
	return []byte(secret)
}()

func RegisterUser(c *gin.Context) {
	var user models.User
	if err := c.ShouldBindJSON(&user); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user.Username = strings.ToLower(strings.TrimSpace(user.Username))
	user.Password = strings.TrimSpace(user.Password)

	if strings.ContainsAny(user.Username, " \t") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid username: spaces are not allowed"})
		return
	}
	if user.Username == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username cannot be empty"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}
	user.Password = string(hashedPassword)
	user.Currency = "USD"
	user.AIAdviceEnabled = true
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	if result := database.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user: " + result.Error.Error()})
		return
	}

	log.Printf("user registered: id=%d username=%s", user.ID, user.Username)
	c.JSON(http.StatusCreated, gin.H{"message": "User registered successfully", "user_id": user.ID, "username": user.Username})
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
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

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

	updates := map[string]interface{}{
		"currency":              req.Currency,
		"ai_advice_enabled":    req.AIAdviceEnabled,
		"ai_humor_enabled":     req.AIHumorEnabled,
		"monthly_spending_goal": req.MonthlySpendingGoal,
		"expected_salary":      req.ExpectedSalary,
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