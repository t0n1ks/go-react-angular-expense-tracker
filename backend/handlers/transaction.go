package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func CreateTransaction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var input struct {
		CategoryID  uint    `json:"category_id" binding:"required"`
		Amount      float64 `json:"amount" binding:"required,gt=0"`
		Description string  `json:"description"`
		Date        string  `json:"date" binding:"required"`
		Type        string  `json:"type" binding:"required,oneof=expense income"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	input.Description = strings.TrimSpace(input.Description)
	if len(input.Description) > 255 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Description must be 255 characters or fewer"})
		return
	}

	var category models.Category
	if err := database.DB.Where("id = ? AND user_id = ?", input.CategoryID, userID).First(&category).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Category not found or does not belong to you"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify category: " + err.Error()})
		}
		return
	}

	parsedDate, err := time.Parse("2006-01-02", input.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid date format. Use YYYY-MM-DD"})
		return
	}

	transaction := models.Transaction{
		UserID:      userID.(uint),
		CategoryID:  input.CategoryID,
		Amount:      input.Amount,
		Description: input.Description,
		Date:        parsedDate,
		Type:        input.Type,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if err := database.DB.Create(&transaction).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create transaction: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Transaction created successfully", "transaction": transaction})
}

func GetTransactions(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var transactions []models.Transaction
	query := database.DB.Where("user_id = ?", userID)

	if categoryIDStr := c.Query("category_id"); categoryIDStr != "" {
		categoryID, err := strconv.ParseUint(categoryIDStr, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid category_id format"})
			return
		}
		query = query.Where("category_id = ?", uint(categoryID))
	}

	if beginDateStr := c.Query("begin_date"); beginDateStr != "" {
		parsedBeginDate, err := time.Parse("2006-01-02", beginDateStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid begin_date format. Use YYYY-MM-DD"})
			return
		}
		query = query.Where("date >= ?", parsedBeginDate)
	}
	if endDateStr := c.Query("end_date"); endDateStr != "" {
		parsedEndDate, err := time.Parse("2006-01-02", endDateStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid end_date format. Use YYYY-MM-DD"})
			return
		}
		query = query.Where("date <= ?", parsedEndDate.Add(24*time.Hour-time.Second))
	}

	if err := query.Preload("Category").Order("date desc").Find(&transactions).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transactions": transactions})
}

func GetTransactionByID(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	transactionID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID format"})
		return
	}

	var transaction models.Transaction
	if err := database.DB.Preload("Category").Where("id = ? AND user_id = ?", uint(transactionID), userID).First(&transaction).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found or does not belong to you"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transaction: " + err.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

func UpdateTransaction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	transactionID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID format"})
		return
	}

	var transaction models.Transaction
	if err := database.DB.Where("id = ? AND user_id = ?", uint(transactionID), userID).First(&transaction).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found or access denied"})
		return
	}

	var input struct {
		CategoryID  *uint    `json:"category_id"`
		Amount      *float64 `json:"amount"`
		Description *string  `json:"description"`
		Date        *string  `json:"date"`
		Type        *string  `json:"type"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Type != nil {
		if *input.Type != "expense" && *input.Type != "income" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid type. Allowed values: expense, income"})
			return
		}
		transaction.Type = *input.Type
	}
	if input.CategoryID != nil {
		var newCategory models.Category
		if err := database.DB.Where("id = ? AND user_id = ?", *input.CategoryID, userID).First(&newCategory).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "New category not found or does not belong to you"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to verify new category: " + err.Error()})
			}
			return
		}
		transaction.CategoryID = *input.CategoryID
	}
	if input.Amount != nil {
		if *input.Amount <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Amount must be greater than zero"})
			return
		}
		transaction.Amount = *input.Amount
	}
	if input.Description != nil {
		trimmed := strings.TrimSpace(*input.Description)
		if len(trimmed) > 255 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Description must be 255 characters or fewer"})
			return
		}
		transaction.Description = trimmed
	}
	if input.Date != nil {
		parsedDate, err := time.Parse("2006-01-02", *input.Date)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid date format. Use YYYY-MM-DD"})
			return
		}
		transaction.Date = parsedDate
	}
	transaction.UpdatedAt = time.Now()

	if err := database.DB.Save(&transaction).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update transaction: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Transaction updated successfully", "transaction": transaction})
}

