package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Pure snap rules ──────────────────────────────────────────────────────────

func TestPlanBoundarySnap(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	k := newCycleClock(time.Date(2026, 10, 29, 12, 0, 0, 0, berlin), berlin)
	start := time.Date(2026, 10, 4, 12, 0, 0, 0, berlin)
	end := time.Date(2026, 10, 28, 23, 59, 30, 0, berlin)
	prev := &models.SalaryCycle{ID: 51, CycleStartAt: start, EndedAt: &end}
	newStart := time.Date(2026, 10, 28, 23, 59, 0, 0, berlin)

	if s, code, _ := k.planBoundarySnap(&models.SalaryCycle{ID: 1, CycleStartAt: start}, newStart, nil); s != nil || code != "" {
		t.Error("no recorded end → the normal handover, no snap")
	}
	if s, code, _ := k.planBoundarySnap(prev, end, nil); s != nil || code != "" {
		t.Error("exact match → nothing to snap")
	}
	gapStart := end.Add(10 * time.Hour)
	if s, code, _ := k.planBoundarySnap(prev, gapStart, nil); code != "" || s == nil || !s.To.Equal(gapStart) || !s.From.Equal(end) {
		t.Errorf("gap must snap the end forward, got %+v %q", s, code)
	}
	if s, code, _ := k.planBoundarySnap(prev, newStart, nil); code != "" || s == nil || !s.To.Equal(newStart) {
		t.Errorf("overlap without entries must snap the end back, got %+v %q", s, code)
	}
	entry := windowTx{At: newStart.Add(10 * time.Second)}
	if s, code, latest := k.planBoundarySnap(prev, newStart, []windowTx{entry}); s != nil || code != errSnapMovesEntries || latest == nil || !latest.Equal(entry.At) {
		t.Errorf("overlap over an entry must be refused, got %+v %q", s, code)
	}
	early := start.AddDate(0, 0, 6)
	if s, code, _ := k.planBoundarySnap(prev, early, nil); s != nil || code != errSnapTooShort {
		t.Errorf("snapping below 7 days must be refused, got %+v %q", s, code)
	}
}

// ── The user's case, end to end (Berlin time) ────────────────────────────────

type snapCase struct {
	uid             uint
	old             models.SalaryCycle
	lateExpenseIDs  []uint
	deletedEntryIDs []uint
	carryMoveID     uint
	yesterday       time.Time // local midnight, Berlin
}

// setupSnapCase builds the state after the incident: an October-like cycle
// (started 25 days ago at 12:00, payday yesterday) whose successor vanished,
// leaving it ended at `endedAt` (local, yesterday) and stopped early today;
// entries yesterday at 23:30 (and one at 23:50, inside the gap of the gap
// case); the vanished cycle's salary, allocation and fixed expense marked
// deleted; the €11 carry-over move still live.
func setupSnapCase(t *testing.T, name string, endedHour, endedMin, endedSec int) snapCase {
	t.Helper()
	berlin := mustLoc(t, "Europe/Berlin")
	u := newTZUser(t, name)
	now := time.Now().In(berlin)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, berlin)
	yesterday := today.AddDate(0, 0, -1)
	day := func(d time.Time) string { return d.Format("2006-01-02") }

	w := callHandlerTZ(u.ID, map[string]any{
		"base_salary": 504.0, "language": "ru",
		"needs_pct": 50.0, "wants_pct": 30.0, "savings_pct": 20.0,
		"received_at_date": day(today.AddDate(0, 0, -25)), "received_at_time": "12:00",
		"next_payday_date": day(yesterday),
	}, StartSalaryCycle, "Europe/Berlin")
	if w.Code != http.StatusCreated {
		t.Fatalf("start old cycle: %d %s", w.Code, w.Body.String())
	}
	var old models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).First(&old)

	endedAt := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), endedHour, endedMin, endedSec, 0, berlin)
	stoppedAt := now.Add(-time.Minute)
	database.DB.Model(&models.SalaryCycle{}).Where("id = ?", old.ID).
		Updates(map[string]any{"ended_at": endedAt.UTC(), "stopped_at": stoppedAt.UTC()})
	database.DB.First(&old, old.ID)

	sc := snapCase{uid: u.ID, old: old, yesterday: yesterday}
	mk := func(amount float64, typ, desc, source string, cat uint, at time.Time, deleted bool) uint {
		tx := models.Transaction{
			UserID: u.ID, CategoryID: cat, Amount: amount, Type: typ, Description: desc, Source: source,
			IncomeType: "one_time", Date: time.Date(at.Year(), at.Month(), at.Day(), 0, 0, 0, 0, time.UTC),
			CreatedAt: at.UTC(), UpdatedAt: at.UTC(),
		}
		database.DB.Create(&tx)
		if deleted {
			database.DB.Model(&tx).Update("deleted_at", gorm.DeletedAt{Time: time.Now(), Valid: true})
		}
		return tx.ID
	}
	food := models.Category{UserID: u.ID, Name: "Еда"}
	database.DB.Create(&food)
	late := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 23, 30, 0, 0, berlin)
	inGap := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 23, 50, 0, 0, berlin)
	sc.lateExpenseIDs = []uint{
		mk(2.48, "expense", "Mood", "", food.ID, late, false),
		mk(7.30, "expense", "Еда", "", food.ID, late, false),
		mk(1.00, "expense", "Snack", "", food.ID, inGap, false), // in the gap for the gap case
	}
	vanished := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 16, 0, 0, 0, berlin)
	var income models.Category
	database.DB.Where("user_id = ? AND translation_key = ?", u.ID, "category.income").First(&income)
	sc.deletedEntryIDs = []uint{
		mk(504.85, "income", "Salary", "", income.ID, vanished, true),
		mk(100, "savings_deposit", "Planned savings allocation", "", old.SavedMoneyCategoryID, vanished, true),
		mk(39.99, "expense", "Internet", "", old.FixedExpCategoryID, vanished, true),
	}
	sc.carryMoveID = mk(11, "savings_deposit", "Carry-over moved to savings", carryOverToSavingsSource,
		old.SavedMoneyCategoryID, now.Add(-30*time.Second), false)
	return sc
}

