// backend/handlers/transaction.go
package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database" // Обновите путь!
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"   // Обновите путь!
)

// CreateTransaction создает новую транзакцию для аутентифицированного пользователя
func CreateTransaction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	var transactionInput struct {
		CategoryID  uint    `json:"category_id" binding:"required"`
		Amount      float64 `json:"amount" binding:"required,gt=0"` // gt=0 означает "больше нуля"
		Description string  `json:"description"`
		Date        string  `json:"date" binding:"required"` // Дата в виде строки, будем парсить
	}
	if err := c.ShouldBindJSON(&transactionInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Проверяем, существует ли категория и принадлежит ли она текущему пользователю
	var category models.Category
	result := database.DB.Where("id = ? AND user_id = ?", transactionInput.CategoryID, userID).First(&category)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Категория не найдена или не принадлежит вам"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при проверке категории: " + result.Error.Error()})
		}
		return
	}

	// Парсим дату из строки. Ожидаем формат "YYYY-MM-DD".
	parsedDate, err := time.Parse("2006-01-02", transactionInput.Date)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат даты. Используйте YYYY-MM-DD"})
		return
	}

	transaction := models.Transaction{
		UserID:      userID.(uint),
		CategoryID:  transactionInput.CategoryID,
		Amount:      transactionInput.Amount,
		Description: transactionInput.Description,
		Date:        parsedDate,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	result = database.DB.Create(&transaction)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать транзакцию: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Транзакция успешно создана", "transaction": transaction})
}

// GetTransactions возвращает все транзакции для аутентифицированного пользователя
// Поддерживает фильтрацию по категории и дате (опционально)
func GetTransactions(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	var transactions []models.Transaction
	query := database.DB.Where("user_id = ?", userID)

	// Фильтрация по category_id
	if categoryIDStr := c.Query("category_id"); categoryIDStr != "" {
		categoryID, err := strconv.ParseUint(categoryIDStr, 10, 32)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат category_id"})
			return
		}
		query = query.Where("category_id = ?", uint(categoryID))
	}

	// Фильтрация по дате (begin_date и end_date)
	if beginDateStr := c.Query("begin_date"); beginDateStr != "" {
		parsedBeginDate, err := time.Parse("2006-01-02", beginDateStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат begin_date. Используйте YYYY-MM-DD"})
			return
		}
		query = query.Where("date >= ?", parsedBeginDate)
	}
	if endDateStr := c.Query("end_date"); endDateStr != "" {
		parsedEndDate, err := time.Parse("2006-01-02", endDateStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат end_date. Используйте YYYY-MM-DD"})
			return
		}
		// Для включения всего дня, добавляем 23ч 59м 59с
		query = query.Where("date <= ?", parsedEndDate.Add(24*time.Hour-time.Second))
	}

	// Загружаем связанные категории для каждой транзакции
	result := query.Preload("Category").Order("date desc").Find(&transactions)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось получить транзакции: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"transactions": transactions})
}

// GetTransactionByID возвращает одну транзакцию по ID
func GetTransactionByID(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	transactionIDStr := c.Param("id")
	transactionID, err := strconv.ParseUint(transactionIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат ID транзакции"})
		return
	}

	var transaction models.Transaction
	// Ищем транзакцию по ID и принадлежности текущему пользователю, загружаем категорию
	result := database.DB.Preload("Category").Where("id = ? AND user_id = ?", uint(transactionID), userID).First(&transaction)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Транзакция не найдена или не принадлежит вам"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при получении транзакции: " + result.Error.Error()})
		}
		return
	}

	c.JSON(http.StatusOK, gin.H{"transaction": transaction})
}

// UpdateTransaction обновляет существующую транзакцию
func UpdateTransaction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	transactionIDStr := c.Param("id")
	transactionID, err := strconv.ParseUint(transactionIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат ID транзакции"})
		return
	}

	var transaction models.Transaction
	// Ищем транзакцию по ID и принадлежности текущему пользователю
	result := database.DB.Where("id = ? AND user_id = ?", uint(transactionID), userID).First(&transaction)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Транзакция не найдена или не принадлежит вам"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при получении транзакции: " + result.Error.Error()})
		}
		return
	}

	var transactionInput struct {
		CategoryID  *uint    `json:"category_id"` // Используем указатели для необязательных полей
		Amount      *float64 `json:"amount"`
		Description *string  `json:"description"`
		Date        *string  `json:"date"`
	}
	// ShouldBindJSON будет привязывать только те поля, которые присутствуют в JSON-запросе
	if err := c.ShouldBindJSON(&transactionInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Обновляем поля, только если они присутствуют в запросе
	if transactionInput.CategoryID != nil {
		// Проверяем, существует ли новая категория и принадлежит ли она текущему пользователю
		var newCategory models.Category
		catCheckResult := database.DB.Where("id = ? AND user_id = ?", *transactionInput.CategoryID, userID).First(&newCategory)
		if catCheckResult.Error != nil {
			if catCheckResult.Error == gorm.ErrRecordNotFound {
				c.JSON(http.StatusNotFound, gin.H{"error": "Новая категория не найдена или не принадлежит вам"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при проверке новой категории: " + catCheckResult.Error.Error()})
			}
			return
		}
		transaction.CategoryID = *transactionInput.CategoryID
	}
	if transactionInput.Amount != nil {
		if *transactionInput.Amount <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Сумма должна быть больше нуля"})
			return
		}
		transaction.Amount = *transactionInput.Amount
	}
	if transactionInput.Description != nil {
		transaction.Description = *transactionInput.Description
	}
	if transactionInput.Date != nil {
		parsedDate, err := time.Parse("2006-01-02", *transactionInput.Date)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат даты. Используйте YYYY-MM-DD"})
			return
		}
		transaction.Date = parsedDate
	}
	transaction.UpdatedAt = time.Now()

	result = database.DB.Save(&transaction) // Save обновляет запись
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить транзакцию: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Транзакция успешно обновлена", "transaction": transaction})
}

// DeleteTransaction удаляет транзакцию
func DeleteTransaction(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	transactionIDStr := c.Param("id")
	transactionID, err := strconv.ParseUint(transactionIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат ID транзакции"})
		return
	}

	// Проверяем, что транзакция принадлежит текущему пользователю перед удалением
	var transaction models.Transaction
	result := database.DB.Where("id = ? AND user_id = ?", uint(transactionID), userID).First(&transaction)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Транзакция не найдена или не принадлежит вам"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при получении транзакции: " + result.Error.Error()})
		}
		return
	}

	result = database.DB.Delete(&transaction) // Удаляем запись
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить транзакцию: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Транзакция успешно удалена"})
}
