package models

import "gorm.io/gorm"

type User struct {
	gorm.Model
	Username            string  `gorm:"uniqueIndex;not null" json:"username"`
	Password            string  `gorm:"not null" json:"password"`
	Currency            string  `gorm:"default:'USD'" json:"currency"`
	AIAdviceEnabled     bool    `json:"ai_advice_enabled"`
	AIHumorEnabled      bool    `json:"ai_humor_enabled"`
	MonthlySpendingGoal float64 `gorm:"default:0" json:"monthly_spending_goal"`
	ExpectedSalary      float64 `gorm:"default:0" json:"expected_salary"`
}
