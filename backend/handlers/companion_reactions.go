package handlers

import (
	"encoding/json"
	"math"
	"sort"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Companion reactions: the right message at the right moment ───────────────
//
// Every state check (dashboard load + the 10-minute poll) collects the
// messages that are true *now* from the real signals, each with a priority;
// the highest-priority one that passes the pacing rules is shown:
//
//	1 critical       overspent (once per crossing)
//	2 just happened  big expense vs the user's own category baseline,
//	                 savings deposit, new income
//	3 pace change    pace_warn / pace_over / pace_recovered (hysteresis)
//	4 rhythm         payday tomorrow, last days, weekly check-in, heavy weekday
//	5 quest          "catch me a star or a cow"
//
// Pacing: at most 4 messages a day; rhythm and quest also keep 3 hours apart;
// every type has its own cooldown, stretched for types the user keeps
// dismissing (tapped vs dismissed, neutral start). Texts are never chosen
// here: a message is a type + the numbers it needs (Stage D renders it).

const (
	companionDailyCap  = 4
	companionQuietGap  = 3 * time.Hour
	responsivenessMin  = 4 // reactions before the score may stretch a cooldown
	responsivenessBase = 0.5
	maxCooldownStretch = 4.0
)

// companionMessage is what the client shows: a type and its numbers; Text is
// the AI service's variant when available (else the client's own fallback).
type companionMessage struct {
	ID       string         `json:"id"`
	Type     string         `json:"type"`
	Priority int            `json:"priority"`
	Tone     string         `json:"tone"`
	Slots    map[string]any `json:"slots"`
	Text     string         `json:"text,omitempty"`
}

// messageRule is a message type's fixed pacing.
type messageRule struct {
	Priority int
	Tone     string
	Cooldown time.Duration // 0: once per crossing / period (checked when collected)
}

var companionRules = map[string]messageRule{
	"overspent":        {1, "gentle", 0},
	"big_expense":      {2, "supportive", 12 * time.Hour},
	"savings_deposit":  {2, "celebrate", 6 * time.Hour},
	"income":           {2, "supportive", 6 * time.Hour},
	"pace_warn":        {3, "supportive", 12 * time.Hour},
	"pace_over":        {3, "gentle", 12 * time.Hour},
	"pace_recovered":   {3, "celebrate", 12 * time.Hour},
	"payday_tomorrow":  {4, "supportive", 0},
	"last_days":        {4, "supportive", 0},
	"week_checkin":     {4, "supportive", 0},
	"weekday_heads_up": {4, "supportive", 6 * 24 * time.Hour},
	"quest_ask":        {5, "playful", 0},
}

// companionMemory is the decoded JSON memory of the state row.
type companionMemory struct {
	Fired     map[string]int64  // type → unix seconds last shown
	Reactions map[string][2]int // type → [tapped, dismissed]
}

func decodeMemory(st models.CompanionState) companionMemory {
	m := companionMemory{Fired: map[string]int64{}, Reactions: map[string][2]int{}}
	_ = json.Unmarshal([]byte(st.Fired), &m.Fired)
	_ = json.Unmarshal([]byte(st.Reactions), &m.Reactions)
	if m.Fired == nil {
		m.Fired = map[string]int64{}
	}
	if m.Reactions == nil {
		m.Reactions = map[string][2]int{}
	}
	return m
}

func (m companionMemory) encode(st *models.CompanionState) {
	f, _ := json.Marshal(m.Fired)
	r, _ := json.Marshal(m.Reactions)
	st.Fired, st.Reactions = string(f), string(r)
}

// firedAt is when a type was last shown (zero time when never).
func (m companionMemory) firedAt(typ string) time.Time {
	if s, ok := m.Fired[typ]; ok {
		return time.Unix(s, 0)
	}
	return time.Time{}
}

// responsiveness is the tapped share with a neutral Beta(1,1) start.
func (m companionMemory) responsiveness(typ string) float64 {
	r := m.Reactions[typ]
	return float64(r[0]+1) / float64(r[0]+r[1]+2)
}

// cooldownStretch: 1× for a neutral or welcome type, up to 4× for one the
// user keeps dismissing (only once enough reactions exist).
func (m companionMemory) cooldownStretch(typ string) float64 {
	r := m.Reactions[typ]
	if r[0]+r[1] < responsivenessMin {
		return 1
	}
	return math.Max(1, math.Min(maxCooldownStretch, responsivenessBase/m.responsiveness(typ)))
}

// candidate is a message that is true right now.
type candidate struct {
	Type  string
	Slots map[string]any
}

// reactionInput is everything the rules look at.
type reactionInput struct {
	Now          time.Time
	K            cycleClock
	Sig          financeSignals
	PrevBand     string
	Band         string // "" when the pace is not judged (no budget, grace, overspent)
	WasOverspent bool
	NewTxs       []windowTx // created since the last check, newest first
	Baselines    map[uint]categoryBaseline
	Categories   map[uint]models.Category
	HeavyDay     *time.Weekday
	QuestDue     bool
	Memory       companionMemory
}

// periodSlots are the "fact + option" numbers: what is left, for how long,
// and the daily amount that keeps the period on track.
func periodSlots(s financeSignals) map[string]any {
	return map[string]any{
		"remaining": round2(s.Remaining),
		"days_left": int(math.Ceil(s.DaysLeft)),
		"daily":     s.dailyLeft(),
	}
}

func withSlots(base map[string]any, extra map[string]any) map[string]any {
	out := make(map[string]any, len(base)+len(extra))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// collectCandidates lists every message that is true now. Pure.
func collectCandidates(in reactionInput) []candidate {
	var out []candidate
	sig, f := in.Sig, in.Sig.Facts
	ps := periodSlots(sig)

	// 1 — critical: the budget just went into the red.
	if f.Active && f.Overspent && !in.WasOverspent {
		out = append(out, candidate{"overspent", withSlots(ps, map[string]any{"over": round2(-sig.Remaining)})})
	}

	// 2 — just happened (newest first).
	for _, t := range in.NewTxs {
		switch {
		case t.Type == "income":
			out = append(out, candidate{"income", map[string]any{"amount": round2(t.Amount)}})
		case sig.PoolCatID > 0 && isBudgetFundedDeposit(t.Transaction, sig.PoolCatID) && !isSavingsAllocation(t.Transaction):
			out = append(out, candidate{"savings_deposit", map[string]any{"amount": round2(t.Amount), "saved_total": round2(sig.SavedTotal)}})
		case isVariableSpend(t.Transaction, sig.FixedCatID, sig.PoolCatID):
			b, ok := in.Baselines[t.CategoryID]
			if ratio, unusual := unusualExpense(t.Amount, b, ok); unusual {
				cat := in.Categories[t.CategoryID]
				extra := map[string]any{
					"amount": round2(t.Amount), "ratio": ratio,
					"category": cat.Name, "category_key": cat.TranslationKey,
				}
				if f.Active {
					extra = withSlots(ps, extra)
				}
				out = append(out, candidate{"big_expense", extra})
			}
		}
	}

	// 3 — the pace changed band.
	if in.Band != "" && in.PrevBand != "" && in.Band != in.PrevBand {
		pace := withSlots(ps, map[string]any{
			"spent_pct":   math.Round(f.Spent / math.Max(f.Budget, 0.01) * 100),
			"elapsed_pct": math.Round(f.ElapsedDays / math.Max(f.TotalDays, 1) * 100),
		})
		switch {
		case in.Band == "over":
			out = append(out, candidate{"pace_over", pace})
		case in.Band == "warn" && in.PrevBand == "good":
			out = append(out, candidate{"pace_warn", pace})
		case in.Band == "good":
			out = append(out, candidate{"pace_recovered", pace})
		}
	}

	// 4 — rhythm of the period.
	if f.Active {
		today := in.K.dayStart(in.Now)
		paydayTomorrow := sig.PaydayStart != nil && today.AddDate(0, 0, 1).Equal(*sig.PaydayStart)
		if paydayTomorrow && in.Memory.firedAt("payday_tomorrow").Before(sig.PeriodStart) {
			out = append(out, candidate{"payday_tomorrow", ps})
		}
		if !paydayTomorrow && sig.DaysLeft > 0 && sig.DaysLeft <= 3 && in.Memory.firedAt("last_days").Before(sig.PeriodStart) {
			out = append(out, candidate{"last_days", ps})
		}
		if sig.Basis == periodBasisCycle && sig.WeekIndex >= 1 && in.Memory.firedAt("week_checkin").Before(sig.WeekStart) {
			slots := withSlots(ps, map[string]any{"week": sig.WeekIndex + 1, "spent": round2(f.Spent)})
			// Never a projection while the forecast card is still collecting data.
			if !sig.Calibrating && sig.ForecastEnd != nil {
				slots["forecast_end"] = *sig.ForecastEnd
			}
			out = append(out, candidate{"week_checkin", slots})
		}
		if in.HeavyDay != nil && *in.HeavyDay == in.Now.In(in.K.Loc).Weekday() {
			out = append(out, candidate{"weekday_heads_up", withSlots(ps, map[string]any{"weekday": int(*in.HeavyDay)})})
		}
	}

	// 5 — the weekly quest.
	if in.QuestDue {
		out = append(out, candidate{"quest_ask", map[string]any{}})
	}
	return out
}

// gateState is the daily pacing memory.
type gateState struct {
	DayCount  int
	LastMsgAt *time.Time
}

// messageChooser picks at most one candidate. chooseByRules is today's
// implementation; a learned policy can replace it later on the same inputs.
type messageChooser func(cands []candidate, mem companionMemory, gate gateState, now time.Time) *candidate

// chooseByRules: highest priority first, within the daily cap, the quiet gap
// (rhythm and quest only) and each type's (possibly stretched) cooldown.
func chooseByRules(cands []candidate, mem companionMemory, gate gateState, now time.Time) *candidate {
	if gate.DayCount >= companionDailyCap {
		return nil
	}
	sorted := append([]candidate(nil), cands...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return companionRules[sorted[i].Type].Priority < companionRules[sorted[j].Type].Priority
	})
	for i := range sorted {
		c := sorted[i]
		rule := companionRules[c.Type]
		if rule.Priority >= 4 && gate.LastMsgAt != nil && now.Sub(*gate.LastMsgAt) < companionQuietGap {
			continue
		}
		cooldown := rule.Cooldown
		if rule.Priority > 1 {
			if stretch := mem.cooldownStretch(c.Type); stretch > 1 {
				cooldown = time.Duration(float64(max(cooldown, 24*time.Hour)) * stretch)
			}
		}
		if last := mem.firedAt(c.Type); cooldown > 0 && !last.IsZero() && now.Sub(last) < cooldown {
			continue
		}
		return &c
	}
	return nil
}

// toMessage turns a chosen candidate into the payload.
func (c candidate) toMessage(now time.Time) companionMessage {
	rule := companionRules[c.Type]
	return companionMessage{
		ID:       c.Type + "-" + now.Format("20060102T150405"),
		Type:     c.Type,
		Priority: rule.Priority,
		Tone:     rule.Tone,
		Slots:    c.Slots,
	}
}
