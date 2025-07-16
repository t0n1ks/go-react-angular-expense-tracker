package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"github.com/golang-jwt/jwt/v5"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database" // Обновите путь!
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"   // Обновите путь!
)

var jwtSecret = []byte("supersecretkey_change_me_in_production") // TODO: Замените на реальный секретный ключ

// RegisterUser обрабатывает запрос на регистрацию нового пользователя
func RegisterUser(c *gin.Context) {
	var user models.User
	if err := c.ShouldBindJSON(&user); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}


	// Хешируем пароль перед сохранением
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось хешировать пароль"})
		return
	}
	user.Password = string(hashedPassword)


	// Устанавливаем CreatedAt и UpdatedAt
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	// Сохраняем пользователя в базе данных
	result := database.DB.Create(&user)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать пользователя: " + result.Error.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Пользователь успешно зарегистрирован", "user_id": user.ID, "username": user.Username})
}

// LoginUser обрабатывает запрос на вход пользователя
func LoginUser(c *gin.Context) {
	var loginRequest struct {
		Username string `json:"username"`
		Password string `json:"json"` // !!! Исправить: Здесь должно быть `json:"password"`, а не `json:"json"` !!!
	}
	if err := c.ShouldBindJSON(&loginRequest); err != nil {
	
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}


	var user models.User
	// Ищем пользователя по имени пользователя
	result := database.DB.Where("username = ?", loginRequest.Username).First(&user)
	if result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверное имя пользователя или пароль"})
		return
	}


	// Проверяем хешированный пароль
	err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginRequest.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверное имя пользователя или пароль"})
		return
	}

	// Генерируем JWT токен
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(), // Токен истекает через 24 часа
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось сгенерировать токен"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Вход выполнен успешно", "token": tokenString})
}

// GetJWTSecret возвращает секретный ключ для JWT.
// Используется middleware для валидации токена.
func GetJWTSecret() []byte {
	return jwtSecret
}