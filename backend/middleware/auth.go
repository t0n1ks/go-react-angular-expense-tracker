// backend/middleware/auth.go
package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/handlers" // Для доступа к jwtSecret
)

// AuthMiddleware проверяет JWT токен в заголовке Authorization
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Требуется токен аутентификации"})
			c.Abort() // Прерываем выполнение запроса
			return
		}

		// Токен должен быть в формате "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверный формат токена"})
			c.Abort()
			return
		}

		tokenString := parts[1]

		// Парсим и валидируем токен
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			// Проверяем метод подписи
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("неожиданный метод подписи: %v", token.Header["alg"])
			}
			// Возвращаем секретный ключ для валидации
			return handlers.GetJWTSecret(), nil // Используем функцию для получения секрета
		})

		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Недействительный токен: " + err.Error()})
			c.Abort()
			return
		}

		if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
			// Сохраняем user_id в контексте Gin для дальнейшего использования в обработчиках
			userID := uint(claims["user_id"].(float64)) // JWT парсит числа как float64
			c.Set("userID", userID)
			c.Next() // Продолжаем выполнение запроса
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Недействительный токен"})
			c.Abort()
		}
	}
}