// backend/models/category.go
package models

import "time"

type Category struct {
	ID     uint   `json:"id" gorm:"primaryKey"`
	UserID uint   `json:"user_id" gorm:"not null"`
	Name   string `json:"name" gorm:"not null"`
	// TranslationKey is set ONLY for the app's built-in/default categories, so
	// they render in the current UI language. Empty for user-created categories
	// (and cleared when a default is renamed — it becomes the user's own). The
	// stored Name is kept unchanged for backend name-based lookups.
	TranslationKey string    `json:"translation_key" gorm:"default:''"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	// Transactions []Transaction `json:"-" gorm:"foreignKey:CategoryID"` // Опционально: если нужна обратная связь. Пока не используем
}
