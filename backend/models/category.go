// backend/models/category.go
package models

import "time"

type Category struct {
	ID        uint        `json:"id" gorm:"primaryKey"`
	UserID    uint        `json:"user_id" gorm:"not null"`
	Name      string      `json:"name" gorm:"not null"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
	// Transactions []Transaction `json:"-" gorm:"foreignKey:CategoryID"` // Опционально: если нужна обратная связь. Пока не используем
}