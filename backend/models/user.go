package models

import "gorm.io/gorm"

type User struct {
	gorm.Model
	Username            string  `gorm:"uniqueIndex;not null" json:"username"`
	Password            string  `gorm:"not null" json:"-"`
	Currency            string  `gorm:"default:'USD'" json:"currency"`
	AIAdviceEnabled     bool    `gorm:"default:true"  json:"ai_advice_enabled"`
	AIHumorEnabled      bool    `gorm:"default:true"  json:"ai_humor_enabled"`
	MonthlySpendingGoal float64 `gorm:"default:0" json:"monthly_spending_goal"`
	ExpectedSalary      float64 `gorm:"default:0" json:"expected_salary"`
	PaydayMode          string  `gorm:"default:'smart'" json:"payday_mode"`
	FixedPayday         int     `gorm:"default:0" json:"fixed_payday"`
	ManualNextPayday    string  `gorm:"default:''" json:"manual_next_payday"`
	// HeartsCount is retired (the companion's health replaced the hearts in
	// Phase 2.21); the column and its values are kept, nothing reads them.
	HeartsCount     int `gorm:"default:3" json:"-"`
	ReputationScore     int     `gorm:"default:0" json:"reputation_score"`
	// LiteMode: opt-in "track-only" mode. Hides salary-cycle/analytics UI and
	// suppresses Python analytics/forecast calls. Advisor (joke/fact) stays on.
	LiteMode bool `gorm:"default:false" json:"lite_mode"`
	// Timezone is the IANA zone last reported by the user's device
	// (X-User-Timezone). Cycle boundaries are evaluated in it; "" = UTC.
	Timezone string `gorm:"type:varchar(64);default:''" json:"timezone"`
}
