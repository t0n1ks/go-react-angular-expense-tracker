package handlers

import (
	"math"
	"sort"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Companion signals: what the UFO knows, all from authoritative figures ────
//
// Nothing here computes money: the period facts come from the cycle stats /
// budget window the dashboard shows, and the forecast from Stage B's
// cycle_end. The personal insights below are light statistics over the last
// 90 days of the user's own transactions, read on demand (nothing stored).

const (
	periodBasisNone = "none" // Lite / no cycle and no monthly goal: engagement-only

	baselineWindowDays = 90
	baselineMinEntries = 10  // a category speaks only after this many expenses
	unusualRatio       = 2.5 // "about N× your usual" from this multiple on
	unusualMinExcess   = 5.0 // and at least this much above the usual amount
	weekdayMinDays     = 28  // weekday pattern needs four weeks of history
	weekdayHeavyRatio  = 1.5 // a weekday is "heavy" from this multiple of the average day
)

// financeSignals is the companion's view of the current budget period.
type financeSignals struct {
	Basis       string // periodBasisCycle | periodBasisMonth | periodBasisNone
	Facts       spendFacts
	Remaining   float64 // budget left now (the dashboard's figure)
	DaysLeft    float64
	PeriodStart time.Time
	CycleID     uint
	WeekIndex   int       // 0-based cycle week (cycle basis only)
	WeekStart   time.Time // start of the current cycle week
	PaydayStart *time.Time
	SavedTotal  float64 // savings pool balance (cycle basis)
	// Calibrating is the forecast card's week-1 "collecting data" state; while
	// it holds, ForecastEnd is nil so the UFO can never cite a projection.
	Calibrating bool
	ForecastEnd *float64
	FixedCatID  uint
	PoolCatID   uint
}

// dailyLeft is "about €X a day" for the rest of the period.
func (s financeSignals) dailyLeft() float64 {
	days := math.Max(1, math.Ceil(s.DaysLeft))
	return round2(math.Max(0, s.Remaining) / days)
}

// companionFinance resolves the user's period exactly like the forecast card:
// the current salary cycle, else the monthly goal; Lite and goal-less users
// get no financial signals (engagement-only health).
func companionFinance(user models.User, k cycleClock) financeSignals {
	if user.LiteMode {
		return financeSignals{Basis: periodBasisNone}
	}
	all, _ := loadUserCycles(user.ID)
	if c := k.currentCycle(all); c != nil {
		stats := computeCycleStatsAt(user.ID, *c, all, k)
		fc := cycleEndForecast(stats, *c, k)
		elapsed, left := cycleDays(*c, k)
		s := financeSignals{
			Basis: periodBasisCycle,
			Facts: spendFacts{
				Active: true, Spent: stats.CycleVariableExpenses, Budget: stats.VariableAllowance,
				Overspent: stats.SpendableRemaining < 0, ElapsedDays: elapsed, TotalDays: float64(stats.DaysTotal),
			},
			Remaining:   stats.SpendableRemaining,
			DaysLeft:    left,
			PeriodStart: c.CycleStartAt,
			CycleID:     c.ID,
			WeekIndex:   stats.CurrentWeekIndex,
			WeekStart:   c.CycleStartAt.AddDate(0, 0, stats.CurrentWeekIndex*7),
			PaydayStart: k.paydayStart(*c),
			SavedTotal:  stats.SavedMoneyBalance,
			Calibrating: fc.Calibrating,
			FixedCatID:  c.FixedExpCategoryID,
			PoolCatID:   poolCategoryOf(all),
		}
		if !fc.Calibrating {
			end := fc.ProjectedEnd
			s.ForecastEnd = &end
		}
		return s
	}
	bw := computeBudgetWindow(user.ID, user.MonthlySpendingGoal, k.Now)
	fc := monthEndForecast(bw, k.Now)
	if fc == nil {
		return financeSignals{Basis: periodBasisNone}
	}
	s := financeSignals{
		Basis: periodBasisMonth,
		Facts: spendFacts{
			Active: true, Spent: bw.SpentThisWindow, Budget: bw.MonthlyBudget,
			Overspent: fc.Position < 0, ElapsedDays: fc.DaysElapsed, TotalDays: fc.DaysElapsed + fc.DaysLeft,
		},
		Remaining:   fc.Position,
		DaysLeft:    fc.DaysLeft,
		PeriodStart: bw.WindowStart,
		Calibrating: fc.Calibrating,
		PoolCatID:   poolCategoryOf(all),
	}
	if !fc.Calibrating {
		end := fc.ProjectedEnd
		s.ForecastEnd = &end
	}
	return s
}

// ── Personal insights (light statistics, no storage) ─────────────────────────

// isVariableSpend: a budget expense (not a fixed payment, not the savings pool).
func isVariableSpend(t models.Transaction, fixedCat, poolCat uint) bool {
	if t.Type != "expense" {
		return false
	}
	if fixedCat > 0 && t.CategoryID == fixedCat {
		return false
	}
	return !(poolCat > 0 && t.CategoryID == poolCat)
}

// categoryBaseline is a category's typical single expense.
type categoryBaseline struct {
	Median float64
	Count  int
}

// categoryBaselines: the median single expense per category over the window.
func categoryBaselines(txs []windowTx, fixedCat, poolCat uint) map[uint]categoryBaseline {
	amounts := map[uint][]float64{}
	for _, t := range txs {
		if isVariableSpend(t.Transaction, fixedCat, poolCat) {
			amounts[t.CategoryID] = append(amounts[t.CategoryID], t.Amount)
		}
	}
	out := make(map[uint]categoryBaseline, len(amounts))
	for cat, a := range amounts {
		out[cat] = categoryBaseline{Median: median(a), Count: len(a)}
	}
	return out
}

func median(a []float64) float64 {
	s := append([]float64(nil), a...)
	sort.Float64s(s)
	n := len(s)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return s[n/2]
	}
	return (s[n/2-1] + s[n/2]) / 2
}

