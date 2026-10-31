package handlers

import (
	"log"

	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Lite mode and a current salary cycle are mutually exclusive:
//   - switching Lite OFF is always allowed, in every state;
//   - switching Lite ON is refused while a cycle is current (stop it first);
//   - starting or resuming a cycle switches Lite off;
//   - an account found with both (e.g. a cycle that became current again after
//     Lite was switched on) leaves Lite: an active cycle implies Lite off.

// currentCycleOf returns the user's cycle governing the budget now, or nil.
func currentCycleOf(uid uint, k cycleClock) *models.SalaryCycle {
	cycles, err := loadUserCycles(uid)
	if err != nil {
		return nil
	}
	return k.currentCycle(cycles)
}

// leaveLiteForCycle switches Lite off for an account that has a current cycle,
// recording it in lite_cycle_reconciles (reversible). Only users.lite_mode
// changes — no cycle, transaction or Lite period. Reports whether it did.
func leaveLiteForCycle(uid, cycleID uint, source string) bool {
	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&models.LiteCycleReconcile{UserID: uid, CycleID: cycleID, Source: source}).Error; err != nil {
			return err
		}
		return tx.Exec("UPDATE users SET lite_mode = ? WHERE id = ?", false, uid).Error
	})
	if err != nil {
		log.Printf("lite/cycle reconcile: user=%d err=%v (unchanged)", uid, err)
		return false
	}
	log.Printf("lite/cycle reconcile: user=%d cycle=%d current while in Lite: Lite off (%s)", uid, cycleID, source)
	return true
}
