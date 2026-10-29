package handlers

import (
	"encoding/json"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Health curve ─────────────────────────────────────────────────────────────

func TestSpendingPenaltyCurve(t *testing.T) {
	week1 := func(share float64) spendFacts {
		return spendFacts{Active: true, Spent: share * 450, Budget: 450, ElapsedDays: 5, TotalDays: 30}
	}
	if r := week1(1.0 / 3).paceRatio(); math.Abs(r-1.4286) > 0.001 {
		t.Errorf("⅓ in week 1: r = %v, want 1.4286 (elapsed share floored at a week)", r)
	}
	approx(t, "⅓ of the budget in week 1 ≈ −38%", math.Round(spendPenalty(week1(1.0/3))), 38)
	approx(t, "½ of the budget in week 1 ≈ −45%", math.Round(spendPenalty(week1(0.5))), 45)
	approx(t, "on pace", penaltyForRatio(1.0), 0)
	approx(t, "edge 1.10", penaltyForRatio(1.10), 0)
	approx(t, "edge 1.45", penaltyForRatio(1.45), 40)
	approx(t, "edge 2.15", penaltyForRatio(2.15), 45)
	approx(t, "beyond", penaltyForRatio(9), 45)
	over := spendFacts{Active: true, Spent: 500, Budget: 450, Overspent: true, ElapsedDays: 20, TotalDays: 30}
	approx(t, "overspent", spendPenalty(over), 60)
}

func TestSpendingGraceFirstFourDays(t *testing.T) {
	f := spendFacts{Active: true, Spent: 300, Budget: 450, ElapsedDays: 3.9, TotalDays: 30}
	approx(t, "grace: a big initial shop costs nothing", spendPenalty(f), 0)
	f.Overspent = true
	approx(t, "grace holds even when overspent", spendPenalty(f), 0)
	f.ElapsedDays, f.Overspent = 4, false
	if spendPenalty(f) == 0 {
		t.Error("from day 5 the curve applies")
	}
	approx(t, "no budget → engagement-only", spendPenalty(spendFacts{Active: false, Spent: 99}), 0)
}

// day n of a 30-day cycle, measured at noon.
func dayFacts(n int, spent float64) spendFacts {
	return spendFacts{Active: true, Spent: spent, Budget: 450, ElapsedDays: float64(n) - 0.5, TotalDays: 30}
}

func TestSteadyPaceStaysFull(t *testing.T) {
	h := 100.0
	for n := 1; n <= 30; n++ {
		h = stepHealth(h, healthTarget(spendPenalty(dayFacts(n, 15*(float64(n)-0.5))), 0))
		if h != 100 {
			t.Fatalf("€15/day on a €450 budget: day %d health %v, want 100", n, h)
		}
	}
}

func TestDayOneShopGraceThenCurveThenRecovery(t *testing.T) {
	h, got := 100.0, map[int]float64{}
	for n := 1; n <= 10; n++ {
		h = stepHealth(h, healthTarget(spendPenalty(dayFacts(n, 150)), 0))
		got[n] = h
	}
	for n := 1; n <= 4; n++ {
		approx(t, "grace days stay full", got[n], 100)
	}
	approx(t, "day 5: first capped step", got[5], 85)
	approx(t, "day 6", got[6], 70)
	if math.Abs(got[7]-62.45) > 0.1 {
		t.Errorf("day 7 settles at the ⅓-in-week-1 level (≈62%%), got %v", got[7])
	}
	if got[8] <= got[7] || got[10] != 100 {
		t.Errorf("as time catches up health recovers, full again by day 10: %v", got)
	}
}

func TestOverspendDropsGraduallyThenRecoversWithinAWeek(t *testing.T) {
	h := 100.0
	for _, want := range []float64{85, 70, 55, 40, 40} {
		h = stepHealth(h, healthTarget(spendPenaltyOver, 0))
		approx(t, "−15/day to 40", h, want)
	}
	if moodFor(h) != "stressed" {
		t.Errorf("40%% reads stressed, got %s", moodFor(h))
	}
	days := 0
	for h < 100 {
		h = stepHealth(h, 100)
		days++
	}
	if days > 7 {
		t.Errorf("recovery from 40%% took %d days, want ≤ 7", days)
	}
}

func TestHealthFloorAndMoodBands(t *testing.T) {
	approx(t, "floor", healthTarget(60, 15), 25)
	approx(t, "floor holds even beyond", stepHealth(25, 0), 25)
	for h, mood := range map[float64]string{100: "thriving", 80: "thriving", 79: "content", 60: "content",
		59: "worried", 45: "worried", 44: "stressed", 30: "stressed", 29: "exhausted", 25: "exhausted"} {
		if moodFor(h) != mood {
			t.Errorf("health %v: mood %s, want %s", h, moodFor(h), mood)
		}
	}
}

func TestRollHealthCatchesUpMissedDays(t *testing.T) {
	k := newCycleClock(time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC), time.UTC)
	today := k.dayStart(k.Now)
	base, baseDay, current := rollHealth(100, today.AddDate(0, 0, -5), today, k, func(time.Time) float64 { return 40 })
	approx(t, "four missed days stepped", base, 40)
	approx(t, "today", current, 40)
	if !baseDay.Equal(today.AddDate(0, 0, -1)) {
		t.Errorf("baseline must be yesterday, got %v", baseDay)
	}
	_, _, current = rollHealth(100, today.AddDate(0, 0, -1), today, k, func(time.Time) float64 { return 40 })
	approx(t, "one visit a day: one capped step", current, 85)
}

