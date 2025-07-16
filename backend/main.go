// backend/main.go
package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database" // Обновите путь!
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/handlers" // Обновите путь!
)

func main() {
	// Подключаемся к базе данных
	database.Connect()

	// Инициализируем Gin-роутер
	router := gin.Default()

	// Маршруты для аутентификации пользователей
	router.POST("/api/register", handlers.RegisterUser)
	router.POST("/api/login", handlers.LoginUser)

	// Запускаем сервер Gin на порту 8080
	log.Fatal(router.Run(":8080")) // Gin уже включает в себя свой http-сервер
}