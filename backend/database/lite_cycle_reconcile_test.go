package database

import (
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// The one-time reconcile moves only accounts with Lite on AND a current cycle
// out of Lite, changes nothing but users.lite_mode, records each one, runs
// once and reverts exactly. Cycles and transactions are untouched.
func TestReconcileLiteWithActiveCycle(t *testing.T) {
	db := openStartupDB(t)
	now := time.Now()
	ago := func(days int) time.Time { return now.Add(-time.Duration(days) * 24 * time.Hour) }
	mk := func(name string, lite bool) models.User {
		u := models.User{Username: name, Password: "x", LiteMode: lite, LitePeriod: 2}
		db.Create(&u)
		return u
	}
	cycle := func(u models.User, start time.Time, stopped, ended *time.Time) models.SalaryCycle {
		payday := start.Add(30 * 24 * time.Hour)
		c := models.SalaryCycle{UserID: u.ID, TotalIncome: 1500, CycleStartAt: start, NextPaydayAt: &payday, StoppedAt: stopped, EndedAt: ended}
		db.Create(&c)
		return c
	}
	stoppedAt, endedAt := ago(1), ago(10)

	stuck := mk("stuck", true) // payday long past, never stopped: current again
	stuckCycle := cycle(stuck, ago(60), nil, nil)
	handed := mk("handed", true) // two cycles, the latest current
	cycle(handed, ago(70), nil, nil)
	handedLatest := cycle(handed, ago(35), nil, nil)
	stopped := mk("stopped", true) // only a stopped cycle: Lite is fine
	cycle(stopped, ago(20), &stoppedAt, nil)
	ended := mk("ended", true) // a recorded end in the past: not current
	cycle(ended, ago(40), nil, &endedAt)
	future := mk("future", true) // starts later: not current yet
	cycle(future, now.Add(48*time.Hour), nil, nil)
	pure := mk("pure", true) // Lite, never a cycle
	ext := mk("ext", false)  // extended with a cycle: nothing to do
	extCycle := cycle(ext, ago(5), nil, nil)

	cat := models.Category{UserID: stuck.ID, Name: "Food"}
	db.Create(&cat)
	tx := models.Transaction{UserID: stuck.ID, CategoryID: cat.ID, Amount: 9, Description: "d",
		Date: ago(2), Type: "expense", Mode: models.TxModeExtended}
	db.Create(&tx)
	var counts0 struct{ Cycles, Tx int64 }
	db.Model(&models.SalaryCycle{}).Count(&counts0.Cycles)
	db.Model(&models.Transaction{}).Count(&counts0.Tx)

	runStartupMaintenance()

	lite := func(u models.User) bool {
		var got models.User
		db.First(&got, u.ID)
		return got.LiteMode
	}
	for _, u := range []models.User{stuck, handed} {
		if lite(u) {
			t.Fatalf("%s: Lite still on beside a current cycle", u.Username)
		}
	}
	for _, u := range []models.User{stopped, ended, future, pure} {
		if !lite(u) {
			t.Fatalf("%s: Lite switched off, but no cycle is current", u.Username)
		}
	}
	if lite(ext) {
		t.Fatal("ext: Lite switched on")
	}

	var recs []models.LiteCycleReconcile
	db.Order("user_id").Find(&recs)
	if len(recs) != 2 || recs[0].UserID != stuck.ID || recs[0].CycleID != stuckCycle.ID ||
		recs[1].UserID != handed.ID || recs[1].CycleID != handedLatest.ID {
		t.Fatalf("records: %+v", recs)
	}

	// Data intact: same rows, cycles unchanged, Lite period kept.
	var counts1 struct{ Cycles, Tx int64 }
	db.Model(&models.SalaryCycle{}).Count(&counts1.Cycles)
	db.Model(&models.Transaction{}).Count(&counts1.Tx)
	if counts0 != counts1 {
		t.Fatalf("row counts changed: %+v → %+v", counts0, counts1)
	}
	var c models.SalaryCycle
	db.First(&c, stuckCycle.ID)
	if c.StoppedAt != nil || c.EndedAt != nil || c.TotalIncome != 1500 {
		t.Fatalf("cycle changed: %+v", c)
	}
	db.First(&c, extCycle.ID)
	if c.StoppedAt != nil {
		t.Fatal("ext cycle changed")
	}
	var txAfter models.Transaction
	db.First(&txAfter, tx.ID)
	if txAfter.Amount != 9 || txAfter.Mode != models.TxModeExtended {
		t.Fatalf("transaction changed: %+v", txAfter)
	}
	var su models.User
	db.First(&su, stuck.ID)
	if su.LitePeriod != 2 {
		t.Fatalf("Lite period changed: %d", su.LitePeriod)
	}

	// Runs once: switching Lite back on and restarting changes nothing.
	db.Exec("UPDATE users SET lite_mode = true WHERE id = ?", stuck.ID)
	runStartupMaintenance()
	if !lite(stuck) {
		t.Fatal("reconcile ran twice")
	}

	// Revert restores exactly the recorded accounts.
	db.Exec("UPDATE users SET lite_mode = true WHERE id IN (SELECT user_id FROM lite_cycle_reconciles)")
	if !lite(handed) || lite(ext) {
		t.Fatal("revert restored the wrong accounts")
	}
}
