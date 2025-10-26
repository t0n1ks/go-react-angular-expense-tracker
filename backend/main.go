// backend/main.go
package main

import (
	"fmt" // <-- Добавьте эту строку
	"time"

	"log"

	"net/http" // Добавили для gin.H

	"github.com/gin-gonic/gin"

	"github.com/gin-contrib/cors"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/handlers"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/middleware"
)

func main() {
	database.Connect()

	router := gin.Default()

	// --- Настройка CORS ---
	// В продакшене настройте разрешенные домены более строго!
	// Здесь мы разрешаем запросы от localhost:5173 (React) и localhost:4200 (Angular).
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173", "http://localhost:4200"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))
	// --- Конец настройки CORS ---

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
			userID, exists := c.Get("userID")
			if !exists {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "userID не найден в контексте"})
				return
			}
			c.JSON(http.StatusOK, gin.H{"message": fmt.Sprintf("Доступ разрешен для пользователя ID: %d", userID)})
		})

		// Маршруты для управления категориями
		protected.POST("/categories", handlers.CreateCategory)
		protected.GET("/categories", handlers.GetCategories)
		protected.PUT("/categories/:id", handlers.UpdateCategory)
		protected.DELETE("/categories/:id", handlers.DeleteCategory)

		// Маршруты для управления транзакциями
		protected.POST("/transactions", handlers.CreateTransaction)
		protected.GET("/transactions", handlers.GetTransactions)
		protected.GET("/transactions/:id", handlers.GetTransactionByID)
		protected.PUT("/transactions/:id", handlers.UpdateTransaction)
		protected.DELETE("/transactions/:id", handlers.DeleteTransaction)

		// Маршруты для статистики расходов
		protected.GET("/summary/daily", handlers.GetDailySummary)
		protected.GET("/summary/period", handlers.GetPeriodSummary)
	}

	log.Fatal(router.Run(":8080"))
}
