package handlers

import (
	"math"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// plannedSavingsAllocation is the AUTOMATIC percentage-based savings allocation
// for an income, always rounded DOWN to whole currency units (€504 × 20% =
// €100.80 → €100). The cents are rounded to 2 decimals first so float noise
// (99.99999…) can never cost the user a whole unit.
//
// The leftover cents are not lost: every caller derives the spendable budget
// as income − this allocation − fixed, so the remainder lands there exactly
// (see savingsRoundingRemainder). Manual deposits/withdrawals are never
// rounded — this applies only to the automatic % allocation.
func plannedSavingsAllocation(income, savingsPct float64) float64 {
	if income <= 0 || savingsPct <= 0 {
		return 0
	}
	return math.Floor(round2(income * savingsPct / 100))
}

// savingsRoundingRemainder is the cents the whole-unit rounding moved out of
// the savings allocation and into the spendable budget (€0.80 for €504 × 20%).
func savingsRoundingRemainder(income, savingsPct float64) float64 {
	if income <= 0 || savingsPct <= 0 {
		return 0
	}
	return round2(round2(income*savingsPct/100) - plannedSavingsAllocation(income, savingsPct))
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
