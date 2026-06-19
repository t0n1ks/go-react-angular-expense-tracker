package handlers

import "testing"

// TestTxDirection guards the export type-label mapping. The live bug was that a
// positive savings top-up (savings_deposit) printed as "Expense" because the
// exporter only treated "income" as an inflow. Each savings-pool transaction
// must be classified by its explicit type, not lumped into "Expense".
func TestTxDirection(t *testing.T) {
	cases := []struct {
		txType     string
		wantLabel  string
		wantIncome bool
	}{
		{"income", "Income", true},
		{"savings_deposit", "Income", true},   // +€147.90 top-up → Income
		{"savings_withdrawal", "Expense", false},
		{"expense", "Expense", false},
		{"", "Expense", false}, // unknown/legacy → safe default
	}

	for _, tc := range cases {
		gotLabel, gotIncome := txDirection(tc.txType)
		if gotLabel != tc.wantLabel || gotIncome != tc.wantIncome {
			t.Errorf("txDirection(%q) = (%q, %v); want (%q, %v)",
				tc.txType, gotLabel, gotIncome, tc.wantLabel, tc.wantIncome)
		}
	}
}