// ── Quest ────────────────────────────────────────────────────────────────────

func TestQuestDrainOnlyAfterAsking(t *testing.T) {
	k := newCycleClock(time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC), time.UTC)
	asked := time.Date(2026, 10, 20, 18, 0, 0, 0, time.UTC)
	day := func(d int) time.Time { return time.Date(2026, 10, d, 0, 0, 0, 0, time.UTC) }

	approx(t, "never asked → no drain", questPenalty(nil, nil, day(29), k), 0)
	approx(t, "asking day", questPenalty(&asked, nil, day(20), k), 0)
	approx(t, "day after", questPenalty(&asked, nil, day(21), k), 3)
	approx(t, "capped", questPenalty(&asked, nil, day(29), k), 15)
	caught := asked.Add(30 * time.Hour)
	approx(t, "a catch closes it", questPenalty(&asked, &caught, day(29), k), 0)

	met := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	if questDue(nil, met, nil, met.Add(6*24*time.Hour)) {
		t.Error("not due before a week")
	}
	if !questDue(nil, met, nil, met.Add(7*24*time.Hour)) {
		t.Error("due after a week without a catch")
	}
	if questDue(nil, met, &asked, k.Now) {
		t.Error("an open quest is not asked again")
	}
}

// ── Reasons and bands ────────────────────────────────────────────────────────

func TestHealthReasonNamesTheRealCause(t *testing.T) {
	f := dayFacts(6, 150)
	r := explainHealth(70, 62, spendPenalty(f), 0, f, 0)
	if r.Type != "pace_ahead_week1" || r.Slots["spent_pct"] != 33.0 {
		t.Errorf("want pace_ahead_week1 with 33%%, got %+v", r)
	}
	f = dayFacts(20, 405)
	if r := explainHealth(70, 70, spendPenalty(f), 0, f, 0); r.Type != "pace_ahead" || r.Slots["day"] != 20 {
		t.Errorf("want pace_ahead on day 20, got %+v", r)
	}
	if r := explainHealth(88, 88, 0, 12, spendFacts{}, 10); r.Type != "quest" {
		t.Errorf("want quest, got %+v", r)
	}
	if r := explainHealth(70, 100, 0, 0, dayFacts(15, 100), 0); r.Type != "recovering" {
		t.Errorf("want recovering, got %+v", r)
	}
	if r := explainHealth(100, 100, 0, 0, dayFacts(2, 300), 0); r.Type != "grace" {
		t.Errorf("want grace, got %+v", r)
	}
	if r := explainHealth(100, 100, 0, 0, spendFacts{}, 0); r.Type != "all_good_free" {
		t.Errorf("want all_good_free, got %+v", r)
	}
}

