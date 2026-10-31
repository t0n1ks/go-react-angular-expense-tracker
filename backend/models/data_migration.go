package models

import "time"

// DataMigration marks a one-time data step as done (by name), so it never
// runs twice.
type DataMigration struct {
	Name  string    `gorm:"primaryKey;type:varchar(64)" json:"name"`
	RanAt time.Time `json:"ran_at"`
}

// LiteRetagBackup records each transaction the one-time Lite re-tag moved
// from "extended" to "lite", so it can be reverted exactly:
//
//	UPDATE transactions SET mode = 'extended', lite_period = 0
//	WHERE id IN (SELECT transaction_id FROM lite_retag_backups);
type LiteRetagBackup struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	TransactionID uint      `gorm:"not null;uniqueIndex" json:"transaction_id"`
	UserID        uint      `gorm:"not null;index" json:"user_id"`
	CreatedAt     time.Time `json:"created_at"`
}

// LiteCycleReconcile records each account whose Lite mode was switched off
// because a salary cycle was current at the same time (the two are mutually
// exclusive: an active cycle implies Lite off). Only users.lite_mode changed —
// no cycle or transaction is touched — so it reverts exactly:
//
//	UPDATE users SET lite_mode = true
//	WHERE id IN (SELECT user_id FROM lite_cycle_reconciles)
type LiteCycleReconcile struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	CycleID   uint      `gorm:"not null" json:"cycle_id"` // the cycle that was current
	Source    string    `gorm:"type:varchar(32)" json:"source"`
	CreatedAt time.Time `json:"created_at"`
}
