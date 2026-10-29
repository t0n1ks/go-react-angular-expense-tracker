package handlers

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Pure boundary tests (fixed clock, no DB) ─────────────────────────────────

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

func dateOnly(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func ptr(t time.Time) *time.Time { return &t }

// The bug-report cycle: started 28.09, payday 28.10.2026, user in Berlin
// (CET, UTC+1 after the 25.10 DST change).
func reportCycle(berlin *time.Location) models.SalaryCycle {
	return models.SalaryCycle{
		ID:           1,
		CycleStartAt: time.Date(2026, 9, 28, 10, 0, 0, 0, berlin),
		NextPaydayAt: ptr(dateOnly(2026, 10, 28)),
	}
}

// On the payday the cycle is current and the payday transaction is counted;
// after the payday it STAYS current (no void) until a new cycle starts.
func TestPaydayBoundaryIsLocalAndGapFree(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	old := reportCycle(berlin)
	all := []models.SalaryCycle{old}

	cases := []struct {
		at     time.Time
		status string
	}{
		{time.Date(2026, 10, 27, 23, 59, 0, 0, berlin), paydayStatusUpcoming},
		{time.Date(2026, 10, 28, 0, 30, 0, 0, berlin), paydayStatusToday}, // 23:30 UTC on the 27th
		{time.Date(2026, 10, 28, 15, 59, 0, 0, berlin), paydayStatusToday},
		{time.Date(2026, 10, 29, 0, 0, 0, 0, berlin), paydayStatusPassed},
		{time.Date(2026, 11, 5, 12, 0, 0, 0, berlin), paydayStatusPassed},
	}
	for _, c := range cases {
		k := newCycleClock(c.at, berlin)
		if got := k.paydayStatus(old); got != c.status {
			t.Errorf("%v: payday status %q, want %q", c.at, got, c.status)
		}
		if !k.isCurrent(old, all) {
			t.Errorf("%v: cycle must stay current until handed over (no gap)", c.at)
		}
		tx := models.Transaction{CreatedAt: c.at, Date: k.storedDate(c.at)}
		if !k.window(old, all).contains(k.txEventAt(tx)) {
			t.Errorf("%v: a transaction entered now must count in the current cycle", c.at)
		}
	}
}

// Old ends exactly where new begins: 15:59 → old, 16:00 → new, and a
// transaction dated the payday but entered the day after → old (decision b).
func TestHandoverIsExact(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	handover := time.Date(2026, 10, 28, 16, 0, 0, 0, berlin)
	old := reportCycle(berlin)
	old.EndedAt = ptr(handover)
	next := models.SalaryCycle{ID: 2, CycleStartAt: handover, NextPaydayAt: ptr(dateOnly(2026, 11, 28))}
	all := []models.SalaryCycle{old, next}
	k := newCycleClock(time.Date(2026, 10, 30, 9, 0, 0, 0, berlin), berlin)

	before := models.Transaction{CreatedAt: handover.Add(-time.Minute), Date: dateOnly(2026, 10, 28)}
	at := models.Transaction{CreatedAt: handover, Date: dateOnly(2026, 10, 28)}
	backdated := models.Transaction{CreatedAt: time.Date(2026, 10, 29, 11, 0, 0, 0, berlin), Date: dateOnly(2026, 10, 28)}

	oldW, newW := k.window(old, all), k.window(next, all)
	for name, tc := range map[string]struct {
		tx        models.Transaction
		inOld     bool
		inCurrent bool
	}{
		"15:59 on payday":            {before, true, false},
		"16:00 on payday":            {at, false, true},
		"dated payday, entered next": {backdated, true, false},
	} {
		ev := k.txEventAt(tc.tx)
		if oldW.contains(ev) != tc.inOld || newW.contains(ev) != tc.inCurrent {
			t.Errorf("%s: inOld=%v inNew=%v, want %v/%v", name, oldW.contains(ev), newW.contains(ev), tc.inOld, tc.inCurrent)
		}
		if oldW.contains(ev) == newW.contains(ev) {
			t.Errorf("%s: must belong to exactly one cycle", name)
		}
	}
	if k.isCurrent(old, all) || !k.isCurrent(next, all) {
		t.Error("after the handover only the new cycle may be current")
	}
}

// A new cycle may start on the payday — stopped first or not — but never
// inside the old cycle's planned days.
func TestOverlapAllowsPaydayHandoverOnly(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	k := newCycleClock(time.Date(2026, 10, 28, 16, 0, 0, 0, berlin), berlin)
	nextPayday := ptr(dateOnly(2026, 11, 28))

	for _, stopped := range []bool{false, true} {
		old := reportCycle(berlin)
		if stopped {
			old.StoppedAt = ptr(k.Now.Add(-time.Minute))
		}
		all := []models.SalaryCycle{old}
		if ex := k.conflictingCycle(k.Now, nextPayday, all); ex != nil {
			t.Errorf("stopped=%v: starting on the payday must not overlap", stopped)
		}
		if ex := k.conflictingCycle(k.dayStart(k.Now), nextPayday, all); ex != nil {
			t.Errorf("stopped=%v: starting at 00:00 on the payday must not overlap", stopped)
		}
		midCycle := time.Date(2026, 10, 20, 9, 0, 0, 0, berlin)
		if ex := k.conflictingCycle(midCycle, nextPayday, all); ex == nil {
			t.Errorf("stopped=%v: starting inside the old cycle's days must overlap", stopped)
		}
	}
}

// Changing country moves only the OPEN edge (today/passed) of the current
// cycle; a handed-over cycle's window is fixed instants in every zone.
func TestTimezoneChangeMovesOnlyOpenEdge(t *testing.T) {
	berlin, ny := mustLoc(t, "Europe/Berlin"), mustLoc(t, "America/New_York")
	instant := time.Date(2026, 10, 28, 23, 30, 0, 0, time.UTC) // Berlin 29th 00:30 · NY 28th 19:30
	open := reportCycle(berlin)

	if got := newCycleClock(instant, berlin).paydayStatus(open); got != paydayStatusPassed {
		t.Errorf("Berlin: status %q, want passed", got)
	}
	if got := newCycleClock(instant, ny).paydayStatus(open); got != paydayStatusToday {
		t.Errorf("New York: status %q, want today", got)
	}

	closed := reportCycle(berlin)
	closed.EndedAt = ptr(time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC))
	wb := newCycleClock(instant, berlin).window(closed, []models.SalaryCycle{closed})
	wn := newCycleClock(instant, ny).window(closed, []models.SalaryCycle{closed})
	if !wb.Start.Equal(wn.Start) || !wb.End.Equal(*wn.End) {
		t.Errorf("closed window differs by zone: %v..%v vs %v..%v", wb.Start, *wb.End, wn.Start, *wn.End)
	}
}

