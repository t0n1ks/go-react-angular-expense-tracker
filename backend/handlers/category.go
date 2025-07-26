// backend/handlers/category.go
package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database" // Обновите путь!
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"   // Обновите путь!
)

// CreateCategory создает новую категорию для аутентифицированного пользователя
func CreateCategory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	var categoryInput struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&categoryInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	category := models.Category{
		UserID:    userID.(uint), // Приводим interface{} к uint
		Name:      categoryInput.Name,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	result := database.DB.Create(&category)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать категорию: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Категория успешно создана", "category": category})
}

// GetCategories возвращает все категории для аутентифицированного пользователя
func GetCategories(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	var categories []models.Category
	// Ищем категории, принадлежащие текущему пользователю
	result := database.DB.Where("user_id = ?", userID).Find(&categories)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось получить категории: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

// UpdateCategory обновляет существующую категорию
func UpdateCategory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	categoryID := c.Param("id") // Получаем ID категории из URL

	var category models.Category
	// Ищем категорию по ID и принадлежности текущему пользователю
	result := database.DB.Where("id = ? AND user_id = ?", categoryID, userID).First(&category)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Категория не найдена или не принадлежит вам"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при получении категории: " + result.Error.Error()})
		}
		return
	}

	var categoryInput struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&categoryInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	category.Name = categoryInput.Name
	category.UpdatedAt = time.Now()

	result = database.DB.Save(&category) // Save обновляет запись
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось обновить категорию: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Категория успешно обновлена", "category": category})
}

// DeleteCategory удаляет категорию
func DeleteCategory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Пользователь не аутентифицирован"})
		return
	}

	categoryID := c.Param("id") // Получаем ID категории из URL

	// Проверяем, что категория принадлежит текущему пользователю перед удалением
	var category models.Category
	result := database.DB.Where("id = ? AND user_id = ?", categoryID, userID).First(&category)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Категория не найдена или не принадлежит вам"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Ошибка при получении категории: " + result.Error.Error()})
		}
		return
	}

	result = database.DB.Delete(&category) // Удаляем запись
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось удалить категорию: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Категория успешно удалена"})
}