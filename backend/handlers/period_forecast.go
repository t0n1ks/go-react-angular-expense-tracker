package handlers

import (
	"math"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── End-of-period forecast: budget left at payday / month end ────────────────
//
// "Where will my budget be when this period ends, at the pace I actually
// spend?" Built only from the authoritative figures the dashboard shows:
//
//   - position  = budget left now: the cycle's spendable_remaining ("можно
//     потратить", negative when overspent) or, without a cycle, the monthly
//     goal minus this month's spending. Fixed expenses are already deducted
//     there, so they are never projected again.
//   - pace      = variable spending so far ÷ days elapsed — a plain average,
//     so one expensive day among cheap ones is smoothed out.
//   - projected = position − pace × days left. Never clamped: an honest
//     deficit is shown as a deficit.
//
// Early on there is too little history for a stable pace (the same 3-day
// threshold as the savings forecast): until then the pace slides linearly
// from the planned even pace (position ÷ days left) to the real average.
//
// For the whole first week the period is "calibrating": the client shows a
// calm "collecting data" state instead of the projection, so one big shop on
// day 1 never reads as an alarming deficit. From day 8 the figure is shown.

// periodEndForecast is the cycle_end block of GET /api/balance/forecast.
type periodEndForecast struct {
	Basis        string  `json:"basis"`         // "cycle" (budget at payday) or "month" (monthly goal)
	Position     float64 `json:"position"`      // budget left now
	Spent        float64 `json:"spent"`         // variable spending so far this period
	DaysElapsed  float64 `json:"days_elapsed"`  // fractional days since the period started
	DaysLeft     float64 `json:"days_left"`     // fractional days until it ends
	DailyPace    float64 `json:"daily_pace"`    // the pace the projection uses
	ProjectedEnd float64 `json:"projected_end"` // position − daily_pace × days_left
	Calibrating  bool    `json:"calibrating"`   // still in the first week: projection not shown
}

const (
	periodBasisCycle = "cycle"
	periodBasisMonth = "month"

	periodCalibrationDays = 7 // full days elapsed before the projection is shown
)

// projectPeriodEnd is the whole projection. Pure.
func projectPeriodEnd(basis string, position, spent, elapsed, left float64) periodEndForecast {
	// Rounded first, so every shown figure reconciles to the cent.
	elapsed, left = round2(math.Max(0, elapsed)), round2(math.Max(0, left))

	planned := 0.0
	if left > 0 {
		planned = math.Max(0, position) / left
	}
	var pace float64
	if elapsed >= forecastPaceMinDays {
		pace = spent / elapsed
	} else {
		// w × (spent ÷ elapsed) = spent ÷ 3: bounded even minutes into the period.
		w := elapsed / forecastPaceMinDays
		pace = spent/forecastPaceMinDays + (1-w)*planned
	}
	pace = round2(pace) // the shown "€X/день" is exactly the one projected

	return periodEndForecast{
		Basis:        basis,
		Position:     round2(position),
		Spent:        round2(spent),
		DaysElapsed:  elapsed,
		DaysLeft:     left,
		DailyPace:    pace,
		ProjectedEnd: round2(position - pace*left),
		Calibrating:  elapsed < periodCalibrationDays,
	}
}

// cycleDays splits a cycle's length into elapsed and remaining fractional
// days as of now; nothing is left once payday has passed.
func cycleDays(c models.SalaryCycle, k cycleClock) (elapsed, left float64) {
	total := float64(k.cycleLengthDays(c))
	elapsed = math.Max(0, k.Now.Sub(c.CycleStartAt).Hours()/24)
	left = math.Max(0, total-elapsed)
	if k.paydayStatus(c) == paydayStatusPassed {
		left = 0
	}
	return elapsed, left
}

// cycleEndForecast projects the current cycle's budget to payday from the
// same stats the dashboard shows.
func cycleEndForecast(stats CycleStats, c models.SalaryCycle, k cycleClock) periodEndForecast {
	elapsed, left := cycleDays(c, k)
	return projectPeriodEnd(periodBasisCycle, stats.SpendableRemaining, stats.CycleVariableExpenses, elapsed, left)
}

// monthEndForecast projects a no-cycle user's monthly goal to month end from
// the server budget window (the budget bar's own figures). nil without a goal.
func monthEndForecast(bw BudgetWindow, now time.Time) *periodEndForecast {
	if !bw.HasGoal {
		return nil
	}
	elapsed := now.Sub(bw.WindowStart).Hours() / 24
	left := bw.WindowStart.AddDate(0, 1, 0).Sub(now).Hours() / 24
	f := projectPeriodEnd(periodBasisMonth, bw.MonthlyBudget-bw.SpentThisWindow, bw.SpentThisWindow, elapsed, left)
	return &f
}

// periodEndForecastFor picks the user's period: the current salary cycle, or
// the monthly goal when no cycle is current (the budget bar's own switch).
// nil for Lite users and when there is nothing honest to project.
func periodEndForecastFor(user models.User, k cycleClock) *periodEndForecast {
	if user.LiteMode {
		return nil
	}
	all, _ := loadUserCycles(user.ID)
	if c := k.currentCycle(all); c != nil {
		f := cycleEndForecast(computeCycleStatsAt(user.ID, *c, all, k), *c, k)
		return &f
	}
	return monthEndForecast(computeBudgetWindow(user.ID, user.MonthlySpendingGoal, k.Now), k.Now)
}
