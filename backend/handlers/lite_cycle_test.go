package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func setupLiteCycleDB(t *testing.T) {
	t.Helper()
	setupFlowDB(t)
	if err := database.DB.AutoMigrate(&models.LiteCycleReconcile{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}

// liteCycleUser makes a user with the given Lite flag and, optionally, a
// salary cycle started 40 days ago whose payday is long past — never stopped
// or handed over, so it is current (or stopped, when stopped is true).
func liteCycleUser(t *testing.T, name string, lite, withCycle, stopped bool) (models.User, *models.SalaryCycle) {
	t.Helper()
	u := models.User{Username: name, Password: "x", LiteMode: lite, LitePeriod: 1}
	database.DB.Create(&u)
	if !withCycle {
		return u, nil
	}
	start := time.Now().Add(-40 * 24 * time.Hour)
	payday := start.Add(30 * 24 * time.Hour)
	cyc := models.SalaryCycle{UserID: u.ID, TotalIncome: 2000, BaseSalary: 2000, CycleStartAt: start, NextPaydayAt: &payday}
	if stopped {
		at := time.Now().Add(-time.Hour)
		cyc.StoppedAt = &at
	}
	database.DB.Create(&cyc)
	return u, &cyc
}

func putLite(uid uint, on bool) int {
	body := map[string]any{"currency": "EUR", "monthly_spending_goal": 500, "lite_mode": on}
	return callHandler(uid, body, UpdateProfile).Code
}

func liteFlag(uid uint) bool {
	var u models.User
	database.DB.Select("lite_mode").First(&u, uid)
	return u.LiteMode
}

// Lite can always be switched off — with a current cycle, with a stopped one,
// with none — and never loops back on.
func TestLiteOffIsAlwaysAllowed(t *testing.T) {
	setupLiteCycleDB(t)
	cases := []struct {
		name               string
		withCycle, stopped bool
	}{
		{"nocycle", false, false},
		{"stoppedcycle", true, true},
		{"activecycle", true, false}, // the locked state
	}
	for _, tc := range cases {
		u, _ := liteCycleUser(t, "off-"+tc.name, true, tc.withCycle, tc.stopped)
		if code := putLite(u.ID, false); code != http.StatusOK {
			t.Fatalf("%s: switching Lite off returned %d, want 200", tc.name, code)
		}
		if liteFlag(u.ID) {
			t.Fatalf("%s: Lite still on after switching it off", tc.name)
		}
		// Saving again (Lite off) stays off.
		if code := putLite(u.ID, false); code != http.StatusOK || liteFlag(u.ID) {
			t.Fatalf("%s: second save: code %d lite %v", tc.name, code, liteFlag(u.ID))
		}
	}
}

// Switching Lite ON waits for the cycle to stop; without a current cycle it works.
func TestLiteOnRefusedWhileCycleIsCurrent(t *testing.T) {
	setupLiteCycleDB(t)
	u, cyc := liteCycleUser(t, "on-active", false, true, false)
	w := callHandler(u.ID, map[string]any{"currency": "EUR", "lite_mode": true}, UpdateProfile)
	if w.Code != http.StatusConflict {
		t.Fatalf("Lite on with a current cycle: %d, want 409", w.Code)
	}
	var resp struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Code != "LITE_BLOCKED_BY_CYCLE" || liteFlag(u.ID) {
		t.Fatalf("code %q lite %v", resp.Code, liteFlag(u.ID))
	}

	// Stop the cycle → Lite may be switched on.
	if w := callHandler(u.ID, nil, StopSalaryCycle); w.Code != http.StatusOK {
		t.Fatalf("stop: %d", w.Code)
	}
	if code := putLite(u.ID, true); code != http.StatusOK || !liteFlag(u.ID) {
		t.Fatalf("Lite on after stopping: code %d lite %v", code, liteFlag(u.ID))
	}
	// The stopped cycle is intact.
	var after models.SalaryCycle
	database.DB.First(&after, cyc.ID)
	if after.TotalIncome != cyc.TotalIncome || !after.CycleStartAt.Equal(cyc.CycleStartAt) {
		t.Fatalf("cycle changed: %+v", after)
	}

	free, _ := liteCycleUser(t, "on-free", false, false, false)
	if code := putLite(free.ID, true); code != http.StatusOK || !liteFlag(free.ID) {
		t.Fatalf("Lite on without a cycle: code %d lite %v", code, liteFlag(free.ID))
	}
}

// An account with Lite on AND a current cycle is reconciled on profile load:
// Lite off (recorded, reversible); the cycle and transactions are untouched.
// Lite users with only a stopped cycle keep Lite.
func TestProfileReconcilesLiteWithCurrentCycle(t *testing.T) {
	setupLiteCycleDB(t)
	stuck, cyc := liteCycleUser(t, "stuck", true, true, false)
	cat := models.Category{UserID: stuck.ID, Name: "Food"}
	database.DB.Create(&cat)
	tx := models.Transaction{UserID: stuck.ID, CategoryID: cat.ID, Amount: 42, Description: "d",
		Date: time.Now(), Type: "expense", Mode: models.TxModeLite, LitePeriod: 1}
	database.DB.Create(&tx)
	calm, _ := liteCycleUser(t, "calm", true, true, true)

	profile := func(uid uint) map[string]any {
		w := callHandler(uid, nil, GetProfile)
		if w.Code != http.StatusOK {
			t.Fatalf("profile: %d", w.Code)
		}
		var m map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &m)
		return m
	}
	if p := profile(stuck.ID); p["lite_mode"] != false {
		t.Fatalf("stuck account: lite_mode %v, want false", p["lite_mode"])
	}
	if liteFlag(stuck.ID) {
		t.Fatal("stuck account: Lite still stored on")
	}
	var recs []models.LiteCycleReconcile
	database.DB.Find(&recs)
	if len(recs) != 1 || recs[0].UserID != stuck.ID || recs[0].CycleID != cyc.ID {
		t.Fatalf("reconcile record: %+v", recs)
	}
	var cycAfter models.SalaryCycle
	database.DB.First(&cycAfter, cyc.ID)
	if cycAfter.StoppedAt != nil || cycAfter.EndedAt != nil || cycAfter.TotalIncome != 2000 {
		t.Fatalf("cycle changed: %+v", cycAfter)
	}
	var txAfter models.Transaction
	database.DB.First(&txAfter, tx.ID)
	if txAfter.Amount != 42 || txAfter.Mode != models.TxModeLite || txAfter.LitePeriod != 1 {
		t.Fatalf("transaction changed: %+v", txAfter)
	}

	if p := profile(calm.ID); p["lite_mode"] != true {
		t.Fatalf("Lite user with a stopped cycle: lite_mode %v, want true", p["lite_mode"])
	}

	// Reversible: the recorded flag can be restored exactly.
	database.DB.Exec("UPDATE users SET lite_mode = true WHERE id IN (SELECT user_id FROM lite_cycle_reconciles)")
	if !liteFlag(stuck.ID) {
		t.Fatal("revert did not restore Lite")
	}
}

// Resuming a stopped cycle (like starting one) switches Lite off.
func TestResumeCycleSwitchesLiteOff(t *testing.T) {
	setupLiteCycleDB(t)
	u := models.User{Username: "resume", Password: "x", LiteMode: true}
	database.DB.Create(&u)
	start := time.Now().Add(-5 * 24 * time.Hour)
	payday := time.Now().Add(20 * 24 * time.Hour)
	stopped := time.Now().Add(-time.Hour)
	cyc := models.SalaryCycle{UserID: u.ID, TotalIncome: 1000, BaseSalary: 1000, CycleStartAt: start, NextPaydayAt: &payday, StoppedAt: &stopped}
	database.DB.Create(&cyc)
	cat := models.Category{UserID: u.ID, Name: "Salary"}
	database.DB.Create(&cat)
	database.DB.Create(&models.Transaction{UserID: u.ID, CategoryID: cat.ID, Amount: 1000, Description: "Salary",
		Date: start, Type: "income", CreatedAt: start, UpdatedAt: start})

	w := callHandler(u.ID, nil, ResumeSalaryCycle)
	var resp struct {
		Resumed bool `json:"resumed"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if w.Code != http.StatusOK || !resp.Resumed {
		t.Fatalf("resume: %d %s", w.Code, w.Body.String())
	}
	if liteFlag(u.ID) {
		t.Fatal("Lite still on beside the resumed cycle")
	}
}
