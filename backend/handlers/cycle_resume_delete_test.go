package handlers

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// callHandlerParam drives a handler with a URL param (e.g. :id).
func callHandlerParam(uid uint, params gin.Params, h gin.HandlerFunc) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
	c.Params = params
	c.Set("userID", uid)
	h(c)
	return w
}

// §2: a cycle hard-deleted from history (row gone) is neither offered for resume
// nor accepted.
func TestHotfix_DeletedCycleNotResumable(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "deleted")
	callHandler(u.ID, nil, StopSalaryCycle)

	var cyc models.SalaryCycle
	database.DB.Where("user_id = ?", u.ID).Order("cycle_start_at DESC").First(&cyc)
	wDel := callHandlerParam(u.ID, gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(cyc.ID), 10)}}, DeleteSalaryCycle)
	if wDel.Code != http.StatusOK {
		t.Fatalf("delete cycle: %d %s", wDel.Code, wDel.Body.String())
	}

	cur := getCurrent(t, u.ID)
	if cur["resumable_cycle"] != nil {
		t.Errorf("deleted cycle must not be resumable, got %v", cur["resumable_cycle"])
	}
	if decode(callHandler(u.ID, nil, ResumeSalaryCycle))["resumed"] != false {
		t.Error("resume of a deleted cycle must return resumed=false")
	}
}

// §2 (prod-FK case): a cycle whose row SURVIVES but whose income was removed
// (empty/inconsistent) must also not be resumable.
func TestHotfix_EmptiedCycleNotResumable(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "emptied")
	callHandler(u.ID, nil, StopSalaryCycle)

	// Simulate "delete from history" leaving the row intact: soft-delete the
	// cycle's income transactions (the Salary), so income drops to €0.
	if err := database.DB.Where("user_id = ? AND type = ?", u.ID, "income").
		Delete(&models.Transaction{}).Error; err != nil {
		t.Fatalf("soft-delete income: %v", err)
	}
	InvalidateCycleCache(u.ID)

	cur := getCurrent(t, u.ID)
	if cur["resumable_cycle"] != nil {
		t.Errorf("an emptied cycle must not be resumable, got %v", cur["resumable_cycle"])
	}
	if decode(callHandler(u.ID, nil, ResumeSalaryCycle))["resumed"] != false {
		t.Error("resume of an emptied cycle must return resumed=false")
	}

	// Control: an intact stopped cycle IS resumable (guards against false-negatives).
	u2 := startEditUser(t, "intact")
	callHandler(u2.ID, nil, StopSalaryCycle)
	if getCurrent(t, u2.ID)["resumable_cycle"] == nil {
		t.Error("an intact stopped cycle should still be resumable")
	}
}