func startNewAt2359(t *testing.T, sc snapCase) map[string]any {
	t.Helper()
	w := callHandlerTZ(sc.uid, map[string]any{
		"base_salary": 504.85, "language": "ru",
		"needs_pct": 50.0, "wants_pct": 30.0, "savings_pct": 20.0,
		"received_at_date": sc.yesterday.Format("2006-01-02"), "received_at_time": "23:59",
		"next_payday_date": sc.yesterday.AddDate(0, 0, 30).Format("2006-01-02"),
	}, StartSalaryCycle, "Europe/Berlin")
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if w.Code != http.StatusCreated {
		t.Fatalf("start new cycle: %d %s", w.Code, w.Body.String())
	}
	return body
}

// assertCleanHandover checks everything the user cares about once the new
// cycle exists.
func assertCleanHandover(t *testing.T, sc snapCase, body map[string]any) {
	t.Helper()
	berlin := mustLoc(t, "Europe/Berlin")
	newStart := time.Date(sc.yesterday.Year(), sc.yesterday.Month(), sc.yesterday.Day(), 23, 59, 0, 0, berlin)

	if body["boundary_snap"] == nil {
		t.Error("the adjustment must be reported so the user is told")
	}
	var old models.SalaryCycle
	database.DB.First(&old, sc.old.ID)
	if old.EndedAt == nil || !old.EndedAt.Equal(newStart) {
		t.Errorf("old end must snap to the new start %v, got %v", newStart, old.EndedAt)
	}
	if !old.CycleStartAt.Equal(sc.old.CycleStartAt) || old.StoppedAt == nil ||
		!old.NextPaydayAt.Equal(*sc.old.NextPaydayAt) {
		t.Errorf("old start/payday/stop must not change: %+v", old)
	}
	var audits int64
	database.DB.Model(&models.SalaryCycleAudit{}).Where("salary_cycle_id = ? AND field = ?", old.ID, "ended_at (auto-snap)").Count(&audits)
	if audits != 1 {
		t.Errorf("want one audit entry for the snap, got %d", audits)
	}

	// The new cycle is current; the old one is not revived.
	InvalidateCycleCache(sc.uid)
	var cur struct {
		HasActive bool `json:"has_active_cycle"`
		Cycle     struct {
			ID uint `json:"id"`
		} `json:"cycle"`
		Stats struct {
			CycleIncome           float64 `json:"cycle_income"`
			CycleVariableExpenses float64 `json:"cycle_variable_expenses"`
			CarryOverToSavings    float64 `json:"carry_over_to_savings"`
			SpendableRemaining    float64 `json:"spendable_remaining"`
			SavedMoneyBalance     float64 `json:"saved_money_balance"`
			MoneyOnHand           float64 `json:"money_on_hand"`
		} `json:"cycle_stats"`
	}
	_ = json.Unmarshal(callHandlerTZ(sc.uid, nil, GetCurrentSalaryCycle, "Europe/Berlin").Body.Bytes(), &cur)
	if !cur.HasActive || cur.Cycle.ID == sc.old.ID {
		t.Fatalf("the new cycle must be current, got %+v", cur)
	}
	approx(t, "new cycle income = one 504.85 salary", cur.Stats.CycleIncome, 504.85)
	approx(t, "23:30 spending is not in the new cycle", cur.Stats.CycleVariableExpenses, 0)
	approx(t, "the €11 move counts in the new cycle", cur.Stats.CarryOverToSavings, 11)
	approx(t, "money on hand = spendable + savings", cur.Stats.MoneyOnHand, cur.Stats.SpendableRemaining+cur.Stats.SavedMoneyBalance)

	// The 23:30 entries stay in the old cycle.
	all, _ := loadUserCycles(sc.uid)
	k := newCycleClock(time.Now(), berlin)
	var oldNow models.SalaryCycle
	for _, c := range all {
		if c.ID == sc.old.ID {
			oldNow = c
		}
	}
	w := k.window(oldNow, all)
	for _, id := range sc.lateExpenseIDs {
		var tx models.Transaction
		database.DB.First(&tx, id)
		if !w.contains(k.txEventAt(tx)) {
			t.Errorf("late entry %d (23:30 / 23:50) must stay in the old cycle", id)
		}
	}

	// Marked-deleted entries stay deleted; nothing revived or duplicated.
	for _, id := range sc.deletedEntryIDs {
		var tx models.Transaction
		if err := database.DB.Unscoped().First(&tx, id).Error; err != nil || !tx.DeletedAt.Valid {
			t.Errorf("entry %d must stay marked deleted", id)
		}
	}
	if n := countTx(sc.uid, "type = 'income' AND amount = ?", 504.85); n != 1 {
		t.Errorf("want exactly one live 504.85 salary, got %d", n)
	}
	var carry models.Transaction
	if err := database.DB.First(&carry, sc.carryMoveID).Error; err != nil {
		t.Error("the €11 carry-over move must stay live")
	}

	// The chart reconciles with the cards.
	pts := timeline(t, sc.uid)
	last := pts[len(pts)-1]
	approx(t, "chart budget line", last.Spendable, cur.Stats.SpendableRemaining)
	approx(t, "chart savings line", last.Savings, cur.Stats.SavedMoneyBalance)
}

