package models

import "time"

// CompanionState is the tamagotchi's whole memory for one user: one small row
// (~0.5 KB), never an event log. Health is kept only as a daily baseline —
// everything financial is recomputed from the ledger on each read.
type CompanionState struct {
	UserID uint `gorm:"primaryKey;autoIncrement:false" json:"-"`

	// Health at the end of BaseDay (the user's local YYYY-MM-DD); today's value
	// is one capped step from it towards today's target.
	BaseHealth float64 `json:"-"`
	BaseDay    string  `gorm:"size:10" json:"-"`

	// Weekly star/cow quest.
	LastCatchAt  *time.Time `json:"-"`
	QuestAskedAt *time.Time `json:"-"`

	// Reaction engine memory.
	Band      string     `gorm:"size:8" json:"-"`    // last pace band (hysteresis)
	Overspent bool       `json:"-"`                  // budget was overspent at the last check
	LastTxID  uint       `json:"-"`                  // newest transaction already considered
	Fired     string     `gorm:"type:text" json:"-"` // JSON {type: unix seconds last shown}
	Reactions string     `gorm:"type:text" json:"-"` // JSON {type: [tapped, dismissed]}
	DayKey    string     `gorm:"size:10" json:"-"`   // local day of DayCount
	DayCount  int        `json:"-"`                  // proactive messages shown on DayKey
	LastMsgAt *time.Time `json:"-"`

	CreatedAt time.Time `json:"-"`
	UpdatedAt time.Time `json:"-"`
}
