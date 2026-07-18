package models

import "time"

// SalaryCycle represents one salary period. Created when the user clicks
// "Start New Cycle". cycle_start_at is the authoritative timestamp used to
// filter income/expenses on the dashboard.
type SalaryCycle struct {
	ID              uint           `json:"id" gorm:"primaryKey"`
	UserID          uint           `json:"user_id" gorm:"not null;index"`
	BaseSalary      float64        `json:"base_salary" gorm:"not null;default:0"`
	Bonuses         float64        `json:"bonuses" gorm:"default:0"`
	TotalIncome     float64        `json:"total_income" gorm:"not null"`
	NeedsPct        float64        `json:"needs_pct" gorm:"not null;default:50"`
	WantsPct        float64        `json:"wants_pct" gorm:"not null;default:30"`
	SavingsPct      float64        `json:"savings_pct" gorm:"not null;default:20"`
	NeedsLimit      float64        `json:"needs_limit"`
	WantsLimit      float64        `json:"wants_limit"`
	SavingsLimit    float64        `json:"savings_limit"`
	FixedNeedsTotal float64        `json:"fixed_needs_total"`
	FixedWantsTotal float64        `json:"fixed_wants_total"`
	VarNeedsBudget  float64        `json:"var_needs_budget"`
	VarWantsBudget  float64        `json:"var_wants_budget"`
	FixedExpCategoryID    uint         `json:"fixed_exp_category_id"    gorm:"default:0"`
	SavedMoneyCategoryID  uint         `json:"saved_money_category_id"  gorm:"default:0"`
	CycleStartAt    time.Time      `json:"cycle_start_at" gorm:"not null"`
	NextPaydayAt    *time.Time     `json:"next_payday_at"`
	// StoppedAt marks a soft-stopped cycle (e.g. job loss). A stopped cycle is
	// never "active" — the user falls back to the no-salary monthly budget — but
	// the row and all its history are preserved. nil = not stopped.
	StoppedAt       *time.Time     `json:"stopped_at"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	FixedExpenses   []FixedExpense `json:"fixed_expenses" gorm:"foreignKey:SalaryCycleID"`
}

// FixedExpense is a recurring expense declared at cycle start.
// category_type "need" (rent, utilities) deducts from Needs ceiling;
// "want" (subscriptions) deducts from Wants ceiling.
// Fixed expenses are NEVER deducted from the Savings pool.
type FixedExpense struct {
	ID            uint      `json:"id" gorm:"primaryKey"`
	SalaryCycleID uint      `json:"salary_cycle_id" gorm:"not null;index"`
	UserID        uint      `json:"user_id" gorm:"not null;index"`
	Amount        float64   `json:"amount" gorm:"not null"`
	Description   string    `json:"description"`
	CategoryType  string    `json:"category_type" gorm:"default:'need'"` // need | want
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}
