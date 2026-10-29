package handlers

import (
	"math"
	"time"
)

// ── Companion health: one stat, 0–100%, driven by real behaviour ─────────────
//
// health = 100 − spending penalty − engagement penalty, never below 25.
// Health never jumps: each local day it moves towards that day's target by at
// most −15 points (a bad moment lands over ~3 days, leaving time to correct)
// or +100/7 points (full recovery within a week).
//
//   - Spending penalty — from the pace ratio r = (share of the budget spent) ÷
//     (share of the period elapsed), the elapsed share floored at one week so
//     an hour into day 1 does not divide by almost zero:
//     r ≤ 1.10 → 0; 1.10–1.45 → 0→40 (linear); 1.45–2.15 → 40→45; budget
//     overspent → 60. The first 4 days of a period carry no spending penalty
//     at all (a big initial shop never hurts).
//   - Engagement penalty — after 7 days without catching a star or a cow the
//     UFO asks; from the day after asking, 3 points a day, capped at 15. A
//     catch closes the quest. Days the user was not asked cost nothing.
//
// Everything here is pure; the inputs are the dashboard's own figures.

const (
	healthMax        = 100.0
	healthFloor      = 25.0
	healthDropPerDay = 15.0
	healthRisePerDay = 100.0 / 7

	spendGraceDays    = 4.0 // no spending penalty while fewer days have elapsed
	spendWeekFloor    = 7.0 // elapsed share counts as at least a week
	spendPenaltyOver  = 60.0
	paceEdgeWarn      = 1.10
	paceEdgeOver      = 1.45
	paceEdgeTop       = 2.15
	paceHysteresis    = 0.05
	penaltyAtEdgeOver = 40.0
	penaltyAtEdgeTop  = 45.0

	questIdleDays    = 7
	questDrainPerDay = 3.0
	questDrainCap    = 15.0
)

// spendFacts are the facts of the current budget period (no projection).
type spendFacts struct {
	Active      bool    // there is a budget to measure against (cycle or monthly goal)
	Spent       float64 // variable spending so far
	Budget      float64 // the period's variable budget
	Overspent   bool    // budget left < 0
	ElapsedDays float64
	TotalDays   float64
}

// inGrace: the first days of a period, when spending never costs health.
func (f spendFacts) inGrace() bool { return f.ElapsedDays < spendGraceDays }

// paceRatio = share of budget spent ÷ share of the period elapsed (≥ a week).
func (f spendFacts) paceRatio() float64 {
	if f.Budget <= 0 {
		if f.Spent > 0 {
			return math.Inf(1)
		}
		return 0
	}
	total := math.Max(f.TotalDays, spendWeekFloor)
	timeShare := math.Max(f.ElapsedDays, spendWeekFloor) / total
	return (f.Spent / f.Budget) / timeShare
}

// penaltyForRatio maps a pace ratio to its spending penalty (the curve above).
func penaltyForRatio(r float64) float64 {
	switch {
	case r <= paceEdgeWarn:
		return 0
	case r <= paceEdgeOver:
		return (r - paceEdgeWarn) / (paceEdgeOver - paceEdgeWarn) * penaltyAtEdgeOver
	case r <= paceEdgeTop:
		return penaltyAtEdgeOver + (r-paceEdgeOver)/(paceEdgeTop-paceEdgeOver)*(penaltyAtEdgeTop-penaltyAtEdgeOver)
	default:
		return penaltyAtEdgeTop
	}
}

// spendPenalty is the period's target spending penalty.
func spendPenalty(f spendFacts) float64 {
	if !f.Active || f.inGrace() {
		return 0
	}
	if f.Overspent {
		return spendPenaltyOver
	}
	return penaltyForRatio(f.paceRatio())
}

// questOpen: the quest was asked and nothing was caught since.
func questOpen(askedAt, lastCatch *time.Time) bool {
	return askedAt != nil && (lastCatch == nil || lastCatch.Before(*askedAt))
}

// questDue: time to ask — a week without a catch (counted from the first
// meeting when nothing was ever caught) and not already asked.
func questDue(lastCatch *time.Time, since time.Time, askedAt *time.Time, now time.Time) bool {
	if questOpen(askedAt, lastCatch) {
		return false
	}
	ref := since
	if lastCatch != nil {
		ref = *lastCatch
	}
	return now.Sub(ref) >= questIdleDays*24*time.Hour
}