func TestPaceBandHysteresis(t *testing.T) {
	cases := []struct {
		r          float64
		prev, want string
	}{
		{1.12, "good", "good"}, // inside the dead zone: stays
		{1.16, "good", "warn"},
		{1.08, "warn", "warn"}, // just under the edge: stays
		{1.04, "warn", "good"},
		{1.48, "warn", "warn"},
		{1.51, "warn", "over"},
		{1.42, "over", "over"},
		{1.30, "over", "warn"},
		{0.9, "over", "good"},
		{2.0, "", "over"},
	}
	for _, c := range cases {
		if got := paceBand(c.r, c.prev); got != c.want {
			t.Errorf("r=%.2f prev=%q: %s, want %s", c.r, c.prev, got, c.want)
		}
	}
}

// ── Reaction engine ──────────────────────────────────────────────────────────

func baseInput() reactionInput {
	k := newCycleClock(time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC), time.UTC)
	return reactionInput{
		Now: k.Now, K: k,
		Sig: financeSignals{
			Basis: periodBasisCycle, Facts: dayFacts(20, 405), Remaining: 45, DaysLeft: 10.5,
			PeriodStart: k.Now.AddDate(0, 0, -20), WeekStart: k.Now.AddDate(0, 0, -6), WeekIndex: 2,
		},
		Memory: companionMemory{Fired: map[string]int64{}, Reactions: map[string][2]int{}},
	}
}

func types(cs []candidate) []string {
	out := []string{}
	for _, c := range cs {
		out = append(out, c.Type)
	}
	return out
}

func TestReactionPriorityOrder(t *testing.T) {
	in := baseInput()
	in.Sig.Facts.Overspent, in.Sig.Remaining = true, -12
	in.PrevBand, in.Band = "good", "warn"
	in.QuestDue = true
	cands := collectCandidates(in)
	got := chooseByRules(cands, in.Memory, gateState{}, in.Now)
	if got == nil || got.Type != "overspent" {
		t.Fatalf("critical first, got %v from %v", got, types(cands))
	}
	if got.Slots["over"] != 12.0 {
		t.Errorf("over = %v", got.Slots["over"])
	}

	in.WasOverspent = true // already told: once per crossing
	got = chooseByRules(collectCandidates(in), in.Memory, gateState{}, in.Now)
	if got == nil || got.Type != "pace_warn" {
		t.Fatalf("then the band change, got %+v", got)
	}
}

