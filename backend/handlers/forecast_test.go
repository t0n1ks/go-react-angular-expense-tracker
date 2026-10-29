package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"testing"
	"time"
)

func forecastNow(t *testing.T, uid uint) *savingsForecast {
	t.Helper()
	var r struct {
		Forecast *savingsForecast `json:"forecast"`
	}
	if err := json.Unmarshal(callHandlerTZ(uid, nil, GetSavingsForecast, "UTC").Body.Bytes(), &r); err != nil {
		t.Fatalf("decode forecast: %v", err)
	}
	return r.Forecast
}

// ── Pure weighting ───────────────────────────────────────────────────────────

func TestBlendedDailyRate(t *testing.T) {
	newest := cycleResult{Net: -60, Days: 30} // −2/day
	older := cycleResult{Net: 120, Days: 30}  // +4/day
	oldest := cycleResult{Net: 300, Days: 30} // +10/day
	current := cycleResult{Net: 30, Days: 30} // +1/day

	r, ok := blendedDailyRate([]cycleResult{newest, older, oldest}, &current)
	// (1·−2 + 0.5·4 + 0.25·10 + 1·1) / (1 + 0.5 + 0.25 + 1)
	if !ok || math.Abs(r-(3.5/2.75)) > 1e-9 {
		t.Errorf("rate = %v, want %v", r, 3.5/2.75)
	}
	if r, ok := blendedDailyRate(nil, &current); !ok || r != 1 {
		t.Errorf("first month: the current cycle alone, got %v", r)
	}
	if _, ok := blendedDailyRate(nil, nil); ok {
		t.Error("nothing to base a forecast on")
	}
}

// ── Handler flows ────────────────────────────────────────────────────────────

// First month: a rough, plan-based estimate, clearly flagged, anchored on the
// real money now (which equals the dashboard's figure).
func TestForecastFirstMonthIsRough(t *testing.T) {
	u := newTZUser(t, "forecastrough")
	startUTC(t, u.ID, udate(0), udate(30))
	f := forecastNow(t, u.ID)
	if f == nil || !f.Rough || f.CompletedCycles != 0 {
		t.Fatalf("want a rough first-month forecast, got %+v", f)
	}
	approx(t, "cycle result = the plan (100 to savings)", f.CycleResult, 100)
	approx(t, "money now = dashboard money on hand", f.MoneyNow, moneyNow(t, u.ID).MoneyOnHand)
	approx(t, "in a year = now + annual", f.InAYear, f.MoneyNow+f.AnnualChange)
}

// A user who keeps overspending gets a negative annual figure — never a rosy
// "allocation × 12" — and the in-a-year anchor falls below today.
func TestForecastOverspendingTrendIsNegative(t *testing.T) {
	u := newTZUser(t, "forecastneg")
	startUTC(t, u.ID, udate(-60), udate(-30))
	spendEarlier(t, u.ID, 600, 45*24*time.Hour)
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 600, 15*24*time.Hour)
	startUTC(t, u.ID, udate(0), udate(30))

	f := forecastNow(t, u.ID)
	if f == nil || f.Rough || f.CompletedCycles != 2 {
		t.Fatalf("want a history-based forecast over 2 cycles, got %+v", f)
	}
	if f.AnnualChange >= 0 {
		t.Errorf("overspending trend must project a loss, got %+v", f)
	}
	if f.InAYear >= f.MoneyNow {
		t.Errorf("in a year must be below today on a losing trend, got %+v", f)
	}
}

// With a real history the forecast follows it: a modest real surplus gives a
// modest annual figure, far below the old "allocation × 12" (= 1200 here).
func TestForecastFollowsRealHistory(t *testing.T) {
	u := newTZUser(t, "forecasthistory")
	startUTC(t, u.ID, udate(-60), udate(-30))
	spendEarlier(t, u.ID, 494, 45*24*time.Hour) // kept 10 of 504
	startUTC(t, u.ID, udate(-30), udate(0))
	spendEarlier(t, u.ID, 494, 15*24*time.Hour) // kept 10 again
	if w := startUTC(t, u.ID, udate(0), udate(30)); w.Code != http.StatusCreated {
		t.Fatalf("start current: %d %s", w.Code, w.Body.String())
	}

	f := forecastNow(t, u.ID)
	if f == nil || f.CompletedCycles != 2 || f.Rough {
		t.Fatalf("want a forecast over 2 completed cycles, got %+v", f)
	}
	// ≈ (10/30·1 + 10/30·0.5 + 100/30·1) / 2.5 per day ≈ 1.53/day ≈ 560/year.
	if f.AnnualChange <= 0 || f.AnnualChange >= 600 {
		t.Errorf("annual %.2f must reflect the ~€10/cycle history (≈560), not the €1200 plan", f.AnnualChange)
	}
}

// Moving money between budget and savings is net-zero on real money, so it
// cannot change the forecast.
func TestForecastIgnoresBudgetSavingsMoves(t *testing.T) {
	u := newTZUser(t, "forecastmoves")
	startUTC(t, u.ID, udate(-60), udate(-30))
	spendEarlier(t, u.ID, 300, 45*24*time.Hour)
	startUTC(t, u.ID, udate(-30), udate(30))
	before := forecastNow(t, u.ID)
	deposit(u.ID, 25.55)
	returnToBudget(u.ID, latestTx(u.ID, "savings_deposit").ID, amt(10.10))
	after := forecastNow(t, u.ID)
	approx(t, "annual unchanged", after.AnnualChange, before.AnnualChange)
	approx(t, "money now unchanged", after.MoneyNow, before.MoneyNow)
}

func TestForecastNilWithoutCycles(t *testing.T) {
	u := newTZUser(t, "forecastnone")
	if f := forecastNow(t, u.ID); f != nil {
		t.Errorf("no cycles → no forecast, got %+v", f)
	}
}
