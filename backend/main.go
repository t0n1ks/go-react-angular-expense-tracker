// backend/main.go
package main

import (
	"fmt" // <-- Добавьте эту строку
	"log"
	"net/http" // Добавили для gin.H

	"github.com/gin-gonic/gin"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/handlers"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/middleware" // Обновите путь!
)

func main() {
	database.Connect()

	router := gin.Default()

	// Маршруты для аутентификации (не требуют токена)
	router.POST("/api/register", handlers.RegisterUser)
	router.POST("/api/login", handlers.LoginUser)

	// Тестовый незащищенный маршрут
	router.GET("/api/hello", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "Hello from Go Backend (unprotected)!"})
	})

	// Группа маршрутов, защищенных JWT middleware
	protected := router.Group("/api")
	protected.Use(middleware.AuthMiddleware()) // Применяем middleware ко всем маршрутам в этой группе
	{
		// Пример защищенного маршрута
		protected.GET("/protected", func(c *gin.Context) {
			// Получаем userID из контекста, установленного middleware
			userID, exists := c.Get("userID")
			if !exists {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "userID не найден в контексте"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Доступ разрешен для пользователя ID: %d", userID)})
		})
		// Маршруты для управления категориями (требуют аутентификации)
		protected.POST("/categories", handlers.CreateCategory)
		protected.GET("/categories", handlers.GetCategories)
		protected.PUT("/categories/:id", handlers.UpdateCategory)
		protected.DELETE("/categories/:id", handlers.DeleteCategory)

		// Маршруты для управления транзакциями (требуют аутентификации)
		protected.POST("/transactions", handlers.CreateTransaction)
		protected.GET("/transactions", handlers.GetTransactions)
		protected.GET("/transactions/:id", handlers.GetTransactionByID)
		protected.PUT("/transactions/:id", handlers.UpdateTransaction)
		protected.DELETE("/transactions/:id", handlers.DeleteTransaction)
	}
	protected.GET("/summary/daily", handlers.GetDailySummary)
	protected.GET("/summary/period", handlers.GetPeriodSummary)

	log.Fatal(router.Run(":8080"))
}
