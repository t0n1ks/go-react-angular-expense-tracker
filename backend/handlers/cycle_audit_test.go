package handlers

import (
	"net/http"
	"testing"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// A valid end-date edit appends exactly one audit row with the old→new values;
// an idempotent no-op appends none.
func TestCycleAudit_RecordsEndDateEdit(t *testing.T) {
	setupFlowDB(t)
	u := startEditUser(t, "audit")

	if w := patchPayday(u.ID, dstr(45), false); w.Code != http.StatusOK {
		t.Fatalf("edit: %d %s", w.Code, w.Body.String())
	}

	var rows []models.SalaryCycleAudit
	database.DB.Where("user_id = ?", u.ID).Find(&rows)
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	a := rows[0]
	if a.Field != "next_payday_at" {
		t.Errorf("field: want next_payday_at, got %q", a.Field)
	}
	if a.OldValue != dstr(30) || a.NewValue != dstr(45) {
		t.Errorf("old/new: want %s->%s, got %s->%s", dstr(30), dstr(45), a.OldValue, a.NewValue)
	}

	// A no-op (same date) must NOT append another row.
	if w := patchPayday(u.ID, dstr(45), false); w.Code != http.StatusOK {
		t.Fatalf("noop: %d", w.Code)
	}
	var count int64
	database.DB.Model(&models.SalaryCycleAudit{}).Where("user_id = ?", u.ID).Count(&count)
	if count != 1 {
		t.Errorf("no-op should not audit; audit rows=%d", count)
	}

	// A preview must NOT append a row either.
	patchPayday(u.ID, dstr(60), true)
	database.DB.Model(&models.SalaryCycleAudit{}).Where("user_id = ?", u.ID).Count(&count)
	if count != 1 {
		t.Errorf("preview should not audit; audit rows=%d", count)
	}
}
