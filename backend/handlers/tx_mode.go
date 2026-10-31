package handlers

import (
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Every transaction carries the mode it was entered in. Extended (full) mode
// and Lite mode keep separate sets: extended reads never see Lite rows, and
// Lite reads see all of the user's Lite rows (the list groups them by month;
// the Lite budget counts the current calendar month). The Lite period number
// is still stored on each Lite row but no read filters by it any more.

// extendedOnly hides Lite rows. All rows from before the mode tag existed
// are "extended" (startup backfill), so for extended-only data every query
// returns exactly what it did before.
func extendedOnly(db *gorm.DB) *gorm.DB {
	return db.Where("COALESCE(transactions.mode, '') <> ?", models.TxModeLite)
}

// liteOnly keeps only Lite rows (every Lite period).
func liteOnly(db *gorm.DB) *gorm.DB {
	return db.Where("transactions.mode = ?", models.TxModeLite)
}

// activeModeScope is the scope for the mode the user is in right now (lists,
// exports, per-mode summaries).
func activeModeScope(user models.User) func(*gorm.DB) *gorm.DB {
	if user.LiteMode {
		return liteOnly
	}
	return extendedOnly
}

// loadModeUser reads only the fields the mode scope needs.
func loadModeUser(uid uint) models.User {
	var u models.User
	database.DB.Select("id", "lite_mode", "lite_period", "lite_started_at").First(&u, uid)
	return u
}

// loadLiteWindowTransactions is loadWindowTransactions over the user's Lite
// rows (the extended loader never returns them).
func loadLiteWindowTransactions(uid uint, w cycleWindow, k cycleClock) []windowTx {
	lo := w.Start.Add(-dateSlack)
	q := database.DB.Scopes(liteOnly).
		Where("user_id = ?", uid).Where("(created_at >= ? OR date >= ?)", lo, lo)
	if w.End != nil {
		hi := w.End.Add(dateSlack)
		q = q.Where("(created_at < ? OR date < ?)", hi, hi)
	}
	var rows []models.Transaction
	q.Find(&rows)

	out := make([]windowTx, 0, len(rows))
	for _, r := range rows {
		if at := k.txEventAt(r); w.contains(at) {
			out = append(out, windowTx{Transaction: r, At: at})
		}
	}
	return out
}

// loadActiveWindowTransactions loads w's rows for the mode the user is in.
func loadActiveWindowTransactions(user models.User, w cycleWindow, k cycleClock) []windowTx {
	if user.LiteMode {
		return loadLiteWindowTransactions(user.ID, w, k)
	}
	return loadWindowTransactions(user.ID, w, k)
}
