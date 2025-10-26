// backend/models/transaction.go
package models

import "time"

type Transaction struct {
	ID          uint      `json:"id" gorm:"primaryKey"`
	UserID      uint      `json:"user_id" gorm:"not null"`
	CategoryID  uint      `json:"category_id" gorm:"not null"`
	Category    Category  `json:"category"` // Добавляем поле Category для GORM.Preload
	Amount      float64   `json:"amount" gorm:"type:numeric(10,2);not null"`
	Description string    `json:"description"`
	Date        time.Time `json:"date" gorm:"not null"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	Type        string    `gorm:"type:varchar(10);not null;default:'expense'" json:"type"`
}
