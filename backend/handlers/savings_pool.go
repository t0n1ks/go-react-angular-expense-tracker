package handlers

import (
	"math"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// splitToWholeUnits is the ONE rounding rule for money the app moves into the
// savings pool on the user's behalf: the whole currency units move (rounded
// DOWN) and the cents stay in the spendable budget (€12.80 → €12 moves, €0.80
// stays). The amount is rounded to cents first so float noise (99.99999…) can
// never cost the user a whole unit.
//
// It governs the automatic % allocation and moving the carried-over budget into
// savings. Amounts the user types (manual deposits/withdrawals) are exact and
// never pass through here — they still leave the budget by that exact amount.
func splitToWholeUnits(amount float64) (whole, cents float64) {
	if amount <= 0 {
		return 0, 0
	}
	exact := round2(amount)
	whole = math.Floor(exact)
	return whole, round2(exact - whole)
}

// plannedSavingsAllocation is the AUTOMATIC percentage-based savings allocation
// for an income, in whole units (€504 × 20% = €100.80 → €100). The cents go to
// the spendable budget (see savingsRoundingRemainder).
func plannedSavingsAllocation(income, savingsPct float64) float64 {
	whole, _ := splitToWholeUnits(income * savingsPct / 100)
	return whole
}

// savingsRoundingRemainder is the cents the whole-unit rounding moved out of
// the savings allocation and into the spendable budget (€0.80 for €504 × 20%).
func savingsRoundingRemainder(income, savingsPct float64) float64 {
	_, cents := splitToWholeUnits(income * savingsPct / 100)
	return cents
}

// Transaction.Source values for savings deposits the app creates from an
// action, so each one stays traceable.
const (
	// carryOverToSavingsSource: the carried-over budget moved into savings.
	// Deleting the cycle from history removes these.
	carryOverToSavingsSource = "carry_over_to_savings"
	// savingsAllocationSource: an automatic % allocation top-up after more
	// income arrived in the cycle (the allocation made at cycle start is
	// recognised by its description, savingsAllocationDescription).
	savingsAllocationSource = "savings_allocation"
	// expenseToSavingsSource: an expense the user re-filed as a deposit into
	// savings from the transaction view.
	expenseToSavingsSource = "expense_to_savings"
	// savingsToBudgetSource: money the user moved back from savings into the
	// current cycle's spendable budget (a pool withdrawal that is NOT spending).
	savingsToBudgetSource = "savings_to_budget"
)

const (
	savingsAllocationDescription = "Planned savings allocation"
	// legacyBonusDescription: before carry-over existed, an unspent balance was
	// moved into the pool at the start of the NEXT cycle under this name. That
	// money came from the previous cycle, not from the new cycle's budget.
	legacyBonusDescription = "Pleasant bonus from the previous cycle"
)

// isBudgetFundedDeposit reports whether a transaction moves money from the
// cycle's spendable budget into the savings pool: every pool inflow (the %
// allocation, the carry-over move, manual deposits, re-filed expenses) except
// the legacy bonus. Money is conserved — what enters the pool leaves the
// budget, by exactly the same amount.
func isBudgetFundedDeposit(tx models.Transaction, savedMoneyCatID uint) bool {
	return isSavingsPoolTx(tx, savedMoneyCatID) && isSavingsPoolInflow(tx.Type) &&
		tx.Description != legacyBonusDescription
}

// isReturnToBudget reports whether a pool withdrawal moved money back into
// the spendable budget (rather than being spent from savings). Conserved: what
// leaves the pool enters the budget, by exactly the same amount.
func isReturnToBudget(tx models.Transaction) bool {
	return tx.Type == "savings_withdrawal" && tx.Source == savingsToBudgetSource
}

// isSavingsAllocation reports whether a row is part of the automatic %
// allocation (the one made at cycle start, or a later top-up) — including an
// allocation the user moved back to the budget, so a later top-up never
// re-saves money they chose to keep spendable.
func isSavingsAllocation(tx models.Transaction) bool {
	return (tx.Type == "savings_deposit" || tx.Type == budgetTransferType) &&
		(tx.Source == savingsAllocationSource || tx.Description == savingsAllocationDescription)
}

// ── Savings pool ("piggy bank") balance — single source of truth ─────────────
//
// The pool is every transaction in the user's saved-money category. Its live
// balance is simply the signed sum of those entries:
//
//	allocated (auto "Planned savings allocation" deposit)
//	+ additions (manual deposits, previous-cycle bonuses, legacy "income")
//	− withdrawals (savings_withdrawal, penalties, legacy "expense" in the pool)
//
// Every view that shows a savings balance (dashboard card, Statistics,
// savings-history modal, AI payload) must read it from here so they can never
// disagree.

// isSavingsPoolTx reports whether a transaction is a savings-pool movement —
// by explicit type, or (legacy) by being in the pool category. Pool movements
// are never cycle income/expense: they would double-count the pool.
func isSavingsPoolTx(tx models.Transaction, savedMoneyCatID uint) bool {
	return tx.Type == "savings_deposit" || tx.Type == "savings_withdrawal" ||
		(savedMoneyCatID > 0 && tx.CategoryID == savedMoneyCatID)
}

// isSavingsPoolInflow reports whether a pool transaction adds money to the pool.
// Anything else in the pool category (savings_withdrawal, expense) takes it out.
func isSavingsPoolInflow(txType string) bool {
	return txType == "savings_deposit" || txType == "income"
}

// savingsPoolNet returns the net balance of the given savings-pool transactions.
// Pure: the caller is responsible for passing only pool-category transactions.
func savingsPoolNet(pool []models.Transaction) float64 {
	var balance float64
	for _, p := range pool {
		if isSavingsPoolInflow(p.Type) {
			balance += p.Amount
		} else {
			balance -= p.Amount
		}
	}
	return balance
}

// loadSavingsPool returns the user's live (non-deleted) savings-pool
// transactions, newest first. Empty when no pool category is linked yet.
func loadSavingsPool(uid, savedMoneyCatID uint) []models.Transaction {
	var pool []models.Transaction
	if savedMoneyCatID == 0 {
		return pool
	}
	database.DB.
		Where("user_id = ? AND category_id = ?", uid, savedMoneyCatID).
		Order("created_at DESC").
		Find(&pool)
	return pool
}

// savingsPoolBalance is the live remaining balance of the user's savings pool.
func savingsPoolBalance(uid, savedMoneyCatID uint) float64 {
	return savingsPoolNet(loadSavingsPool(uid, savedMoneyCatID))
}