func TestPaceMessagesOnlyOnCrossing(t *testing.T) {
	in := baseInput()
	in.PrevBand, in.Band = "warn", "warn"
	for _, c := range collectCandidates(in) {
		if c.Type == "pace_warn" || c.Type == "pace_over" || c.Type == "pace_recovered" {
			t.Errorf("no band change, no pace message: %v", c.Type)
		}
	}
	in.PrevBand, in.Band = "over", "good"
	if !contains(types(collectCandidates(in)), "pace_recovered") {
		t.Error("back to good → pace_recovered")
	}
	in.PrevBand, in.Band = "", "over" // first meeting is primed silently
	if contains(types(collectCandidates(in)), "pace_over") {
		t.Error("no message without a previous band")
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestReactionPacing(t *testing.T) {
	in := baseInput()
	now := in.Now
	quest := []candidate{{Type: "quest_ask"}}
	big := []candidate{{Type: "big_expense", Slots: map[string]any{}}}
	recent := now.Add(-time.Hour)

	if chooseByRules(big, in.Memory, gateState{DayCount: companionDailyCap}, now) != nil {
		t.Error("daily cap of 4 holds")
	}
	if chooseByRules(quest, in.Memory, gateState{LastMsgAt: &recent}, now) != nil {
		t.Error("rhythm/quest keep 3 hours apart")
	}
	if chooseByRules(big, in.Memory, gateState{LastMsgAt: &recent}, now) == nil {
		t.Error("a just-happened event is not held back by the quiet gap")
	}
	in.Memory.Fired["big_expense"] = now.Add(-time.Hour).Unix()
	if chooseByRules(big, in.Memory, gateState{}, now) != nil {
		t.Error("per-type cooldown (12h)")
	}
}

func TestDismissedTypesAreShownLess(t *testing.T) {
	in := baseInput()
	now := in.Now
	big := []candidate{{Type: "big_expense", Slots: map[string]any{}}}
	in.Memory.Fired["big_expense"] = now.Add(-30 * time.Hour).Unix()

	if chooseByRules(big, in.Memory, gateState{}, now) == nil {
		t.Fatal("neutral: the 12h cooldown has passed")
	}
	in.Memory.Reactions["big_expense"] = [2]int{0, 2}
	if chooseByRules(big, in.Memory, gateState{}, now) == nil {
		t.Error("too few reactions to judge: unchanged")
	}
	in.Memory.Reactions["big_expense"] = [2]int{0, 6}
	if s := in.Memory.cooldownStretch("big_expense"); s != maxCooldownStretch {
		t.Errorf("stretch = %v, want %v", s, maxCooldownStretch)
	}
	if chooseByRules(big, in.Memory, gateState{}, now) != nil {
		t.Error("a type the user keeps dismissing waits longer (4 × 24h)")
	}
	in.Memory.Reactions["big_expense"] = [2]int{6, 0}
	if s := in.Memory.cooldownStretch("big_expense"); s != 1 {
		t.Errorf("a welcome type is never slowed, stretch %v", s)
	}
}

func TestWeekCheckinNeverCitesAProjectionWhileCalibrating(t *testing.T) {
	in := baseInput()
	end := -40.0
	in.Sig.Calibrating, in.Sig.ForecastEnd = true, &end
	for _, c := range collectCandidates(in) {
		if _, has := c.Slots["forecast_end"]; has {
			t.Errorf("%s cites a projection during the collecting-data week", c.Type)
		}
	}
	in.Sig.Calibrating = false
	for _, c := range collectCandidates(in) {
		if c.Type == "week_checkin" && c.Slots["forecast_end"] != -40.0 {
			t.Errorf("after week 1 the check-in quotes the card's number, got %v", c.Slots["forecast_end"])
		}
	}
}

// ── Personal insights ────────────────────────────────────────────────────────

func TestCategoryBaselineSpeaksFromTenEntries(t *testing.T) {
	b := categoryBaseline{Median: 20, Count: 9}
	if _, ok := unusualExpense(80, b, true); ok {
		t.Error("silent below 10 entries")
	}
	b.Count = 10
	if r, ok := unusualExpense(60, b, true); !ok || r != 3 {
		t.Errorf("€60 vs usual €20 → about 3×, got %v %v", r, ok)
	}
	if _, ok := unusualExpense(40, b, true); ok {
		t.Error("2× is not unusual")
	}
	if _, ok := unusualExpense(6, categoryBaseline{Median: 2, Count: 12}, true); ok {
		t.Error("tiny absolute differences never count")
	}
}

func TestHeavyWeekdayNeedsFourWeeks(t *testing.T) {
	k := newCycleClock(time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC), time.UTC) // a Thursday
	build := func(days int) []windowTx {
		var txs []windowTx
		for i := 0; i < days; i++ {
			at := k.Now.AddDate(0, 0, -i)
			amt := 5.0
			if at.Weekday() == time.Friday {
				amt = 50
			}
			txs = append(txs, windowTx{Transaction: models.Transaction{Type: "expense", Amount: amt}, At: at})
		}
		return txs
	}
	if _, ok := heavyWeekday(build(20), 0, 0, k); ok {
		t.Error("silent before four weeks of history")
	}
	d, ok := heavyWeekday(build(35), 0, 0, k)
	if !ok || d != time.Friday {
		t.Errorf("Fridays are the heavy day, got %v %v", d, ok)
	}
}

// ── Handler flows ────────────────────────────────────────────────────────────

func companionGet(t *testing.T, uid uint) companionView {
	t.Helper()
	InvalidateCycleCache(uid)
	w := callHandlerTZ(uid, nil, GetCompanionState, "UTC")
	var v companionView
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode companion: %v (%s)", err, w.Body.String())
	}
	return v
}

func TestCompanionEngagementOnlyWithoutBudget(t *testing.T) {
	u := newTZUser(t, "companionfree")
	v := companionGet(t, u.ID)
	if v.Health != 100 || v.Basis != periodBasisNone || v.Message != nil || v.Reason.Type != "all_good_free" {
		t.Errorf("no budget: full health, engagement-only, quiet first meeting; got %+v", v)
	}
	var st models.CompanionState
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.UserID != u.ID {
		t.Error("the state row is created on the first meeting")
	}
}