// unusualExpense reports how many times the usual amount an expense is, when
// it stands out against a category baseline that has enough history. The
// baseline excludes the expense itself.
func unusualExpense(amount float64, b categoryBaseline, ok bool) (float64, bool) {
	if !ok || b.Count < baselineMinEntries || b.Median <= 0 {
		return 0, false
	}
	ratio := amount / b.Median
	if ratio < unusualRatio || amount-b.Median < unusualMinExcess {
		return 0, false
	}
	return math.Round(ratio*2) / 2, true // "about 3×", "about 3.5×"
}

// heavyWeekday finds the weekday the user typically spends most on, once four
// weeks of history exist. ok is false when there is no clear pattern.
func heavyWeekday(txs []windowTx, fixedCat, poolCat uint, k cycleClock) (time.Weekday, bool) {
	var first time.Time
	var perDay [7]float64
	total := 0.0
	for _, t := range txs {
		if !isVariableSpend(t.Transaction, fixedCat, poolCat) {
			continue
		}
		if first.IsZero() || t.At.Before(first) {
			first = t.At
		}
		perDay[t.At.In(k.Loc).Weekday()] += t.Amount
		total += t.Amount
	}
	if first.IsZero() || total <= 0 {
		return 0, false
	}
	span := localDaysBetween(k.dayStart(first), k.dayStart(k.Now), k) + 1
	if span < weekdayMinDays {
		return 0, false
	}
	avgDay := total / float64(span)
	best, bestAvg := time.Sunday, 0.0
	for d := time.Sunday; d <= time.Saturday; d++ {
		occurrences := countWeekday(k.dayStart(first), k.dayStart(k.Now), d, k)
		if occurrences == 0 {
			continue
		}
		if avg := perDay[d] / float64(occurrences); avg > bestAvg {
			best, bestAvg = d, avg
		}
	}
	return best, bestAvg >= weekdayHeavyRatio*avgDay
}

// countWeekday counts the local days from a to b inclusive that fall on d.
func countWeekday(a, b time.Time, d time.Weekday, k cycleClock) int {
	n := 0
	for day := a; !day.After(b); day = day.AddDate(0, 0, 1) {
		if day.In(k.Loc).Weekday() == d {
			n++
		}
	}
	return n
}
