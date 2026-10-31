package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// listTx calls GET /transactions with the given query string.
func listTx(t *testing.T, uid uint, query string) []models.Transaction {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/"+query, nil)
	c.Request.Header.Set(userTimezoneHeader, "UTC")
	c.Set("userID", uid)
	GetTransactions(c)
	if w.Code != http.StatusOK {
		t.Fatalf("list %q: %d", query, w.Code)
	}
	var resp struct {
		Transactions []models.Transaction `json:"transactions"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	return resp.Transactions
}

func amountsOf(txs []models.Transaction) []float64 {
	out := make([]float64, 0, len(txs))
	for _, tx := range txs {
		out = append(out, tx.Amount)
	}
	sort.Float64s(out)
	return out
}

func sameAmounts(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ?other_mode=1 returns exactly the other mode's rows, tagged; the default
// list (and so every figure built on it) is unchanged; nothing is re-tagged.
func TestListOtherModeIsAdditiveAndViewOnly(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "other", Password: "x", MonthlySpendingGoal: 500}
	database.DB.Create(&u)
	cat := models.Category{UserID: u.ID, Name: "Food"}
	database.DB.Create(&cat)

	addModeExpense(t, u.ID, cat.ID, 10, udate(0)) // extended
	addModeExpense(t, u.ID, cat.ID, 20, udate(0))
	setLite(t, u.ID, true)
	addModeExpense(t, u.ID, cat.ID, 3, udate(0)) // Lite
	liteBudget := callHandlerTZ(u.ID, nil, GetCurrentBudget, "UTC").Body.String()

	// In Lite: own list = Lite rows; other = extended rows, tagged extended.
	if got := amountsOf(listTx(t, u.ID, "")); !sameAmounts(got, []float64{3}) {
		t.Fatalf("Lite default list: %v", got)
	}
	other := listTx(t, u.ID, "?other_mode=1")
	if got := amountsOf(other); !sameAmounts(got, []float64{10, 20}) {
		t.Fatalf("Lite other-mode list: %v", got)
	}
	for _, tx := range other {
		if tx.Mode != models.TxModeExtended {
			t.Fatalf("other-mode row %d tagged %q", tx.ID, tx.Mode)
		}
	}
	// Reading the other mode changes no figure.
	if again := callHandlerTZ(u.ID, nil, GetCurrentBudget, "UTC").Body.String(); again != liteBudget {
		t.Fatalf("Lite budget changed after the other-mode read:\n%s\n%s", liteBudget, again)
	}

	// In extended: the mirror image.
	setLite(t, u.ID, false)
	if got := amountsOf(listTx(t, u.ID, "")); !sameAmounts(got, []float64{10, 20}) {
		t.Fatalf("extended default list: %v", got)
	}
	other = listTx(t, u.ID, "?other_mode=1")
	if got := amountsOf(other); !sameAmounts(got, []float64{3}) || other[0].Mode != models.TxModeLite {
		t.Fatalf("extended other-mode list: %v", got)
	}

	// No row moved or re-tagged.
	var modes []string
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", u.ID).Order("amount").Pluck("mode", &modes)
	if len(modes) != 3 || modes[0] != models.TxModeLite || modes[1] != models.TxModeExtended || modes[2] != models.TxModeExtended {
		t.Fatalf("modes changed: %v", modes)
	}
}

// The preference is saved by PATCH /profile (only when sent) and read back.
func TestShowOtherModePreference(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "pref", Password: "x", DisplayName: "Pref"}
	database.DB.Create(&u)
	read := func() bool {
		var m map[string]any
		_ = json.Unmarshal(callHandler(u.ID, nil, GetProfile).Body.Bytes(), &m)
		return m["show_other_mode"] == true
	}
	if read() {
		t.Fatal("default must be off")
	}
	if w := callHandler(u.ID, map[string]any{"show_other_mode": true}, UpdateProfileIdentity); w.Code != http.StatusOK {
		t.Fatalf("patch: %d", w.Code)
	}
	if !read() {
		t.Fatal("not saved")
	}
	// A name-only PATCH leaves it alone; the name stays when only the flag is sent.
	callHandler(u.ID, map[string]any{"display_name": "New"}, UpdateProfileIdentity)
	callHandler(u.ID, map[string]any{"show_other_mode": false}, UpdateProfileIdentity)
	var got models.User
	database.DB.First(&got, u.ID)
	if got.ShowOtherMode || got.DisplayName != "New" {
		t.Fatalf("got %+v", got)
	}
}