func TestResolveCycleStart(t *testing.T) {
	berlin := mustLoc(t, "Europe/Berlin")
	now := time.Date(2026, 10, 28, 16, 5, 30, 123456789, berlin)
	k := newCycleClock(now, berlin)

	cases := []struct {
		date, hm string
		want     time.Time
	}{
		{"", "", now},           // today → now
		{"2026-10-28", "", now}, // today → now (not noon)
		{"2026-10-27", "", time.Date(2026, 10, 27, 0, 0, 0, 0, berlin)}, // past date → 00:00 local
		{"2026-10-27", "16:00", time.Date(2026, 10, 27, 16, 0, 0, 0, berlin)},
		{"2026-10-28", "23:00", now}, // future time today → clamped
	}
	for _, c := range cases {
		got, err := resolveCycleStart(c.date, c.hm, k)
		if err != nil {
			t.Fatalf("%q %q: %v", c.date, c.hm, err)
		}
		if want := c.want.UTC().Truncate(time.Microsecond); !got.Equal(want) {
			t.Errorf("%q %q: got %v, want %v", c.date, c.hm, got, want)
		}
	}
	if _, err := resolveCycleStart("2026-10-27", "4pm", k); err == nil {
		t.Error("an invalid time must be rejected")
	}
}

// ── Handler-level flows (real clock, explicit timezone) ───────────────────────

