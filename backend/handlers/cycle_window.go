package handlers

import (
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Cycle clock & window: the ONE definition of salary-cycle boundaries ──────
//
// Boundaries are exact UTC instants, evaluated in the user's CURRENT local
// timezone (cycleClock.Loc). Every "is this cycle current?", "which cycle owns
// this transaction?" and "may a new cycle start here?" question goes through
// this file, so no two views (cards, Statistics, AI) can disagree.
//
//   - A cycle owns the half-open window [CycleStartAt, handover).
//   - handover = EndedAt (set when the next cycle starts) or, for cycles
//     created before ended_at existed, the next cycle's start.
//   - A cycle that has not been handed over stays CURRENT after its payday
//     ("payday passed") until the next cycle starts or it is stopped, so no
//     transaction can ever fall into a no-cycle gap.
//   - A stopped cycle is never current; its history window keeps its planned
//     end (end of payday, local time) — stopping never trims the tail.
//   - The payday itself is shared: a new cycle may begin at any instant on or
//     after the old cycle's payday (local), and the old one ends exactly there.

// cycleClock pins "now" and the user's timezone for one evaluation.
type cycleClock struct {
	Now time.Time
	Loc *time.Location
}

func newCycleClock(now time.Time, loc *time.Location) cycleClock {
	if loc == nil {
		loc = time.UTC
	}
	return cycleClock{Now: now.In(loc), Loc: loc}
}

// dayStart is local midnight of t's calendar day in the user's zone.
func (k cycleClock) dayStart(t time.Time) time.Time {
	y, m, d := t.In(k.Loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, k.Loc)
}

// storedDayStart maps a stored date-only value (YYYY-MM-DD persisted as UTC
// midnight, e.g. Transaction.Date or NextPaydayAt) to local midnight of that
// same calendar day.
func (k cycleClock) storedDayStart(d time.Time) time.Time {
	y, m, dd := d.UTC().Date()
	return time.Date(y, m, dd, 0, 0, 0, 0, k.Loc)
}

// storedDate is t's LOCAL calendar day in the date-only storage format.
func (k cycleClock) storedDate(t time.Time) time.Time {
	y, m, d := t.In(k.Loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// today is the user's local calendar day in the date-only storage format.
func (k cycleClock) today() time.Time { return k.storedDate(k.Now) }

// paydayStart is local midnight opening the planned payday; nil when open-ended.
func (k cycleClock) paydayStart(c models.SalaryCycle) *time.Time {
	if c.NextPaydayAt == nil {
		return nil
	}
	t := k.storedDayStart(*c.NextPaydayAt)
	return &t
}

// paydayEnd is local midnight closing the planned payday (calendar arithmetic,
// so a DST change on that day is handled); nil when open-ended.
func (k cycleClock) paydayEnd(c models.SalaryCycle) *time.Time {
	ps := k.paydayStart(c)
	if ps == nil {
		return nil
	}
	t := ps.AddDate(0, 0, 1)
	return &t
}

// txEventAt is the instant a transaction counts at. Entered on the day it is
// dated → its exact entry time. Backdated (or forward-dated) → the start of its
// own date, local time; on a handover day that keeps it in the old cycle.
func (k cycleClock) txEventAt(tx models.Transaction) time.Time {
	if k.storedDate(tx.CreatedAt).Equal(toDateOnly(tx.Date)) {
		return tx.CreatedAt
	}
	return k.storedDayStart(tx.Date)
}

// ── Windows ──────────────────────────────────────────────────────────────────

// cycleWindow is a half-open instant range [Start, End); End nil = open.
type cycleWindow struct {
	Start time.Time
	End   *time.Time
}

func (w cycleWindow) contains(t time.Time) bool {
	return !t.Before(w.Start) && (w.End == nil || t.Before(*w.End))
}

// handoverAt is when the cycle passed to its successor, or nil if it has not.
func handoverAt(c models.SalaryCycle, all []models.SalaryCycle) *time.Time {
	if c.EndedAt != nil {
		t := *c.EndedAt
		return &t
	}
	return successorStart(c, all)
}

// successorStart is the start of the next cycle after c, or nil if c is the
// latest one.
func successorStart(c models.SalaryCycle, all []models.SalaryCycle) *time.Time {
	var next *time.Time
	for i := range all {
		o := all[i]
		if o.ID != c.ID && o.CycleStartAt.After(c.CycleStartAt) &&
			(next == nil || o.CycleStartAt.Before(*next)) {
			t := o.CycleStartAt
			next = &t
		}
	}
	return next
}

// window is the span of transactions a cycle owns.
func (k cycleClock) window(c models.SalaryCycle, all []models.SalaryCycle) cycleWindow {
	w := cycleWindow{Start: c.CycleStartAt, End: handoverAt(c, all)}
	if w.End == nil && c.StoppedAt != nil {
		w.End = k.paydayEnd(c) // stopped: planned window, tail intact
	}
	return w
}

// isCurrent reports whether the cycle governs the budget right now.
func (k cycleClock) isCurrent(c models.SalaryCycle, all []models.SalaryCycle) bool {
	return c.StoppedAt == nil && k.window(c, all).contains(k.Now)
}

// currentCycle returns the cycle governing the budget now, or nil.
func (k cycleClock) currentCycle(all []models.SalaryCycle) *models.SalaryCycle {
	for i := range all {
		if k.isCurrent(all[i], all) {
			return &all[i]
		}
	}
	return nil
}

// currentOrLatest returns the current cycle (true) or, when none is current,
// the most recently started one for reference (false). nil when there are none.
// all must be sorted by cycle_start_at ASC.
func (k cycleClock) currentOrLatest(all []models.SalaryCycle) (*models.SalaryCycle, bool) {
	if c := k.currentCycle(all); c != nil {
		return c, true
	}
	if len(all) == 0 {
		return nil, false
	}
	return &all[len(all)-1], false
}

// withinPlannedDates reports whether now lies in the cycle's own planned dates
// [start, end of payday) and it was never handed over — the resume condition.
func (k cycleClock) withinPlannedDates(c models.SalaryCycle) bool {
	if c.EndedAt != nil || k.Now.Before(c.CycleStartAt) {
		return false
	}
	pe := k.paydayEnd(c)
	return pe == nil || k.Now.Before(*pe)
}

// settlementEnd is the end of the period whose leftover budget is settled when
// the next cycle starts at `next`: that start, or earlier if the cycle already
// ended (its successor was deleted from history) or was stopped — after a stop
// the user lives on the no-cycle monthly budget, so later spending is not this
// cycle's.
func settlementEnd(c models.SalaryCycle, next time.Time) time.Time {
	end := next
	for _, t := range []*time.Time{c.EndedAt, c.StoppedAt} {
		if t != nil && t.Before(end) {
			end = *t
		}
	}
	return end
}

// mayReopen reports whether a cycle whose successor was deleted from history
// may take over again: now still lies within its own planned dates and no
// other cycle is current (`all` still has c ended). Otherwise it stays ended
// and the user falls back to the normal no-cycle state — nothing is
// force-activated, and a stopped cycle stays stopped (it only becomes
// resumable again).
func (k cycleClock) mayReopen(c models.SalaryCycle, all []models.SalaryCycle) bool {
	reopened := c
	reopened.EndedAt = nil
	return k.withinPlannedDates(reopened) && k.currentCycle(all) == nil
}

// ── Overlap ──────────────────────────────────────────────────────────────────

// occupiedUntil is the earliest instant a NEW cycle may start without
// overlapping c: its handover if it has one, else the start of its payday (the
// handover-able tail), else — open-ended — the next local day after its start.
func (k cycleClock) occupiedUntil(c models.SalaryCycle, all []models.SalaryCycle) time.Time {
	if h := handoverAt(c, all); h != nil {
		return *h
	}
	if ps := k.paydayStart(c); ps != nil {
		return *ps
	}
	return k.dayStart(c.CycleStartAt).AddDate(0, 0, 1)
}

// conflictingCycle returns an existing cycle (stopped or not) that a new cycle
// [start, payday) would overlap, or nil. Both sides treat the payday as the
// shared handover day, so "old ends on the 28th, new starts on the 28th" is
// legal while starting inside the old cycle's planned days is not.
func (k cycleClock) conflictingCycle(start time.Time, payday *time.Time, all []models.SalaryCycle) *models.SalaryCycle {
	var newOccupied *time.Time
	if payday != nil {
		t := k.storedDayStart(*payday)
		newOccupied = &t
	}
	for i := range all {
		ex := all[i]
		if !start.Before(k.occupiedUntil(ex, all)) {
			continue // new starts at/after ex's tail
		}
		if newOccupied != nil && !ex.CycleStartAt.Before(*newOccupied) {
			continue // ex starts at/after the new cycle's tail
		}
		return &all[i]
	}
	return nil
}

// cycleLengthDays is the planned length of a cycle in days: start → payday
// (local midnight), or 30 when open-ended or implausibly short (< 7).
func (k cycleClock) cycleLengthDays(c models.SalaryCycle) int {
	if ps := k.paydayStart(c); ps != nil {
		if d := int(ps.Sub(c.CycleStartAt).Hours() / 24); d >= 7 {
			return d
		}
	}
	return 30
}

// ── Payday status ────────────────────────────────────────────────────────────

const (
	paydayStatusNone     = "none"     // open-ended cycle
	paydayStatusUpcoming = "upcoming" // before the payday (local)
	paydayStatusToday    = "today"    // on the payday (local)
	paydayStatusPassed   = "passed"   // after the payday, not yet handed over
)

func (k cycleClock) paydayStatus(c models.SalaryCycle) string {
	ps, pe := k.paydayStart(c), k.paydayEnd(c)
	switch {
	case ps == nil:
		return paydayStatusNone
	case k.Now.Before(*ps):
		return paydayStatusUpcoming
	case k.Now.Before(*pe):
		return paydayStatusToday
	default:
		return paydayStatusPassed
	}
}

// nextBoundary is the next instant at which the cycle's derived state (payday
// status) flips, or nil — used to stop cached payloads outliving a boundary.
func (k cycleClock) nextBoundary(c models.SalaryCycle) *time.Time {
	for _, b := range []*time.Time{k.paydayStart(c), k.paydayEnd(c)} {
		if b != nil && b.After(k.Now) {
			return b
		}
	}
	return nil
}

// ── Loading ──────────────────────────────────────────────────────────────────

// windowTx is a transaction together with the instant it counts at.
type windowTx struct {
	models.Transaction
	At time.Time
}

// dateSlack pads the SQL prefilter so no date-only value is missed in any
// timezone (UTC−12 … UTC+14); the exact membership test runs in Go.
const dateSlack = 48 * time.Hour

// loadWindowTransactions returns the user's live transactions whose event
// instant (txEventAt) lies in w.
func loadWindowTransactions(uid uint, w cycleWindow, k cycleClock) []windowTx {
	lo := w.Start.Add(-dateSlack)
	q := database.DB.Where("user_id = ?", uid).Where("(created_at >= ? OR date >= ?)", lo, lo)
	if w.End != nil {
		hi := w.End.Add(dateSlack)
		q = q.Where("(created_at < ? OR date < ?)", hi, hi)
	}
	var rows []models.Transaction
	q.Find(&rows) // GORM v2: deleted_at IS NULL added automatically

	out := make([]windowTx, 0, len(rows))
	for _, r := range rows {
		if at := k.txEventAt(r); w.contains(at) {
			out = append(out, windowTx{Transaction: r, At: at})
		}
	}
	return out
}

// loadUserCycles returns all of a user's cycles, oldest first.
func loadUserCycles(uid uint) ([]models.SalaryCycle, error) {
	var all []models.SalaryCycle
	err := database.DB.Preload("FixedExpenses").
		Where("user_id = ?", uid).
		Order("cycle_start_at ASC").
		Find(&all).Error
	return all, err
}