func TestCompanionLiteIsEngagementOnly(t *testing.T) {
	u := newTZUser(t, "companionlite")
	startUTC(t, u.ID, udate(-10), udate(20))
	addExpense(t, u.ID, 380, udate(-9))
	database.DB.Model(&u).Update("lite_mode", true)
	if v := companionGet(t, u.ID); v.Basis != periodBasisNone || v.Health != 100 {
		t.Errorf("Lite: no financial penalty, got %+v", v)
	}
}

func TestCompanionCycleFlow(t *testing.T) {
	u := newTZUser(t, "companionflow")
	startUTC(t, u.ID, udate(-10), udate(20))
	addExpense(t, u.ID, 300, udate(-9))

	v := companionGet(t, u.ID)
	if v.Basis != periodBasisCycle || v.Health != 85 || v.Reason.Type != "pace_ahead" {
		t.Fatalf("spending ahead of pace: one capped step (85%%) with the reason; got %+v", v)
	}
	// The weekly check-in quotes exactly the forecast card's figure.
	if v.Message == nil || v.Message.Type != "week_checkin" {
		t.Fatalf("week 2 starts with a check-in, got %+v", v.Message)
	}
	card := periodEndNow(t, u.ID)
	if v.Message.Slots["forecast_end"] != card.ProjectedEnd {
		t.Errorf("check-in forecast %v ≠ card %v", v.Message.Slots["forecast_end"], card.ProjectedEnd)
	}

	// Something just happened: new income.
	cat := models.Category{}
	database.DB.Where("user_id = ?", u.ID).First(&cat)
	w := callHandlerTZ(u.ID, map[string]any{"category_id": cat.ID, "amount": 50.0, "date": udate(0), "type": "income"}, CreateTransaction, "UTC")
	if w.Code != http.StatusCreated {
		t.Fatalf("income: %d %s", w.Code, w.Body.String())
	}
	v = companionGet(t, u.ID)
	if v.Message == nil || v.Message.Type != "income" || v.Message.Slots["amount"] != 50.0 {
		t.Fatalf("want the income reaction, got %+v", v.Message)
	}
	if again := companionGet(t, u.ID); again.Message != nil && again.Message.Type == "income" {
		t.Error("an event is reacted to once")
	}

	// Reactions and catches.
	if w := callHandlerTZ(u.ID, map[string]any{"type": "income", "reaction": "dismissed"}, ReactToCompanionMessage, "UTC"); w.Code != http.StatusNoContent {
		t.Errorf("reaction: %d", w.Code)
	}
	if w := callHandlerTZ(u.ID, map[string]any{"type": "nope", "reaction": "tapped"}, ReactToCompanionMessage, "UTC"); w.Code != http.StatusBadRequest {
		t.Errorf("unknown type must be rejected, got %d", w.Code)
	}
	if w := callHandlerTZ(u.ID, map[string]any{"kind": "star"}, CatchCompanionEntity, "UTC"); w.Code != http.StatusOK {
		t.Errorf("catch: %d", w.Code)
	}
	var st models.CompanionState
	database.DB.First(&st, "user_id = ?", u.ID)
	if st.LastCatchAt == nil || decodeMemory(st).Reactions["income"] != [2]int{0, 1} {
		t.Errorf("catch and reaction stored, got %+v", st)
	}
}

func TestCompanionWeekOneHasNoProjection(t *testing.T) {
	u := newTZUser(t, "companionweek1")
	startUTC(t, u.ID, udate(-2), udate(28))
	addExpense(t, u.ID, 250, udate(-1))
	var user models.User
	database.DB.First(&user, u.ID)
	InvalidateCycleCache(u.ID)
	sig := companionFinance(user, userClock(u.ID))
	if !sig.Calibrating || sig.ForecastEnd != nil {
		t.Errorf("week 1: calibrating, no projection available to cite; got %+v", sig)
	}
	if v := companionGet(t, u.ID); v.Health != 100 || v.Reason.Type != "grace" {
		t.Errorf("a big initial shop never hurts in the grace days, got %+v", v)
	}
}
