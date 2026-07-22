package handlers

import (
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func CreateCategory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var input struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Category name cannot be empty"})
		return
	}
	if len(input.Name) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Category name must be 100 characters or fewer"})
		return
	}

	category := models.Category{
		UserID:    userID.(uint),
		Name:      input.Name,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := database.DB.Create(&category).Error; err != nil {
		log.Printf("create category: user=%v err=%v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create category"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Category created successfully", "category": category})
}

func GetCategories(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	var categories []models.Category
	if err := database.DB.Where("user_id = ?", userID).Find(&categories).Error; err != nil {
		log.Printf("get categories: user=%v err=%v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch categories"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

func UpdateCategory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	categoryID := c.Param("id")

	var category models.Category
	if err := database.DB.Where("id = ? AND user_id = ?", categoryID, userID).First(&category).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Category not found or does not belong to you"})
		} else {
			log.Printf("update category fetch: user=%v cat=%v err=%v", userID, categoryID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch category"})
		}
		return
	}

	var input struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Category name cannot be empty"})
		return
	}
	if len(input.Name) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Category name must be 100 characters or fewer"})
		return
	}

	category.Name = input.Name
	// Renaming a default makes it the user's own category → drop the translation
	// key so it is shown verbatim (never re-translated) from now on.
	category.TranslationKey = ""
	category.UpdatedAt = time.Now()

	if err := database.DB.Save(&category).Error; err != nil {
		log.Printf("update category save: user=%v cat=%v err=%v", userID, categoryID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update category"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Category updated successfully", "category": category})
}

func DeleteCategory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}

	categoryIDStr := c.Param("id")
	categoryID, err := strconv.ParseUint(categoryIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid category ID format"})
		return
	}

	var transactionCount int64
	database.DB.Model(&models.Transaction{}).
		Where("category_id = ? AND user_id = ?", uint(categoryID), userID.(uint)).
		Count(&transactionCount)
	if transactionCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "Cannot delete category: it has " + strconv.FormatInt(transactionCount, 10) + " associated transaction(s)"})
		return
	}

	result := database.DB.Where("id = ? AND user_id = ?", uint(categoryID), userID).Delete(&models.Category{})
	if result.Error != nil {
		log.Printf("delete category: user=%v cat=%v err=%v", userID, categoryID, result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete category"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Category not found or does not belong to you"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Category deleted successfully"})
}
