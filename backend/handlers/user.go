package handlers

import (
	"log" // <--- Убедитесь, что эта строка есть
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"github.com/golang-jwt/jwt/v5"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

var jwtSecret = []byte("supersecretkey_change_me_in_production")

// RegisterUser обрабатывает запрос на регистрацию нового пользователя
func RegisterUser(c *gin.Context) {
	var user models.User
	if err := c.ShouldBindJSON(&user); err != nil {
		log.Printf("RegisterUser: Ошибка парсинга JSON: %v", err) // <-- ДОБАВЛЕНО
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// === Отладочный лог: Пароль до хеширования ===
	log.Printf("RegisterUser: Пароль (до хеширования): %q", user.Password) // <-- ДОБАВЛЕНО

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("RegisterUser: Ошибка хеширования пароля: %v", err) // <-- ДОБАВЛЕНО
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось хешировать пароль"})
		return
	}
	user.Password = string(hashedPassword)

	// === Отладочный лог: Хешированный пароль ===
	log.Printf("RegisterUser: Хешированный пароль: %s", user.Password) // <-- ДОБАВЛЕНО

	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	result := database.DB.Create(&user)
	if result.Error != nil {
		log.Printf("RegisterUser: Ошибка сохранения пользователя: %v", result.Error) // <-- ДОБАВЛЕНО
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Не удалось создать пользователя: " + result.Error.Error()})
		return
	}

	log.Printf("RegisterUser: Пользователь ID %d (%s) успешно зарегистрирован", user.ID, user.Username) // <-- ДОБАВЛЕНО
	c.JSON(http.StatusCreated, gin.H{"message": "Пользователь успешно зарегистрирован", "user_id": user.ID, "username": user.Username})
}

// LoginUser обрабатывает запрос на вход пользователя
func LoginUser(c *gin.Context) {
	var loginRequest struct {
		Username string `json:"username"`
		Password string `json:"password"` // Убедитесь, что здесь `json:"password"`
	}
	if err := c.ShouldBindJSON(&loginRequest); err != nil {
		log.Printf("LoginUser: Ошибка парсинга JSON: %v", err) // <-- ДОБАВЛЕНО
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// === Отладочный лог: Полученное имя пользователя и пароль ===
	log.Printf("LoginUser: Запрос на вход для пользователя: %q, Пароль (входящий): %q", loginRequest.Username, loginRequest.Password) // <-- ДОБАВЛЕНО

	var user models.User
	result := database.DB.Where("username = ?", loginRequest.Username).First(&user)
	if result.Error != nil {
		log.Printf("LoginUser: Пользователь %q не найден в БД: %v", loginRequest.Username, result.Error) // <-- ДОБАВЛЕНО
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверное имя пользователя или пароль"})
		return
	}

	// === Отладочный лог: Хешированный пароль из БД ===
	log.Printf("LoginUser: Пользователь %q найден. Хешированный пароль из БД: %s", user.Username, user.Password) // <-- ДОБАВЛЕНО

	err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginRequest.Password))
	if err != nil {
		// === Отладочный лог: Ошибка сравнения паролей ===
		log.Printf("LoginUser: Ошибка сравнения паролей для %q: %v", user.Username, err) // <-- ДОБАВЛЕНО
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Неверное имя пользователя или пароль"})
		return
	}

	log.Printf("LoginUser: Пароль для %q совпал. Генерация токена.", user.Username) // <-- ДОБАВЛЕНО

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id":  user.ID,
		"username": user.Username,
		"exp":      time.Now().Add(time.Hour * 24).Unix(),
	})

	tokenString, err := token.SignedString(jwtSecret)
	if err != nil {
		log.Printf("LoginUser: Ошибка генерации токена для %q: %v", user.Username, err) // <-- ДОБАВЛЕНО
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