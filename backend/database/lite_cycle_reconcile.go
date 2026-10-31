package database

import (
	"log"
	"sort"
	"time"

	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

const liteCycleReconcileName = "2.38-lite-cycle-reconcile"

// currentCycleID returns the id of the user's cycle that governs the budget
// at now, or 0. Same rule as handlers/cycle_window.go (isCurrent): a cycle is
// current when it is not stopped and now lies in [start, handover), the
// handover being its recorded end or else the next cycle's start. Instants
// only, so the timezone does not matter.
func currentCycleID(cycles []models.SalaryCycle, now time.Time) uint {
	sort.Slice(cycles, func(i, j int) bool { return cycles[i].CycleStartAt.Before(cycles[j].CycleStartAt) })
	for i, c := range cycles {
		if c.StoppedAt != nil || now.Before(c.CycleStartAt) {
			continue
		}
		end := c.EndedAt
		if end == nil {
			for _, o := range cycles[i+1:] {
				if o.ID != c.ID && o.CycleStartAt.After(c.CycleStartAt) {
					t := o.CycleStartAt
					end = &t
					break
				}
			}
		}
		if end == nil || now.Before(*end) {
			return c.ID
		}
	}
	return 0
}

// reconcileLiteWithActiveCycle is a one-time, reversible step for accounts
// with Lite on AND a current salary cycle — a contradiction that locked users
// in Lite. It came from 2.x's gap-free cycles: a cycle used to expire after
// its payday, so users switched Lite on with it expired; it now stays current
// until handed over or stopped, and was current again beside Lite.
//
// Rule: an active cycle implies Lite off (as starting a cycle already does).
// Writes ONLY users.lite_mode; every account is recorded in
// lite_cycle_reconciles first. No cycle, transaction or Lite period changes.
// Runs once (data_migrations); later cases are healed on profile load.
func reconcileLiteWithActiveCycle() {
	if err := DB.AutoMigrate(&models.DataMigration{}, &models.LiteCycleReconcile{}); err != nil {
		log.Printf("Warning: Lite/cycle reconcile skipped (tables): %v", err)
		return
	}
	var done int64
	DB.Model(&models.DataMigration{}).Where("name = ?", liteCycleReconcileName).Count(&done)
	if done > 0 {
		return
	}

	now := time.Now()
	err := DB.Transaction(func(tx *gorm.DB) error {
		var users []models.User
		if err := tx.Select("id").Where("lite_mode = ?", true).Find(&users).Error; err != nil {
			return err
		}
		var ids []uint
		for _, u := range users {
			var cycles []models.SalaryCycle
			if err := tx.Where("user_id = ?", u.ID).Find(&cycles).Error; err != nil {
				return err
			}
			cid := currentCycleID(cycles, now)
			if cid == 0 {
				continue
			}
			log.Printf("Lite/cycle reconcile: user=%d has cycle id=%d current while in Lite: Lite off", u.ID, cid)
			if err := tx.Create(&models.LiteCycleReconcile{UserID: u.ID, CycleID: cid, Source: "startup"}).Error; err != nil {
				return err
			}
			ids = append(ids, u.ID)
		}
		if len(ids) > 0 {
			// Raw UPDATE: only the flag changes (updated_at stays).
			if err := tx.Exec("UPDATE users SET lite_mode = ? WHERE id IN ?", false, ids).Error; err != nil {
				return err
			}
		}
		log.Printf("Lite/cycle reconcile: %d account(s) moved out of Lite (of %d Lite account(s)); revert: UPDATE users SET lite_mode = true WHERE id IN (SELECT user_id FROM lite_cycle_reconciles)",
			len(ids), len(users))
		return tx.Create(&models.DataMigration{Name: liteCycleReconcileName, RanAt: now}).Error
	})
	if err != nil {
		log.Printf("Warning: Lite/cycle reconcile failed and was rolled back (nothing changed): %v", err)
	}
}