func DeleteTransaction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	transactionID, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid transaction ID format"})
		return
	}

	result := database.DB.Where("id = ? AND user_id = ?", uint(transactionID), userID).Delete(&models.Transaction{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete transaction: " + result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found or access denied"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Transaction deleted successfully"})
}

type DailyExpenseSummary struct {
	CategoryID   uint      `json:"-" gorm:"column:category_id"`
	CategoryName string    `json:"-" gorm:"column:category_name"`
	Date         time.Time `json:"date"`
	TotalAmount  float64   `json:"total_amount"`
}

func GetDailySummary(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	dateStr := c.Query("date")
	if dateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter 'date' is required (format YYYY-MM-DD)"})
		return
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid date format. Use YYYY-MM-DD"})
		return
	}

	startOfDay := parsedDate
	endOfDay := parsedDate.Add(24*time.Hour - time.Second)

	var summaries []DailyExpenseSummary
	result := database.DB.Table("transactions").
		Select("transactions.category_id AS category_id, SUM(transactions.amount) AS total_amount, categories.name AS category_name").
		Joins("LEFT JOIN categories ON transactions.category_id = categories.id").
		Where("transactions.user_id = ? AND transactions.date >= ? AND transactions.date <= ?", userID, startOfDay, endOfDay).
		Group("transactions.category_id, categories.id, categories.name").
		Order("total_amount DESC").
		Scan(&summaries)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch daily summary: " + result.Error.Error()})
		return
	}

	formattedSummaries := []map[string]interface{}{}
	for _, s := range summaries {
		formattedSummaries = append(formattedSummaries, map[string]interface{}{
			"category":     map[string]interface{}{"id": s.CategoryID, "name": s.CategoryName},
			"total_amount": s.TotalAmount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"date": dateStr, "summary": formattedSummaries})
}

func GetPeriodSummary(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	beginDateStr := c.Query("begin_date")
	endDateStr := c.Query("end_date")

	if beginDateStr == "" || endDateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameters 'begin_date' and 'end_date' are required (format YYYY-MM-DD)"})
		return
	}

	parsedBeginDate, err := time.Parse("2006-01-02", beginDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid begin_date format. Use YYYY-MM-DD"})
		return
	}

	parsedEndDate, err := time.Parse("2006-01-02", endDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid end_date format. Use YYYY-MM-DD"})
		return
	}
	parsedEndDate = parsedEndDate.Add(24*time.Hour - time.Second)

	var summaries []DailyExpenseSummary
	result := database.DB.Table("transactions").
		Select("transactions.category_id AS category_id, SUM(transactions.amount) AS total_amount, categories.name AS category_name").
		Joins("LEFT JOIN categories ON transactions.category_id = categories.id").
		Where("transactions.user_id = ? AND transactions.date >= ? AND transactions.date <= ?", userID, parsedBeginDate, parsedEndDate).
		Group("transactions.category_id, categories.id, categories.name").
		Order("total_amount DESC").
		Scan(&summaries)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch period summary: " + result.Error.Error()})
		return
	}

	formattedSummaries := []map[string]interface{}{}
	for _, s := range summaries {
		formattedSummaries = append(formattedSummaries, map[string]interface{}{
			"category":     map[string]interface{}{"id": s.CategoryID, "name": s.CategoryName},
			"total_amount": s.TotalAmount,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"begin_date": beginDateStr,
		"end_date":   c.Query("end_date"),
		"summary":    formattedSummaries,
	})
}