// callHandlerTZ is callHandler with the X-User-Timezone header set.
func callHandlerTZ(uid uint, body any, h gin.HandlerFunc, tz string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(body)
	c.Request = httptest.NewRequest(http.MethodPost, "/", &buf)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set(userTimezoneHeader, tz)
	c.Set("userID", uid)
	h(c)
	return w
}

// udate is a UTC calendar date `days` from today (the flows below run in UTC).
func udate(days int) string { return time.Now().UTC().AddDate(0, 0, days).Format("2006-01-02") }

type currentResp struct {
	HasActive    bool       `json:"has_active_cycle"`
	PaydayStatus string     `json:"payday_status"`
	WindowStart  time.Time  `json:"window_start"`
	WindowEnd    *time.Time `json:"window_end"`
	Cycle        struct {
		ID uint `json:"id"`
	} `json:"cycle"`
	Stats *struct {
		CycleIncome   float64 `json:"cycle_income"`
		CycleExpenses float64 `json:"cycle_expenses"`
	} `json:"cycle_stats"`
}

func readCurrent(t *testing.T, uid uint) currentResp {
	t.Helper()
	InvalidateCycleCache(uid)
	w := callHandlerTZ(uid, nil, GetCurrentSalaryCycle, "UTC")
	var r currentResp
	if err := json.Unmarshal(w.Body.Bytes(), &r); err != nil {
		t.Fatalf("decode current: %v (%s)", err, w.Body.String())
	}
	return r
}

func newTZUser(t *testing.T, name string) models.User {
	t.Helper()
	setupFlowDB(t)
	u := models.User{Username: name, Password: "x"}
	if err := database.DB.Create(&u).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u
}

func startUTC(t *testing.T, uid uint, received, payday string) *httptest.ResponseRecorder {
	t.Helper()
	return callHandlerTZ(uid, map[string]any{
		"base_salary": 504.0, "language": "ru",
		"needs_pct": 50.0, "wants_pct": 30.0, "savings_pct": 20.0,
		"received_at_date": received, "next_payday_date": payday,
	}, StartSalaryCycle, "UTC")
}

func addExpense(t *testing.T, uid uint, amount float64, date string) {
	t.Helper()
	var cat models.Category
	database.DB.Where("user_id = ? AND translation_key = ?", uid, "category.income").First(&cat)
	if cat.ID == 0 {
		database.DB.Where("user_id = ?", uid).First(&cat)
	}
	w := callHandlerTZ(uid, map[string]any{
		"category_id": cat.ID, "amount": amount, "date": date, "type": "expense",
	}, CreateTransaction, "UTC")
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateTransaction: %d %s", w.Code, w.Body.String())
	}
}

