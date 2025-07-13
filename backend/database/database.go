// backend/database/database.go
package database

import (
	"log"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models" // Обновите путь!
)

var DB *gorm.DB // Глобальная переменная для хранения подключения к БД

func Connect() {
	var err error
	// Инициализируем соединение с SQLite базой данных.
	// Файл базы данных будет создан в корневой папке Go-бэкенда.
	DB, err = gorm.Open(sqlite.Open("expenses.db"), &gorm.Config{})
	if err != nil {
		log.Fatalf("Не удалось подключиться к базе данных: %v", err)
	}

	log.Println("Успешное подключение к базе данных!")

	// Автоматическая миграция моделей в таблицы базы данных.
	// Если таблиц нет, GORM их создаст. Если есть, добавит новые колонки,
	// но не будет удалять или изменять существующие колонки без дополнительных настроек.
	err = DB.AutoMigrate(&models.User{}, &models.Category{}, &models.Transaction{})
	if err != nil {
		log.Fatalf("Не удалось выполнить миграцию базы данных: %v", err)
	}

	log.Println("Миграция базы данных успешно завершена!")
}