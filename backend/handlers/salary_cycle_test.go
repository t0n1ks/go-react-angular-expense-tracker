package handlers

import (
	"testing"
)

func TestComputeBudgetFramework_Standard50_30_20(t *testing.T) {
	fw := ComputeBudgetFramework(2500, 50, 30, 20, nil)

	assertEqual(t, "TotalIncome", 2500.0, fw.TotalIncome)
	assertEqual(t, "NeedsLimit", 1250.0, fw.NeedsLimit)
	assertEqual(t, "WantsLimit", 750.0, fw.WantsLimit)
	assertEqual(t, "SavingsLimit", 500.0, fw.SavingsLimit)
	assertEqual(t, "FixedNeedsTotal", 0.0, fw.FixedNeedsTotal)
	assertEqual(t, "FixedWantsTotal", 0.0, fw.FixedWantsTotal)
	assertEqual(t, "VarNeedsBudget", 1250.0, fw.VarNeedsBudget)
	assertEqual(t, "VarWantsBudget", 750.0, fw.VarWantsBudget)
	assertFalse(t, "DeficitWarning", fw.DeficitWarning)
}

func TestComputeBudgetFramework_WithFixedExpenses(t *testing.T) {
	fixed := []FixedExpenseInput{
		{Amount: 600, Description: "Rent", CategoryType: "need"},
		{Amount: 15, Description: "Netflix", CategoryType: "want"},
	}
	fw := ComputeBudgetFramework(2500, 50, 30, 20, fixed)

	assertEqual(t, "NeedsLimit", 1250.0, fw.NeedsLimit)
	assertEqual(t, "WantsLimit", 750.0, fw.WantsLimit)
	assertEqual(t, "SavingsLimit", 500.0, fw.SavingsLimit) // must be untouched
	assertEqual(t, "FixedNeedsTotal", 600.0, fw.FixedNeedsTotal)
	assertEqual(t, "FixedWantsTotal", 15.0, fw.FixedWantsTotal)
	assertEqual(t, "VarNeedsBudget", 650.0, fw.VarNeedsBudget)  // 1250 - 600
	assertEqual(t, "VarWantsBudget", 735.0, fw.VarWantsBudget)  // 750 - 15
	assertFalse(t, "DeficitWarning", fw.DeficitWarning)
}

func TestComputeBudgetFramework_Custom65_20_15(t *testing.T) {
	fixed := []FixedExpenseInput{
		{Amount: 800, Description: "Rent", CategoryType: "need"},
	}
	// Tight budget: 65% needs, 20% wants, 15% savings
	fw := ComputeBudgetFramework(1200, 65, 20, 15, fixed)

	assertApprox(t, "NeedsLimit", 780.0, fw.NeedsLimit)
	assertApprox(t, "WantsLimit", 240.0, fw.WantsLimit)
	assertApprox(t, "SavingsLimit", 180.0, fw.SavingsLimit)
	assertEqual(t, "FixedNeedsTotal", 800.0, fw.FixedNeedsTotal)
	assertApprox(t, "VarNeedsBudget", -20.0, fw.VarNeedsBudget)
	assertTrue(t, "DeficitWarning", fw.DeficitWarning)
	if fw.SuggestedProfile == nil {
		t.Error("SuggestedProfile should not be nil when deficit detected")
	}
}

func TestComputeBudgetFramework_SavingsPoolUntouched(t *testing.T) {
	// Fixed expenses — even a very large subscription — must never reduce SavingsLimit
	fixed := []FixedExpenseInput{
		{Amount: 50, Description: "Gym", CategoryType: "want"},
		{Amount: 200, Description: "Insurance", CategoryType: "need"},
	}
	fw := ComputeBudgetFramework(3000, 50, 30, 20, fixed)

	assertEqual(t, "SavingsLimit stays at 600", 600.0, fw.SavingsLimit)
	assertEqual(t, "FixedWantsTotal", 50.0, fw.FixedWantsTotal)
	assertEqual(t, "FixedNeedsTotal", 200.0, fw.FixedNeedsTotal)
	// Savings pool untouched
	if fw.SavingsLimit != 600.0 {
		t.Errorf("SavingsLimit must never be reduced by fixed expenses; got %.2f", fw.SavingsLimit)
	}
}

func TestComputeBudgetFramework_ZeroIncome(t *testing.T) {
	fw := ComputeBudgetFramework(0, 50, 30, 20, nil)
	assertEqual(t, "TotalIncome zero", 0.0, fw.TotalIncome)
	assertEqual(t, "NeedsLimit zero", 0.0, fw.NeedsLimit)
	assertEqual(t, "VarNeedsBudget zero", 0.0, fw.VarNeedsBudget)
}

func TestComputeBudgetFramework_DeficitTriggersWarning(t *testing.T) {
	// Fixed needs (1300) > NeedsLimit (1000) → deficit warning
	fixed := []FixedExpenseInput{
		{Amount: 1300, Description: "Rent+bills", CategoryType: "need"},
	}
	fw := ComputeBudgetFramework(2000, 50, 30, 20, fixed)

	assertTrue(t, "DeficitWarning when fixed > needs_limit", fw.DeficitWarning)
	if fw.SuggestedProfile == nil {
		t.Error("expected SuggestedProfile to be set on deficit")
	} else if *fw.SuggestedProfile != "65/20/15" {
		t.Errorf("expected SuggestedProfile=65/20/15, got %s", *fw.SuggestedProfile)
	}
}

func TestComputeBudgetFramework_CategoryTypeNormalization(t *testing.T) {
	// Unrecognized category_type must default to "need"
	fixed := []FixedExpenseInput{
		{Amount: 100, Description: "Unknown", CategoryType: "NEED"},
		{Amount: 50, Description: "Sub", CategoryType: "WANT"},
	}
	fw := ComputeBudgetFramework(2000, 50, 30, 20, fixed)

	assertEqual(t, "FixedNeedsTotal", 100.0, fw.FixedNeedsTotal)
	assertEqual(t, "FixedWantsTotal", 50.0, fw.FixedWantsTotal)
}

// ── helpers ──────────────────────────────────────────────────────────────────

func assertEqual(t *testing.T, label string, want, got float64) {
	t.Helper()
	if want != got {
		t.Errorf("%s: want %.2f, got %.2f", label, want, got)
	}
}

func assertApprox(t *testing.T, label string, want, got float64) {
	t.Helper()
	diff := want - got
	if diff < -0.01 || diff > 0.01 {
		t.Errorf("%s: want ≈%.2f, got %.2f", label, want, got)
	}
}

func assertTrue(t *testing.T, label string, got bool) {
	t.Helper()
	if !got {
		t.Errorf("%s: expected true", label)
	}
}

func assertFalse(t *testing.T, label string, got bool) {
	t.Helper()
	if got {
		t.Errorf("%s: expected false", label)
	}
}
