package handlers

import (
	"time"

	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Every transaction carries the mode it was entered in. Extended (full) mode
// and Lite mode keep separate sets: extended reads never see Lite rows, and
// Lite reads see only the rows of the user's current Lite period. Rows are
// never moved between modes or rewritten.

// extendedOnly hides Lite rows. All rows from before the mode tag existed
// are "extended" (startup backfill), so for extended-only data every query
// returns exactly what it did before.
func extendedOnly(db *gorm.DB) *gorm.DB {
	return db.Where("COALESCE(transactions.mode, '') <> ?", models.TxModeLite)
}

// litePeriodOnly keeps only the rows of one Lite period.
func litePeriodOnly(period uint) func(*gorm.DB) *gorm.DB {
	return func(db *gorm.DB) *gorm.DB {
		return db.Where("transactions.mode = ? AND transactions.lite_period = ?", models.TxModeLite, period)
	}
}

// activeModeScope is the scope for the mode the user is in right now (lists,
// exports, per-mode summaries).
func activeModeScope(user models.User) func(*gorm.DB) *gorm.DB {
	if user.LiteMode {
		return litePeriodOnly(user.LitePeriod)
	}
	return extendedOnly
}

// loadModeUser reads only the fields the mode scope needs.
func loadModeUser(uid uint) models.User {
	var u models.User
	database.DB.Select("id", "lite_mode", "lite_period", "lite_started_at").First(&u, uid)
	return u
}

// loadLiteWindowTransactions is loadWindowTransactions over one Lite period's
// rows (the extended loader never returns them).
func loadLiteWindowTransactions(uid, period uint, w cycleWindow, k cycleClock) []windowTx {
	lo := w.Start.Add(-dateSlack)
	q := database.DB.Scopes(litePeriodOnly(period)).
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
		return loadLiteWindowTransactions(user.ID, user.LitePeriod, w, k)
	}
	return loadWindowTransactions(user.ID, w, k)
}

// liteStartDay is local midnight of the day the current Lite period began
// (Lite counts expenses dated on/after it); zero when unknown.
func liteStartDay(user models.User, loc *time.Location) time.Time {
	if user.LiteStartedAt == nil {
		return time.Time{}
	}
	s := user.LiteStartedAt.In(loc)
	return time.Date(s.Year(), s.Month(), s.Day(), 0, 0, 0, 0, loc)
}