// Overlap by seconds (old end 23:59:30, new start 23:59): snaps back.
func TestSnapUserCaseOverlap(t *testing.T) {
	sc := setupSnapCase(t, "snapoverlap", 23, 59, 30)
	assertCleanHandover(t, sc, startNewAt2359(t, sc))
}

// Gap (old end 23:45, new start 23:59): snaps forward.
func TestSnapUserCaseGap(t *testing.T) {
	sc := setupSnapCase(t, "snapgap", 23, 45, 0)
	assertCleanHandover(t, sc, startNewAt2359(t, sc))
}

// Overlap across a real entry: refused with the entry's time; nothing changes.
func TestSnapRefusedWhenEntriesWouldMove(t *testing.T) {
	sc := setupSnapCase(t, "snaprefuse", 23, 59, 30)
	w := callHandlerTZ(sc.uid, map[string]any{
		"base_salary": 504.85, "language": "ru",
		"needs_pct": 50.0, "wants_pct": 30.0, "savings_pct": 20.0,
		"received_at_date": sc.yesterday.Format("2006-01-02"), "received_at_time": "23:00",
		"next_payday_date": sc.yesterday.AddDate(0, 0, 30).Format("2006-01-02"),
	}, StartSalaryCycle, "Europe/Berlin")
	var r struct {
		Code   string     `json:"code"`
		Latest *time.Time `json:"latest_entry_at"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &r)
	if w.Code != http.StatusBadRequest || r.Code != errSnapMovesEntries || r.Latest == nil {
		t.Fatalf("want 400 %s with the entry time, got %d %s", errSnapMovesEntries, w.Code, w.Body.String())
	}
	var n int64
	database.DB.Model(&models.SalaryCycle{}).Where("user_id = ?", sc.uid).Count(&n)
	var old models.SalaryCycle
	database.DB.First(&old, sc.old.ID)
	if n != 1 || !old.EndedAt.Equal(*sc.old.EndedAt) {
		t.Errorf("a refused start must change nothing (cycles %d, end %v)", n, old.EndedAt)
	}
}