// questPenalty on a local day: 3 per day since the asking day, capped at 15;
// nothing while the quest is not open.
func questPenalty(askedAt, lastCatch *time.Time, day time.Time, k cycleClock) float64 {
	if !questOpen(askedAt, lastCatch) {
		return 0
	}
	days := localDaysBetween(k.dayStart(*askedAt), day, k)
	return math.Min(questDrainCap, questDrainPerDay*float64(max(days, 0)))
}

// localDaysBetween counts calendar days from a to b (both local midnights).
func localDaysBetween(a, b time.Time, k cycleClock) int {
	ay, am, ad := a.In(k.Loc).Date()
	by, bm, bd := b.In(k.Loc).Date()
	return int(time.Date(by, bm, bd, 0, 0, 0, 0, time.UTC).Sub(time.Date(ay, am, ad, 0, 0, 0, 0, time.UTC)).Hours() / 24)
}

// healthTarget combines both penalties, floored.
func healthTarget(spend, engage float64) float64 {
	return math.Max(healthFloor, math.Min(healthMax, healthMax-spend-engage))
}

// stepHealth moves h one day towards target within the daily caps.
func stepHealth(h, target float64) float64 {
	switch {
	case target < h:
		h = math.Max(target, h-healthDropPerDay)
	case target > h:
		h = math.Min(target, h+healthRisePerDay)
	}
	return math.Max(healthFloor, math.Min(healthMax, h))
}

// rollHealth catches the stored baseline up to yesterday (one step per missed
// local day) and returns it with today's value. targetOn gives a day's target.
func rollHealth(base float64, baseDay, today time.Time, k cycleClock, targetOn func(day time.Time) float64) (newBase float64, newBaseDay time.Time, current float64) {
	day := k.dayStart(baseDay).AddDate(0, 0, 1)
	for day.Before(today) {
		base = stepHealth(base, targetOn(day))
		day = day.AddDate(0, 0, 1)
	}
	return base, today.AddDate(0, 0, -1), stepHealth(base, targetOn(today))
}

// moodFor maps health to the UFO's five moods.
func moodFor(h float64) string {
	switch {
	case h >= 80:
		return "thriving"
	case h >= 60:
		return "content"
	case h >= 45:
		return "worried"
	case h >= 30:
		return "stressed"
	default:
		return "exhausted"
	}
}

// healthReason is the plain-language "why" behind the current health.
type healthReason struct {
	Type  string         `json:"type"`
	Slots map[string]any `json:"slots,omitempty"`
}

// explainHealth names the real cause of the current health: the biggest
// penalty, or recovery while health is climbing back.
func explainHealth(current, target, spend, engage float64, f spendFacts, questDays int) healthReason {
	switch {
	case current >= healthMax-0.5:
		if f.Active && f.inGrace() {
			return healthReason{Type: "grace"}
		}
		if !f.Active {
			return healthReason{Type: "all_good_free"}
		}
		return healthReason{Type: "all_good"}
	case target > current+0.5:
		return healthReason{Type: "recovering"}
	case spend >= engage && spend > 0:
		if f.Overspent {
			return healthReason{Type: "overspent"}
		}
		pct := 0.0
		if f.Budget > 0 {
			pct = math.Round(f.Spent / f.Budget * 100)
		}
		if f.ElapsedDays < spendWeekFloor {
			return healthReason{Type: "pace_ahead_week1", Slots: map[string]any{"spent_pct": pct}}
		}
		return healthReason{Type: "pace_ahead", Slots: map[string]any{
			"spent_pct": pct, "day": int(math.Ceil(f.ElapsedDays)), "days_total": int(math.Round(f.TotalDays)),
		}}
	case engage > 0:
		return healthReason{Type: "quest", Slots: map[string]any{"days": questDays}}
	default:
		return healthReason{Type: "recovering"}
	}
}

// paceBand classifies the pace with hysteresis: a band is entered only 0.05
// past its edge and left only 0.05 below it, so the verdict does not flicker.
// Bands: "good" < "warn" < "over".
func paceBand(r float64, prev string) string {
	edges := [3]float64{0, paceEdgeWarn, paceEdgeOver}
	level := map[string]int{"warn": 1, "over": 2}[prev]
	for level < 2 && r > edges[level+1]+paceHysteresis {
		level++
	}
	for level > 0 && r < edges[level]-paceHysteresis {
		level--
	}
	return [3]string{"good", "warn", "over"}[level]
}
