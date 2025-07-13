// backend/models/transaction.go
package models

import "time"

type Transaction struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	UserID      uint      `json:"user_id" gorm:"not null"`    // Связь с пользователем
	CategoryID  uint      `json:"category_id" gorm:"not null"` // Связь с категорией
	Amount      float64   `json:"amount" gorm:"type:numeric(10,2);not null"` // Денежная сумма
	Description string    `json:"description"`                 // Опциональное описание
	Date        time.Time `json:"date" gorm:"not null"`        // Дата транзакции
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}