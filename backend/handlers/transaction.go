// backend/handlers/transaction.go
package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
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
		Type        string  `json:"type" binding:"required,oneof=expense income"`
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
		Description: transactionInput.Description, // ИСПРАВЛЕНО: Теперь использует transactionInput.Description
		Date:        parsedDate,
		Type:          transactionInput.Type,
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
		Type          *string  `json:"type"`
	}
	// ShouldBindJSON будет привязывать только те поля, которые присутствуют в JSON-запросе
	if err := c.ShouldBindJSON(&transactionInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

// Обновите поле Type
if transactionInput.Type != nil { // (~строка 176)
    // Добавьте простую проверку валидности (хотя Gin-валидация лучше, эта тоже сработает)
    if *transactionInput.Type != "expense" && *transactionInput.Type != "income" {
        c.JSON(http.StatusBadRequest, gin.H{"error": "Неверное значение для Type. Допустимо: expense или income"})
        return
    }
    transaction.Type = *transactionInput.Type
}

transaction.UpdatedAt = time.Now()

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

// DailyExpenseSummary представляет суммарные расходы за день
type DailyExpenseSummary struct {
	// Добавляем эти поля для сканирования данных из SQL-запроса
	CategoryID   uint   `json:"-" gorm:"column:category_id"`   // Маппинг к category_id из SELECT
	CategoryName string `json:"-" gorm:"column:category_name"` // Маппинг к category_name из SELECT

	Date        time.Time `json:"date"` // Это поле может быть не нужно для агрегированной суммы, но оставлено для полноты
	TotalAmount float64   `json:"total_amount"`
	// Category    models.Category `json:"category"` // Это поле больше не нужно, так как мы заполняем "category" вручную
}

// GetDailySummary возвращает суммарные расходы по категориям за определенный день
func GetDailySummary(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	dateStr := c.Query("date") // Получаем дату из параметра запроса
	if dateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Параметр 'date' обязателен (формат YYYY-MM-DD)"})
		return
	}

	parsedDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат даты. Используйте YYYY-MM-DD"})
		return
	}

	// Устанавливаем начало и конец дня
	startOfDay := parsedDate
	endOfDay := parsedDate.Add(24*time.Hour - time.Second)

	var summaries []DailyExpenseSummary

	// SQL-запрос для группировки по категориям за день
	// JOIN с таблицей категорий для получения названия категории
	result := database.DB.Table("transactions").
		Select("transactions.category_id AS category_id, SUM(transactions.amount) AS total_amount, categories.name AS category_name"). // Используем AS для соответствия полям структуры
		Joins("LEFT JOIN categories ON transactions.category_id = categories.id").
		Where("transactions.user_id = ? AND transactions.date >= ? AND transactions.date <= ?", userID, startOfDay, endOfDay).
		Group("transactions.category_id, categories.id, categories.name").
		Order("total_amount DESC").
		Scan(&summaries) // Сканируем результат в нашу структуру DailyExpenseSummary

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось получить дневную статистику: " + result.Error.Error()})
		return
	}

	// Форматируем результат для JSON-ответа
	formattedSummaries := []map[string]interface{}{}
	for _, s := range summaries {
		formattedSummaries = append(formattedSummaries, map[string]interface{}{
			"category": map[string]interface{}{
				"id":   s.CategoryID,   // Теперь доступно напрямую
				"name": s.CategoryName, // Теперь доступно напрямую
			},
			"total_amount": s.TotalAmount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"date": dateStr, "summary": formattedSummaries})
}

// GetPeriodSummary возвращает суммарные расходы по категориям за произвольный период
func GetPeriodSummary(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	beginDateStr := c.Query("begin_date")
	endDateStr := c.Query("end_date")

	if beginDateStr == "" || endDateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Параметры 'begin_date' и 'end_date' обязательны (формат YYYY-MM-DD)"})
		return
	}

	parsedBeginDate, err := time.Parse("2006-01-02", beginDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат begin_date. Используйте YYYY-MM-DD"})
		return
	}

	parsedEndDate, err := time.Parse("2006-01-02", endDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Неверный формат end_date. Используйте YYYY-MM-DD"})
		return
	}
	// Учитываем весь последний день
	parsedEndDate = parsedEndDate.Add(24*time.Hour - time.Second)

	var summaries []DailyExpenseSummary // Используем ту же структуру для результата

	result := database.DB.Table("transactions").
		Select("transactions.category_id AS category_id, SUM(transactions.amount) AS total_amount, categories.name AS category_name").
		Joins("LEFT JOIN categories ON transactions.category_id = categories.id").
		Where("transactions.user_id = ? AND transactions.date >= ? AND transactions.date <= ?", userID, parsedBeginDate, parsedEndDate).
		Group("transactions.category_id, categories.id, categories.name").
		Order("total_amount DESC").
		Scan(&summaries)

	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось получить статистику за период: " + result.Error.Error()})
		return
	}

	formattedSummaries := []map[string]interface{}{}
	for _, s := range summaries {
		formattedSummaries = append(formattedSummaries, map[string]interface{}{
			"category": map[string]interface{}{
				"id":   s.CategoryID,
				"name": s.CategoryName,
			},
			"total_amount": s.TotalAmount,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"begin_date": beginDateStr,
		"end_date":   c.Query("end_date"), // Используем оригинальную строку для ответа
		"summary":    formattedSummaries,
	})
}