// listExpensesInWindow sums expenses from GET /transactions whose effective_at
// lies in the cycle window the server reports — what Statistics/list show for
// the same period.
func listExpensesInWindow(t *testing.T, uid uint, r currentResp) float64 {
	t.Helper()
	w := callHandlerTZ(uid, nil, GetTransactions, "UTC")
	var out struct {
		Transactions []models.Transaction `json:"transactions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode transactions: %v", err)
	}
	win := cycleWindow{Start: r.WindowStart, End: r.WindowEnd}
	var sum float64
	for _, tx := range out.Transactions {
		if tx.Type == "expense" && tx.EffectiveAt != nil && win.contains(*tx.EffectiveAt) {
			sum += tx.Amount
		}
	}
	return sum
}

// Regression for the screenshot: on the payday the cycle is current, the
// payday expense is counted, and the cards equal the list for that window.
func TestPaydayExpenseCountedAndMatchesList(t *testing.T) {
	u := newTZUser(t, "payday")
	if w := startUTC(t, u.ID, udate(-30), udate(0)); w.Code != http.StatusCreated {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	addExpense(t, u.ID, 10, udate(0))

	r := readCurrent(t, u.ID)
	if !r.HasActive || r.PaydayStatus != paydayStatusToday {
		t.Fatalf("payday: active=%v status=%q, want true/today", r.HasActive, r.PaydayStatus)
	}
	if r.Stats == nil || math.Abs(r.Stats.CycleExpenses-10) > 0.001 {
		t.Fatalf("payday expense not counted: %+v", r.Stats)
	}
	if list := listExpensesInWindow(t, u.ID, r); math.Abs(list-r.Stats.CycleExpenses) > 0.001 {
		t.Errorf("cards %.2f != list %.2f for the same window", r.Stats.CycleExpenses, list)
	}
}

// After the payday, with no new cycle yet, the old cycle stays current and
// keeps counting — including a backdated entry — and still matches the list.
func TestPaydayPassedKeepsCountingAndMatchesList(t *testing.T) {
	u := newTZUser(t, "passed")
	if w := startUTC(t, u.ID, udate(-30), udate(-2)); w.Code != http.StatusCreated {
		t.Fatalf("start: %d %s", w.Code, w.Body.String())
	}
	addExpense(t, u.ID, 7, udate(0))
	addExpense(t, u.ID, 3, udate(-1)) // backdated into the gap

	r := readCurrent(t, u.ID)
	if !r.HasActive || r.PaydayStatus != paydayStatusPassed || r.WindowEnd != nil {
		t.Fatalf("gap: active=%v status=%q end=%v, want true/passed/open", r.HasActive, r.PaydayStatus, r.WindowEnd)
	}
	if math.Abs(r.Stats.CycleExpenses-10) > 0.001 {
		t.Errorf("gap expenses = %.2f, want 10", r.Stats.CycleExpenses)
	}
	if list := listExpensesInWindow(t, u.ID, r); math.Abs(list-r.Stats.CycleExpenses) > 0.001 {
		t.Errorf("cards %.2f != list %.2f in the gap", r.Stats.CycleExpenses, list)
	}
}

// Stop, then start the next cycle on the payday: no overlap error, an exact
// handover, and the old cycle's spend stays with the old cycle.
func TestStopThenStartSameDay(t *testing.T) {
	for _, stopFirst := range []bool{true, false} {
		u := newTZUser(t, "handover")
		startUTC(t, u.ID, udate(-30), udate(0))
		addExpense(t, u.ID, 10, udate(0))
		// Spent a minute before the payout (15:59 vs 16:00). Without the gap a
		// coarse wall clock (Windows ticks ~0.5–15 ms) can stamp the expense and
		// the new start identically, and [start, end) rightly gives a tie to
		// the new cycle.
		database.DB.Model(&models.Transaction{}).
			Where("user_id = ? AND type = ?", u.ID, "expense").
			Update("created_at", time.Now().Add(-time.Minute))
		old := readCurrent(t, u.ID)

		if stopFirst {
			callHandlerTZ(u.ID, nil, StopSalaryCycle, "UTC")
		}
		w := startUTC(t, u.ID, udate(0), udate(30))
		if w.Code != http.StatusCreated {
			t.Fatalf("stopFirst=%v: start on payday: %d %s", stopFirst, w.Code, w.Body.String())
		}

		r := readCurrent(t, u.ID)
		if !r.HasActive || r.Cycle.ID == old.Cycle.ID {
			t.Fatalf("stopFirst=%v: new cycle must be current", stopFirst)
		}
		if math.Abs(r.Stats.CycleIncome-504) > 0.001 || r.Stats.CycleExpenses != 0 {
			t.Errorf("stopFirst=%v: new cycle income=%.2f expenses=%.2f, want 504/0",
				stopFirst, r.Stats.CycleIncome, r.Stats.CycleExpenses)
		}

		var prev models.SalaryCycle
		database.DB.First(&prev, old.Cycle.ID)
		if prev.EndedAt == nil || !prev.EndedAt.Equal(r.WindowStart) {
			t.Errorf("stopFirst=%v: old ended_at=%v, want exactly the new start %v", stopFirst, prev.EndedAt, r.WindowStart)
		}
		if prev.NextPaydayAt == nil || toDateOnly(*prev.NextPaydayAt).Format("2006-01-02") != udate(0) {
			t.Errorf("stopFirst=%v: old cycle's planned payday must be untouched", stopFirst)
		}
	}
}

// The morning-only cache-test bug: a cycle received "today" used to start at
// 12:00, dropping same-morning transactions. It now starts at the moment of
// creation, so an expense right after it always counts.
func TestCycleReceivedTodayStartsNow(t *testing.T) {
	u := newTZUser(t, "morning")
	before := time.Now()
	startUTC(t, u.ID, udate(0), udate(30))
	addExpense(t, u.ID, 12.5, udate(0))

	r := readCurrent(t, u.ID)
	if r.WindowStart.Before(before.Add(-time.Second)) || r.WindowStart.After(time.Now()) {
		t.Errorf("cycle start %v, want the creation moment", r.WindowStart)
	}
	if math.Abs(r.Stats.CycleExpenses-12.5) > 0.001 {
		t.Errorf("expense right after the start not counted: %.2f", r.Stats.CycleExpenses)
	}
}

// The device zone is remembered on the profile and used when a request (or
// background job) carries no header.
func TestTimezoneHeaderRemembered(t *testing.T) {
	u := newTZUser(t, "traveller")
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Request.Header.Set(userTimezoneHeader, "America/New_York")
	c.Set("userID", u.ID)
	UserTimezone()(c)

	if got := storedUserTimezone(u.ID); got != "America/New_York" {
		t.Fatalf("stored timezone %q, want America/New_York", got)
	}
	if got := userClock(u.ID).Loc.String(); got != "America/New_York" {
		t.Errorf("header-less clock zone %q, want the remembered one", got)
	}

	c2, _ := gin.CreateTestContext(httptest.NewRecorder())
	c2.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c2.Request.Header.Set(userTimezoneHeader, "Not/AZone")
	c2.Set("userID", u.ID)
	UserTimezone()(c2)
	if got := storedUserTimezone(u.ID); got != "America/New_York" {
		t.Errorf("an invalid header must not overwrite the zone, got %q", got)
	}
}

// Deleting the successor from history reopens the handed-over cycle instead
// of leaving a gap.
func TestDeleteSuccessorReopensPredecessor(t *testing.T) {
	u := newTZUser(t, "undo")
	startUTC(t, u.ID, udate(-30), udate(0))
	old := readCurrent(t, u.ID)
	startUTC(t, u.ID, udate(0), udate(30))
	next := readCurrent(t, u.ID)

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
	c.Params = gin.Params{{Key: "id", Value: jsonID(next.Cycle.ID)}}
	c.Set("userID", u.ID)
	DeleteSalaryCycle(c)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}

	r := readCurrent(t, u.ID)
	if !r.HasActive || r.Cycle.ID != old.Cycle.ID || r.WindowEnd != nil {
		t.Errorf("predecessor not reopened: active=%v id=%v end=%v", r.HasActive, r.Cycle.ID, r.WindowEnd)
	}
}

func jsonID(id uint) string {
	b, _ := json.Marshal(id)
	return string(b)
}

// The companion's daily caps (AI service) roll over at the user's local
// midnight: localDate is the user's calendar day, not UTC's or the server's.
func TestLocalDateIsTheUsersCalendarDay(t *testing.T) {
	berlin := time.FixedZone("UTC+1", 3600)
	newYork := time.FixedZone("UTC-5", -5*3600)
	late := time.Date(2026, 11, 1, 22, 30, 0, 0, time.UTC)         // 23:30 in Berlin
	afterMidnight := time.Date(2026, 11, 1, 23, 5, 0, 0, time.UTC) // 00:05 in Berlin
	if got := newCycleClock(late, berlin).localDate(); got != "2026-11-01" {
		t.Fatalf("23:30 local = %s, want 2026-11-01", got)
	}
	if got := newCycleClock(afterMidnight, berlin).localDate(); got != "2026-11-02" {
		t.Fatalf("00:05 local = %s, want 2026-11-02", got)
	}
	if got := newCycleClock(time.Date(2026, 11, 2, 1, 0, 0, 0, time.UTC), newYork).localDate(); got != "2026-11-01" {
		t.Fatalf("20:00 New York = %s, want 2026-11-01", got)
	}
	if got := newCycleClock(late, nil).localDate(); got != "2026-11-01" {
		t.Fatalf("unknown zone must fall back to UTC, got %s", got)
	}
}
