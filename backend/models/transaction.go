// backend/models/transaction.go
package models

import (
	"time"

	"gorm.io/gorm"
)

type Transaction struct {
	ID          uint      `json:"id"          gorm:"primaryKey"`
	UserID      uint      `json:"user_id"     gorm:"not null"`
	CategoryID  uint      `json:"category_id" gorm:"not null"`
	Category    Category  `json:"category"`
	Amount      float64   `json:"amount"      gorm:"type:numeric(10,2);not null"`
	Description string    `json:"description"`
	Date        time.Time `json:"date"        gorm:"not null"`
	Type        string    `json:"type"        gorm:"type:varchar(30);not null;default:'expense'"`
	IncomeType  string    `json:"income_type" gorm:"type:varchar(20);not null;default:'one_time'"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	// Soft-delete: GORM v2 automatically filters deleted_at IS NULL on all queries.
	DeletedAt gorm.DeletedAt `json:"-"           gorm:"index"`
}
