package handlers

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
)

// ── Pure projection ──────────────────────────────────────────────────────────

func TestPeriodPaceIsThePlainAverage(t *testing.T) {
	// One €30 day and four €2 days: €38 over 5 days, not a €30/day panic.
	f := projectPeriodEnd(periodBasisCycle, 300, 30+4*2, 5, 25)
	approx(t, "pace", f.DailyPace, 7.60)
	approx(t, "projected = position − pace × days left", f.ProjectedEnd, 300-7.60*25)
	if f.Rough {
		t.Error("5 days of history is not rough")
	}
}

func TestPeriodOverspendProjectsDeficit(t *testing.T) {
	f := projectPeriodEnd(periodBasisCycle, 100, 200, 10, 20) // €20/day, €100 left
	approx(t, "deficit", f.ProjectedEnd, -300)
}

func TestPeriodUnderspendProjectsModestSurplus(t *testing.T) {
	f := projectPeriodEnd(periodBasisCycle, 250, 100, 10, 20) // €10/day, €250 left
	approx(t, "surplus", f.ProjectedEnd, 50)
}

func TestPeriodOverspentBudgetIsNotClamped(t *testing.T) {
	f := projectPeriodEnd(periodBasisCycle, -40, 340, 10, 0)
	approx(t, "already overspent, no days left", f.ProjectedEnd, -40)
	f = projectPeriodEnd(periodBasisCycle, -40, 340, 10, 5)
	approx(t, "overspent and still spending", f.ProjectedEnd, -40-34*5)
}

func TestPeriodEarlyFallbackTightensToThePace(t *testing.T) {
	// Day 0: nothing known yet → the planned even pace; lands on 0, rough.
	f := projectPeriodEnd(periodBasisCycle, 300, 0, 0, 30)
	approx(t, "day 0 pace = plan", f.DailyPace, 10)
	approx(t, "day 0 projection", f.ProjectedEnd, 0)
	if !f.Rough {
		t.Error("day 0 must be rough")
	}
	// Half-way through the warm-up: half real average, half plan.
	f = projectPeriodEnd(periodBasisCycle, 270, 30, 1.5, 28.5)
	approx(t, "blend", f.DailyPace, round2(0.5*20+0.5*270/28.5))
	// A big first purchase minutes in cannot explode the pace.
	f = projectPeriodEnd(periodBasisCycle, 240, 60, 0.01, 30)
	if f.DailyPace > 60/3.0+240/30.0+0.01 {
		t.Errorf("early pace must stay bounded, got %v", f.DailyPace)
	}
	// From day 3 it is exactly the average (no jump at the threshold).
	f = projectPeriodEnd(periodBasisCycle, 210, 90, 3, 27)
	approx(t, "day 3 = plain average", f.DailyPace, 30)
	if f.Rough {
		t.Error("day 3 is no longer rough")
	}
}

func TestMonthEndForecastNeedsGoal(t *testing.T) {
	now := time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC)
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if monthEndForecast(BudgetWindow{HasGoal: false, WindowStart: start}, now) != nil {
		t.Error("no goal → nothing to project")
	}
	f := monthEndForecast(BudgetWindow{HasGoal: true, MonthlyBudget: 500, SpentThisWindow: 200, WindowStart: start}, now)
	if f == nil || f.Basis != periodBasisMonth {
		t.Fatalf("want a month forecast, got %+v", f)
	}
	approx(t, "position = goal − spent", f.Position, 300)
	approx(t, "pace", f.DailyPace, 20)
	approx(t, "days left in October", f.DaysLeft, 21)
	approx(t, "projected", f.ProjectedEnd, 300-20*21)
}

// ── Handler: reconciles with the dashboard ───────────────────────────────────

type cycleEndStats struct {
	SpendableRemaining    float64 `json:"spendable_remaining"`
	CycleVariableExpenses float64 `json:"cycle_variable_expenses"`
}

func periodEndNow(t *testing.T, uid uint) *periodEndForecast {
	t.Helper()
	var r struct {
		CycleEnd *periodEndForecast `json:"cycle_end"`
	}
	if err := json.Unmarshal(callHandlerTZ(uid, nil, GetSavingsForecast, "UTC").Body.Bytes(), &r); err != nil {
		t.Fatalf("decode forecast: %v", err)
	}
	return r.CycleEnd
}

func TestCycleEndReconcilesWithDashboard(t *testing.T) {
	u := newTZUser(t, "cycleendrecon")
	startUTC(t, u.ID, udate(-10), udate(20))
	addExpense(t, u.ID, 30, udate(-9))
	for d := -8; d <= -5; d++ {
		addExpense(t, u.ID, 2, udate(d))
	}

	InvalidateCycleCache(u.ID)
	var r struct {
		Stats *cycleEndStats `json:"cycle_stats"`
	}
	_ = json.Unmarshal(callHandlerTZ(u.ID, nil, GetCurrentSalaryCycle, "UTC").Body.Bytes(), &r)
	if r.Stats == nil {
		t.Fatal("no cycle stats")
	}
	f := periodEndNow(t, u.ID)
	if f == nil || f.Basis != periodBasisCycle || f.Rough {
		t.Fatalf("want a settled cycle forecast, got %+v", f)
	}
	approx(t, "position = dashboard spendable_remaining", f.Position, r.Stats.SpendableRemaining)
	approx(t, "spent = dashboard cycle variable spending", f.Spent, r.Stats.CycleVariableExpenses)
	if math.Abs(f.DailyPace-r.Stats.CycleVariableExpenses/f.DaysElapsed) > 0.01 {
		t.Errorf("pace %v ≠ spent %v ÷ days elapsed %v", f.DailyPace, f.Spent, f.DaysElapsed)
	}
	approx(t, "projected = spendable_remaining − pace × days left",
		f.ProjectedEnd, round2(r.Stats.SpendableRemaining-f.DailyPace*f.DaysLeft))
}

func TestCycleEndAbsentForLiteAndGoalLessUsers(t *testing.T) {
	u := newTZUser(t, "cycleendnogoal")
	if f := periodEndNow(t, u.ID); f != nil {
		t.Errorf("no cycle and no goal → hidden, got %+v", f)
	}

	database.DB.Model(&u).Update("monthly_spending_goal", 400)
	f := periodEndNow(t, u.ID)
	if f == nil || f.Basis != periodBasisMonth {
		t.Fatalf("no cycle with a goal → month forecast, got %+v", f)
	}

	database.DB.Model(&u).Update("lite_mode", true)
	if f := periodEndNow(t, u.ID); f != nil {
		t.Errorf("Lite → hidden, got %+v", f)
	}
}
