package database

import (
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// The one-time re-tag moves only pure-Lite users' pre-update entries to Lite,
// changes nothing but the tag, records every id, runs once and reverts exactly.
func TestRetagPreUpdateLiteEntries(t *testing.T) {
	db := openStartupDB(t)
	pre := liteTagCutoff.Add(-24 * time.Hour)
	post := liteTagCutoff.Add(time.Hour)

	mk := func(name string, lite bool) models.User {
		u := models.User{Username: name, Password: "x", LiteMode: lite, LitePeriod: 1}
		db.Create(&u)
		return u
	}
	pureLite := mk("purelite", true)
	cycleLite := mk("cyclelite", true) // in Lite but had a cycle
	extended := mk("extended", false)  // not in Lite
	db.Create(&models.SalaryCycle{UserID: cycleLite.ID, CycleStartAt: pre})

	cat := models.Category{UserID: pureLite.ID, Name: "Food"}
	db.Create(&cat)
	add := func(u models.User, amount float64, created time.Time, mode string) models.Transaction {
		tx := models.Transaction{UserID: u.ID, CategoryID: cat.ID, Amount: amount, Description: "d",
			Date: dateOnly(2026, 9, 15), Type: "expense", Mode: mode, CreatedAt: created, UpdatedAt: created}
		db.Create(&tx)
		return tx
	}
	old1 := add(pureLite, 11, pre, models.TxModeExtended)
	old2 := add(pureLite, 12, pre, models.TxModeExtended)
	newer := add(pureLite, 13, post, models.TxModeExtended) // made in extended after the tag existed
	cycOld := add(cycleLite, 14, pre, models.TxModeExtended)
	extOld := add(extended, 15, pre, models.TxModeExtended)
	var before models.Transaction
	db.First(&before, old1.ID)

	runStartupMaintenance()

	mode := func(id uint) string {
		var tx models.Transaction
		db.First(&tx, id)
		return tx.Mode
	}
	for _, id := range []uint{old1.ID, old2.ID} {
		if m := mode(id); m != models.TxModeLite {
			t.Fatalf("pre-update entry %d of a pure-Lite user: mode %q, want lite", id, m)
		}
	}
	for _, id := range []uint{newer.ID, cycOld.ID, extOld.ID} {
		if m := mode(id); m != models.TxModeExtended {
			t.Fatalf("entry %d must stay extended, got %q", id, m)
		}
	}
	var after models.Transaction
	db.First(&after, old1.ID)
	if after.Amount != before.Amount || after.Description != before.Description || !after.Date.Equal(before.Date) ||
		after.CategoryID != before.CategoryID || after.Type != before.Type || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("content changed:\n before %+v\n after  %+v", before, after)
	}
	var backups int64
	db.Model(&models.LiteRetagBackup{}).Count(&backups)
	if backups != 2 {
		t.Fatalf("backup rows = %d, want 2", backups)
	}

	// Runs once: a later startup never re-tags anything else.
	db.Model(&models.Transaction{}).Where("id = ?", old2.ID).Update("mode", models.TxModeExtended)
	runStartupMaintenance()
	if m := mode(old2.ID); m != models.TxModeExtended {
		t.Fatalf("re-tag ran twice")
	}

	// The documented revert restores the tag exactly.
	db.Exec("UPDATE transactions SET mode = 'extended', lite_period = 0 WHERE id IN (SELECT transaction_id FROM lite_retag_backups)")
	if m := mode(old1.ID); m != models.TxModeExtended {
		t.Fatalf("revert failed: %q", m)
	}
}
