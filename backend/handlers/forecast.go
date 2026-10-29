package handlers

import (
	"math"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Savings forecast: grounded in the real-money history ─────────────────────
//
// Every figure comes from the same "money on hand" replay as the balance chart
// (ledger.moneyAt), so the forecast can only be as rosy as the user's real
// results:
//
//   - A completed cycle's result is the change in real money (spendable +
//     savings) from its start to its settlement, per day. Moves between budget
//     and savings cancel out; income, spending and spending from savings count.
//   - The current cycle's result is projected: its real change so far, minus
//     the rest of the cycle at the actual daily spending pace (from day 3 on;
//     before that the cycle's own remaining budget is assumed spent, as
//     planned — money carried over from the last cycle is assumed kept).
//   - The daily rate is a recency-weighted average: the newest completed cycle
//     weighs 1, each older one half the one after it, and the current cycle
//     counts as one more cycle of weight 1.
//   - Annual change = rate × 365; "in a year" = money on hand now + that.

const (
	forecastPaceMinDays = 3   // days of spending before the pace is trusted
	forecastDecay       = 0.5 // weight ratio between consecutive older cycles
	daysPerYear         = 365
)

// savingsForecast is the payload of GET /api/balance/forecast.
type savingsForecast struct {
	CycleResult     float64 `json:"cycle_result"`     // projected real result of the current cycle
	AnnualChange    float64 `json:"annual_change"`    // projected change in real money over a year
	MoneyNow        float64 `json:"money_now"`        // real money on hand now (spendable + savings)
	InAYear         float64 `json:"in_a_year"`        // MoneyNow + AnnualChange
	CompletedCycles int     `json:"completed_cycles"` // cycles the trend is based on
	Rough           bool    `json:"rough"`            // no completed cycle yet: first-month estimate
}

// cycleResult is one cycle's real-money result over its days.
type cycleResult struct {
	Net  float64
	Days float64
}

func (r cycleResult) rate() float64 { return r.Net / r.Days }

// completedCycleResults returns each settled cycle's real result, newest
// first. A cycle is settled once handed over or stopped; its period ends at
// its settlement (the same rule as the handover carry-over).
func completedCycleResults(l ledger, k cycleClock) []cycleResult {
	var out []cycleResult
	for i := len(l.Cycles) - 1; i >= 0; i-- {
		c := l.Cycles[i]
		next := successorStart(c, l.Cycles)
		if next == nil && c.EndedAt == nil && c.StoppedAt == nil {
			continue // still running
		}
		horizon := k.Now
		if next != nil && next.Before(horizon) {
			horizon = *next
		}
		end := settlementEnd(c, horizon)
		if !end.After(c.CycleStartAt) || end.After(k.Now) {
			continue
		}
		days := end.Sub(c.CycleStartAt).Hours() / 24
		if days < 1 {
			continue // too short to say anything about a trend
		}
		start := c.CycleStartAt
		out = append(out, cycleResult{Net: l.moneyAt(&end) - l.moneyAt(&start), Days: days})
	}
	return out
}

// currentCycleResult projects the current cycle's real result to its payday.
func currentCycleResult(l ledger, c models.SalaryCycle, k cycleClock) cycleResult {
	start := c.CycleStartAt
	total := float64(k.cycleLengthDays(c))
	elapsed := math.Max(0, k.Now.Sub(start).Hours()/24)
	remainingDays := math.Max(0, total-elapsed)
	if k.paydayStatus(c) == paydayStatusPassed {
		remainingDays = 0
	}

	var own []windowTx
	w := cycleWindow{Start: start}
	for _, t := range l.Txs {
		if w.contains(t.At) {
			own = append(own, t)
		}
	}
	totals := tallyCycle(c, own)

	var projectedSpend float64
	if elapsed >= forecastPaceMinDays {
		projectedSpend = totals.VariableExp / elapsed * remainingDays
	} else if remainingDays > 0 {
		// Too early for a pace: assume this cycle's own budget gets spent as
		// planned; the carried-over money is not this cycle's to spend down.
		carryLeft := math.Max(0, c.CarryOver-totals.CarryMoved)
		projectedSpend = math.Max(0, totals.remaining(c)-carryLeft)
	}
	net := l.moneyAt(nil) - l.moneyAt(&start) - projectedSpend
	return cycleResult{Net: net, Days: math.Max(total, elapsed)}
}

// blendedDailyRate is the recency-weighted daily result: completed cycles
// (newest first) weigh 1, 0.5, 0.25, …; the current cycle, if any, weighs 1.
// ok is false when there is nothing to base it on. Pure.
func blendedDailyRate(completedNewestFirst []cycleResult, current *cycleResult) (float64, bool) {
	var weighted, weights float64
	w := 1.0
	for _, r := range completedNewestFirst {
		weighted += w * r.rate()
		weights += w
		w *= forecastDecay
	}
	if current != nil {
		weighted += current.rate()
		weights++
	}
	if weights == 0 {
		return 0, false
	}
	return weighted / weights, true
}

// forecastSavings builds the forecast; nil when the user never had a cycle.
func forecastSavings(uid uint, k cycleClock) *savingsForecast {
	l, ok := loadLedger(uid, k)
	if !ok {
		return nil
	}
	completed := completedCycleResults(l, k)
	var current *cycleResult
	if c := k.currentCycle(l.Cycles); c != nil {
		r := currentCycleResult(l, *c, k)
		current = &r
	}
	rate, ok := blendedDailyRate(completed, current)
	if !ok {
		return nil
	}

	f := &savingsForecast{
		MoneyNow:        round2(l.moneyAt(nil)),
		AnnualChange:    round2(rate * daysPerYear),
		CompletedCycles: len(completed),
		Rough:           len(completed) == 0,
	}
	if current != nil {
		f.CycleResult = round2(current.Net)
	}
	f.InAYear = round2(f.MoneyNow + f.AnnualChange)
	return f
}

// GetSavingsForecast — GET /api/balance/forecast
// The savings forecast (see forecastSavings); {"forecast": null} for users who
// never had a cycle.
func GetSavingsForecast(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)
	c.JSON(http.StatusOK, gin.H{"forecast": forecastSavings(uid, requestClock(c, uid))})
}
