package handlers

import (
	"testing"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// TestTxDirection guards the export type-label mapping. The live bug was that a
// positive savings top-up (savings_deposit) printed as "Expense" because the
// exporter only treated "income" as an inflow. Each savings-pool transaction
// must be classified by its explicit type, not lumped into "Expense"; budget ↔
// savings moves are neither earning nor spending and print as "Transfer".
func TestTxDirection(t *testing.T) {
	cases := []struct {
		tx        models.Transaction
		wantLabel string
		wantFlow  txFlow
	}{
		{models.Transaction{Type: "income"}, "Income", flowIn},
		{models.Transaction{Type: "savings_deposit"}, "Income", flowIn}, // +€147.90 top-up → Income
		{models.Transaction{Type: "savings_withdrawal"}, "Expense", flowOut},
		{models.Transaction{Type: "expense"}, "Expense", flowOut},
		{models.Transaction{Type: ""}, "Expense", flowOut}, // unknown/legacy → safe default
		{models.Transaction{Type: budgetTransferType}, "Transfer", flowTransfer},
		{models.Transaction{Type: "savings_withdrawal", Source: savingsToBudgetSource}, "Transfer", flowTransfer},
	}

	en := pdfT("en")
	for _, tc := range cases {
		gotLabel, gotFlow := txDirection(tc.tx, en)
		if gotLabel != tc.wantLabel || gotFlow != tc.wantFlow {
			t.Errorf("txDirection(%q/%q) = (%q, %v); want (%q, %v)",
				tc.tx.Type, tc.tx.Source, gotLabel, gotFlow, tc.wantLabel, tc.wantFlow)
		}
	}

	// The same mapping must hold once the labels are localised.
	ru := pdfT("ru")
	if label, flow := txDirection(models.Transaction{Type: "savings_deposit"}, ru); label != "Доход" || flow != flowIn {
		t.Errorf(`txDirection(savings_deposit, ru) = (%q, %v); want ("Доход", in)`, label, flow)
	}
	if label, _ := txDirection(models.Transaction{Type: budgetTransferType}, ru); label != "Перевод" {
		t.Errorf(`txDirection(budget_transfer, ru) = %q; want "Перевод"`, label)
	}
	if got := pdfCategoryLabel("ru", variableBudgetCategoryKey, variableBudgetCategoryNm, "—"); got != "Переменный бюджет" {
		t.Errorf("variable budget category in ru = %q", got)
	}
}
