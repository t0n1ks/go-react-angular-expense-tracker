package database

import (
	"log"
	"time"

	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

const liteRetagName = "2.27.2-lite-retag"

// liteTagCutoff is when the mode tag went live in production (2.27). Rows
// created before it carry "extended" only because the tag didn't exist yet.
var liteTagCutoff = time.Date(2026, 10, 31, 3, 49, 0, 0, time.UTC)

// retagPreUpdateLiteEntries is a one-time, reversible step: for each user who
// is in Lite now and never had a salary cycle, the entries made before the
// mode tag existed were Lite entries, so they are re-tagged "lite". It writes
// ONLY transactions.mode / lite_period (no amount, date, category,
// description or timestamp) and records every id in lite_retag_backups first.
// Users with any cycle trace are left untouched. Runs once (data_migrations).
func retagPreUpdateLiteEntries() {
	if err := DB.AutoMigrate(&models.DataMigration{}, &models.LiteRetagBackup{}); err != nil {
		log.Printf("Warning: Lite re-tag skipped (tables): %v", err)
		return
	}
	var done int64
	DB.Model(&models.DataMigration{}).Where("name = ?", liteRetagName).Count(&done)
	if done > 0 {
		return
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		// Users in Lite now with no trace of ever having a cycle: no cycle row,
		// no cycle edit history, no savings/budget-transfer entries (even
		// deleted ones) and no "Variable budget" system category.
		var users []models.User
		if err := tx.Select("id", "lite_period").
			Where("lite_mode = ?", true).
			Where("NOT EXISTS (SELECT 1 FROM salary_cycles s WHERE s.user_id = users.id)").
			Where("NOT EXISTS (SELECT 1 FROM salary_cycle_audits a WHERE a.user_id = users.id)").
			Where("NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = users.id AND t.type IN ('savings_deposit', 'savings_withdrawal', 'budget_transfer'))").
			Where("NOT EXISTS (SELECT 1 FROM categories c WHERE c.user_id = users.id AND c.translation_key = 'category.variable_budget')").
			Find(&users).Error; err != nil {
			return err
		}

		var total, affectedUsers int
		for _, u := range users {
			var ids []uint
			if err := tx.Model(&models.Transaction{}).
				Where("user_id = ? AND mode = ? AND created_at < ?", u.ID, models.TxModeExtended, liteTagCutoff).
				Pluck("id", &ids).Error; err != nil {
				return err
			}
			if len(ids) == 0 {
				continue
			}
			log.Printf("Lite re-tag: user=%d will re-tag %d entr(y/ies)", u.ID, len(ids))
			backups := make([]models.LiteRetagBackup, len(ids))
			for i, id := range ids {
				backups[i] = models.LiteRetagBackup{TransactionID: id, UserID: u.ID}
			}
			if err := tx.CreateInBatches(backups, 200).Error; err != nil {
				return err
			}
			// Raw UPDATE: only the tag columns change (updated_at stays).
			if err := tx.Exec("UPDATE transactions SET mode = ?, lite_period = ? WHERE id IN ?",
				models.TxModeLite, u.LitePeriod, ids).Error; err != nil {
				return err
			}
			total += len(ids)
			affectedUsers++
		}
		log.Printf("Lite re-tag: %d entr(y/ies) of %d user(s) moved to Lite (of %d Lite user(s) without a cycle); revert: UPDATE transactions SET mode='extended', lite_period=0 WHERE id IN (SELECT transaction_id FROM lite_retag_backups)",
			total, affectedUsers, len(users))
		return tx.Create(&models.DataMigration{Name: liteRetagName, RanAt: time.Now()}).Error
	})
	if err != nil {
		log.Printf("Warning: Lite re-tag failed and was rolled back (nothing changed): %v", err)
	}
}
