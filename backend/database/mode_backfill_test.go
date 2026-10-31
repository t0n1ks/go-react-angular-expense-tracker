package database

import (
	"testing"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// Rows from before the mode tag become "extended" with nothing else changed;
// a user already in Lite gets a first Lite period. Running it again is a no-op.
func TestBackfillTransactionMode(t *testing.T) {
	db := openStartupDB(t)
	u := models.User{Username: "old", Password: "x"}
	db.Create(&u)
	lite := models.User{Username: "lite", Password: "x", LiteMode: true}
	db.Create(&lite)
	cat := models.Category{UserID: u.ID, Name: "Food"}
	db.Create(&cat)
	tx := models.Transaction{UserID: u.ID, CategoryID: cat.ID, Amount: 12.5, Description: "lunch",
		Date: dateOnly(2026, 10, 3), Type: "expense"}
	db.Create(&tx)
	// Shape it like a pre-tag row.
	db.Exec("UPDATE transactions SET mode = '' WHERE id = ?", tx.ID)
	var before models.Transaction
	db.First(&before, tx.ID)

	runStartupMaintenance()
	runStartupMaintenance()

	var after models.Transaction
	db.First(&after, tx.ID)
	if after.Mode != models.TxModeExtended {
		t.Fatalf("mode = %q, want extended", after.Mode)
	}
	if after.Amount != before.Amount || after.Description != before.Description ||
		!after.Date.Equal(before.Date) || after.Type != before.Type || after.CategoryID != before.CategoryID ||
		!after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("row content changed:\n before %+v\n after  %+v", before, after)
	}

	var lu, ou models.User
	db.First(&lu, lite.ID)
	db.First(&ou, u.ID)
	if lu.LitePeriod != 1 || lu.LiteStartedAt == nil {
		t.Fatalf("Lite user not given a period: %+v", lu)
	}
	if ou.LitePeriod != 0 || ou.LiteStartedAt != nil {
		t.Fatalf("non-Lite user touched: %+v", ou)
	}
}
