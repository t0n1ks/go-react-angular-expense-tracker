package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

func reloadUser(t *testing.T, id uint) models.User {
	t.Helper()
	var u models.User
	if err := database.DB.First(&u, id).Error; err != nil {
		t.Fatalf("reload user: %v", err)
	}
	return u
}

// PATCH /api/profile changes only the display name / avatar it is sent —
// never the login (username) nor any other setting.
func TestUpdateProfileIdentity(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "alice", Password: "x", Currency: "EUR", AIAdviceEnabled: true, MonthlySpendingGoal: 500}
	if err := database.DB.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if u := reloadUser(t, user.ID); u.DisplayName != "" || u.Avatar != "" {
		t.Fatalf("an existing user starts with no name / avatar, got %q / %q", u.DisplayName, u.Avatar)
	}

	// Name only, trimmed.
	w := callHandler(user.ID, map[string]any{"display_name": "  Анна Мария  "}, UpdateProfileIdentity)
	if w.Code != http.StatusOK {
		t.Fatalf("name: %d %s", w.Code, w.Body.String())
	}
	u := reloadUser(t, user.ID)
	if u.DisplayName != "Анна Мария" || u.Avatar != "" {
		t.Fatalf("name saved as %q (avatar %q)", u.DisplayName, u.Avatar)
	}

	// Avatar only; the name stays.
	w = callHandler(user.ID, map[string]any{"avatar": "sea-lion"}, UpdateProfileIdentity)
	var resp map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if w.Code != http.StatusOK || resp["avatar"] != "sea-lion" || resp["display_name"] != "Анна Мария" {
		t.Fatalf("avatar: %d %v", w.Code, resp)
	}

	// Back to the letter.
	w = callHandler(user.ID, map[string]any{"avatar": ""}, UpdateProfileIdentity)
	if w.Code != http.StatusOK || reloadUser(t, user.ID).Avatar != "" {
		t.Fatalf("clear avatar: %d %s", w.Code, w.Body.String())
	}

	// Nothing else moved.
	u = reloadUser(t, user.ID)
	if u.Username != "alice" || u.Currency != "EUR" || !u.AIAdviceEnabled || u.MonthlySpendingGoal != 500 {
		t.Fatalf("other fields changed: %+v", u)
	}
}

func TestUpdateProfileIdentityValidation(t *testing.T) {
	setupFlowDB(t)
	user := models.User{Username: "bob", Password: "x", DisplayName: "Bob", Avatar: "koala"}
	if err := database.DB.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	cases := []struct {
		name string
		body map[string]any
		code string
	}{
		{"empty name", map[string]any{"display_name": "   "}, "name_empty"},
		{"long name", map[string]any{"display_name": strings.Repeat("я", 51)}, "name_too_long"},
		{"unknown avatar", map[string]any{"avatar": "dragon"}, "avatar_unknown"},
		{"path as avatar", map[string]any{"avatar": "../shark"}, "avatar_unknown"},
	}
	for _, tc := range cases {
		w := callHandler(user.ID, tc.body, UpdateProfileIdentity)
		var resp map[string]string
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		if w.Code != http.StatusBadRequest || resp["code"] != tc.code {
			t.Errorf("%s: got %d %v, want 400 %s", tc.name, w.Code, resp, tc.code)
		}
	}
	// A rejected request changes nothing.
	if u := reloadUser(t, user.ID); u.DisplayName != "Bob" || u.Avatar != "koala" {
		t.Fatalf("rejected request changed the profile: %q / %q", u.DisplayName, u.Avatar)
	}
	// 50 characters is fine.
	if w := callHandler(user.ID, map[string]any{"display_name": strings.Repeat("я", 50)}, UpdateProfileIdentity); w.Code != http.StatusOK {
		t.Fatalf("50-char name rejected: %d", w.Code)
	}
}
