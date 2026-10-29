package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Real money: the ONE definition of "money the user has" ───────────────────
//
//	money on hand = spendable remainder of the cycle + savings-pool balance
//
// The remainder comes from tallyCycle, the same ledger tally the dashboard,
// the handover carry-over and the deposit guard use; the pool from
// savingsPoolNet. Money only enters through income and only leaves through
// expenses and withdrawals from savings; moving budget → savings is net-zero.
// The balance timeline replays the same functions day by day and reports the
// two components separately, so its latest point is exactly today's figures.

// cycleTotals is the ledger tally of one cycle's transactions.
type cycleTotals struct {
	Income      float64
	Expenses    float64
	FixedExp    float64
	VariableExp float64
	// ToSavings is the money moved from this cycle's budget into the pool.
	ToSavings float64
	// CarryMoved is the part of ToSavings that moved the carried-over budget.
	CarryMoved float64
	// FromSavings is the money moved back from the pool into this budget.
	FromSavings float64
}

// tallyCycle sums a cycle's transactions. Pure.
func tallyCycle(c models.SalaryCycle, txs []windowTx) cycleTotals {
	var t cycleTotals
	for _, tx := range txs {
		if isSavingsPoolTx(tx.Transaction, c.SavedMoneyCategoryID) {
			if isBudgetFundedDeposit(tx.Transaction, c.SavedMoneyCategoryID) {
				t.ToSavings += tx.Amount
				if tx.Source == carryOverToSavingsSource {
					t.CarryMoved += tx.Amount
				}
			}
			if isReturnToBudget(tx.Transaction) {
				t.FromSavings += tx.Amount
			}
			continue // other withdrawals are spent from savings, not from the budget
		}
		switch tx.Type {
		case "income":
			t.Income += tx.Amount
		case "expense":
			t.Expenses += tx.Amount
			if c.FixedExpCategoryID > 0 && tx.CategoryID == c.FixedExpCategoryID {
				t.FixedExp += tx.Amount
			} else {
				t.VariableExp += tx.Amount
			}
		}
	}
	return t
}

// allowance is the cycle's budget for variable spending: income − fixed
// payments − everything moved into savings + what was moved back from savings
// + the carried-over budget.
func (t cycleTotals) allowance(c models.SalaryCycle) float64 {
	return t.Income - t.FixedExp - t.ToSavings + t.FromSavings + c.CarryOver
}

// remaining is the spendable remainder (negative = overspent).
func (t cycleTotals) remaining(c models.SalaryCycle) float64 {
	return t.allowance(c) - t.VariableExp
}

// ── Deposit guard ────────────────────────────────────────────────────────────

// depositCheck is the effect of a budget-funded deposit on the current cycle.
type depositCheck struct {
	InCycle   bool    // the deposit falls in the current cycle's window
	OK        bool    // it does not push the remainder below zero
	Available float64 // the largest amount it could have (≥ 0)
}

// checkSavingsDeposit evaluates `tx` (new when ID == 0, else replacing the
// stored row) against the current cycle: a deposit may not push the spendable
// remainder below zero, or further below it. Re-filing an expense is net-zero
// on the remainder and so always passes.
func checkSavingsDeposit(uid uint, tx models.Transaction, k cycleClock) depositCheck {
	all, err := loadUserCycles(uid)
	if err != nil {
		return depositCheck{}
	}
	cur := k.currentCycle(all)
	if cur == nil {
		return depositCheck{}
	}
	w := k.window(*cur, all)
	at := k.txEventAt(tx)
	if !w.contains(at) {
		return depositCheck{}
	}

	txs := loadWindowTransactions(uid, w, k)
	before := tallyCycle(*cur, txs).remaining(*cur)
	with := make([]windowTx, 0, len(txs)+1)
	for _, t := range txs {
		if tx.ID == 0 || t.ID != tx.ID {
			with = append(with, t)
		}
	}
	with = append(with, windowTx{Transaction: tx, At: at})
	after := tallyCycle(*cur, with).remaining(*cur)

	const cent = 0.005
	return depositCheck{
		InCycle:   true,
		OK:        !(after < -cent && after < before-cent),
		Available: round2(max(0, tx.Amount+after)),
	}
}

const (
	errDepositExceedsSpendable = "DEPOSIT_EXCEEDS_SPENDABLE" // more than the budget has left
	errDepositOutsideCycle     = "DEPOSIT_OUTSIDE_CYCLE"     // no current cycle budget to fund it
	errSavingsInsufficient     = "SAVINGS_INSUFFICIENT"      // more than the pool holds
)

// allowSavingsDeposit applies the deposit guard to a new or edited
// budget-funded deposit and writes the 400 response when it fails. The typed
// amount is never altered: an oversized deposit is rejected, with the most
// that fits ("available"), not silently capped.
func allowSavingsDeposit(c *gin.Context, uid uint, tx models.Transaction, k cycleClock) bool {
	chk := checkSavingsDeposit(uid, tx, k)
	switch {
	case !chk.InCycle:
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Savings deposits come from the current cycle's budget",
			"code":  errDepositOutsideCycle,
		})
		return false
	case !chk.OK:
		c.JSON(http.StatusBadRequest, gin.H{
			"error":     "The deposit is larger than the budget left to spend",
			"code":      errDepositExceedsSpendable,
			"available": chk.Available,
		})
		return false
	}
	return true
}

// MoveTransactionToSavings — POST /api/transactions/:id/savings
// Moves a current-cycle row into the savings pool, same amount (exact, cents
// kept), date and entry time:
//   - an expense is re-filed as a deposit: it stops counting as spent, so the
//     spendable remainder is unchanged and the pool grows by that amount;
//   - a "Переменный бюджет" row (money returned from savings) goes back to
//     being a deposit — merged into the deposit of the same origin if the
//     return was partial — under the usual deposit guard.
//
// Returns fresh CycleStats.
func MoveTransactionToSavings(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var tx models.Transaction
	if err := database.DB.Where("id = ? AND user_id = ?", c.Param("id"), uid).First(&tx).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found or access denied"})
		return
	}

	k := requestClock(c, uid)
	all, err := loadUserCycles(uid)
	if err != nil {
		log.Printf("move tx to savings: fetch user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycles"})
		return
	}
	cycle := k.currentCycle(all)
	if cycle == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": validationMessage(errNoActiveCycle), "code": errNoActiveCycle})
		return
	}
	fromBudgetRow := isBudgetTransfer(tx)
	if !fromBudgetRow && (tx.Type != "expense" || isSavingsPoolTx(tx, cycle.SavedMoneyCategoryID)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only an expense or a budget row can be moved to savings", "code": "NOT_AN_EXPENSE"})
		return
	}
	if !ensureSavingsCategory(uid, cycle) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to configure savings category"})
		return
	}

	if fromBudgetRow {
		back := tx
		back.Type = "savings_deposit"
		back.CategoryID = cycle.SavedMoneyCategoryID
		if !allowSavingsDeposit(c, uid, back, k) {
			return
		}
		if err := moveBudgetRowToSavings(tx, cycle.SavedMoneyCategoryID); err != nil {
			log.Printf("move budget row to savings: user=%v tx=%v err=%v", uid, tx.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to move to savings"})
			return
		}
		InvalidateCycleCache(uid)
		ScheduleBrainResync(uid)
		c.JSON(http.StatusOK, gin.H{"cycle_stats": computeCycleStatsAt(uid, *cycle, all, k)})
		return
	}

	moved := tx
	moved.Type = "savings_deposit"
	moved.CategoryID = cycle.SavedMoneyCategoryID
	moved.Source = expenseToSavingsSource
	if !allowSavingsDeposit(c, uid, moved, k) {
		return
	}
	if err := database.DB.Model(&models.Transaction{}).Where("id = ? AND user_id = ?", tx.ID, uid).
		Updates(map[string]any{
			"type": moved.Type, "category_id": moved.CategoryID,
			"source": moved.Source, "updated_at": time.Now(),
		}).Error; err != nil {
		log.Printf("move tx to savings: user=%v tx=%v err=%v", uid, tx.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to move to savings"})
		return
	}
	InvalidateCycleCache(uid)
	ScheduleBrainResync(uid)

	c.JSON(http.StatusOK, gin.H{
		"transaction": moved,
		"cycle_stats": computeCycleStatsAt(uid, *cycle, all, k),
	})
}

// ── Allocation top-up ────────────────────────────────────────────────────────

// topUpSavingsAllocation keeps the automatic % allocation matched by a real
// pool deposit when more income arrives in the current cycle: it deposits the
// whole-unit gap between the planned allocation and what was allocated so
// far. It never takes money back out (a smaller income leaves the deposit in
// savings — still conserved).
func topUpSavingsAllocation(uid uint, k cycleClock) {
	all, err := loadUserCycles(uid)
	if err != nil {
		return
	}
	cur := k.currentCycle(all)
	if cur == nil || cur.SavingsPct <= 0 {
		return
	}
	txs := loadWindowTransactions(uid, k.window(*cur, all), k)
	var allocated float64
	for _, t := range txs {
		if isSavingsAllocation(t.Transaction) {
			allocated += t.Amount
		}
	}
	planned := plannedSavingsAllocation(tallyCycle(*cur, txs).Income, cur.SavingsPct)
	gap, _ := splitToWholeUnits(planned - allocated)
	if gap < 1 || !ensureSavingsCategory(uid, cur) {
		return
	}
	now := time.Now()
	topUp := models.Transaction{
		UserID:      uid,
		CategoryID:  cur.SavedMoneyCategoryID,
		Amount:      gap,
		Description: savingsAllocationDescription,
		Date:        k.today(),
		Type:        "savings_deposit",
		IncomeType:  "one_time",
		Source:      savingsAllocationSource,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := database.DB.Create(&topUp).Error; err != nil {
		log.Printf("savings allocation top-up: user=%v err=%v", uid, err)
	}
}

// ── Money on hand & timeline ─────────────────────────────────────────────────

// cyclesAsOf is the cycles as they stood just before `at`: started earlier,
// with any later end or stop not yet happened.
func cyclesAsOf(all []models.SalaryCycle, at time.Time) []models.SalaryCycle {
	out := make([]models.SalaryCycle, 0, len(all))
	for _, c := range all {
		if !c.CycleStartAt.Before(at) {
			continue
		}
		if c.EndedAt != nil && !c.EndedAt.Before(at) {
			c.EndedAt = nil
		}
		if c.StoppedAt != nil && !c.StoppedAt.Before(at) {
			c.StoppedAt = nil
		}
		out = append(out, c)
	}
	return out
}

// moneySplit is the user's real money in its two components.
type moneySplit struct {
	Spendable float64 // the cycle's spendable remainder (negative = overspent)
	Savings   float64 // the savings-pool balance
}

// moneyOnHandAt is the user's real money just before `at` (nil = now, with
// everything recorded, matching the dashboard): the latest cycle's spendable
// remainder — settled at its end or stop, like at a handover — and the pool.
// ok is false before the first cycle. `all` sorted by start ASC; txs carry
// their event instants.
func moneyOnHandAt(all []models.SalaryCycle, txs []windowTx, poolCat uint, at *time.Time) (moneySplit, bool) {
	cycles := all
	if at != nil {
		cycles = cyclesAsOf(all, *at)
	}
	if len(cycles) == 0 {
		return moneySplit{}, false
	}
	c := cycles[len(cycles)-1]

	w := cycleWindow{Start: c.CycleStartAt}
	horizon := time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)
	if at != nil {
		horizon = *at
	}
	if end := settlementEnd(c, horizon); !end.Equal(horizon) || at != nil {
		w.End = &end
	}

	var own []windowTx
	var pool []models.Transaction
	for _, t := range txs {
		if w.contains(t.At) {
			own = append(own, t)
		}
		if poolCat > 0 && t.CategoryID == poolCat && (at == nil || t.At.Before(*at)) {
			pool = append(pool, t.Transaction)
		}
	}
	return moneySplit{
		Spendable: round2(tallyCycle(c, own).remaining(c)),
		Savings:   round2(savingsPoolNet(pool)),
	}, true
}

// ledger is everything the real-money replay needs, loaded once.
type ledger struct {
	Cycles  []models.SalaryCycle // oldest first
	Txs     []windowTx           // all live transactions with event instants
	PoolCat uint
}

// loadLedger loads the user's cycles and transactions; ok is false when the
// user never had a cycle.
func loadLedger(uid uint, k cycleClock) (ledger, bool) {
	all, err := loadUserCycles(uid)
	if err != nil || len(all) == 0 {
		return ledger{}, false
	}
	var rows []models.Transaction
	database.DB.Where("user_id = ?", uid).Find(&rows)
	txs := make([]windowTx, len(rows))
	for i, r := range rows {
		txs[i] = windowTx{Transaction: r, At: k.txEventAt(r)}
	}
	return ledger{Cycles: all, Txs: txs, PoolCat: poolCategoryOf(all)}, true
}

// moneyAt is moneyOnHandAt on this ledger, as one total (0 before the first
// cycle: nothing was tracked yet).
func (l ledger) moneyAt(at *time.Time) float64 {
	v, _ := moneyOnHandAt(l.Cycles, l.Txs, l.PoolCat, at)
	return v.Spendable + v.Savings
}

// poolCategoryOf is the user's savings-pool category (the latest cycle's).
func poolCategoryOf(all []models.SalaryCycle) uint {
	for i := len(all) - 1; i >= 0; i-- {
		if all[i].SavedMoneyCategoryID > 0 {
			return all[i].SavedMoneyCategoryID
		}
	}
	return 0
}

// timelinePoint is the money on hand at the end of one local day: its two
// components and their sum. Total is the real-money figure (cycle remainder +
// savings pool) — never an all-time income − expenses sum.
type timelinePoint struct {
	Date      string  `json:"date"`      // YYYY-MM-DD, user's local day
	Spendable float64 `json:"spendable"` // = cycle_stats.spendable_remaining today
	Savings   float64 `json:"savings"`   // = cycle_stats.saved_money_balance today
	Total     float64 `json:"total"`     // = Spendable + Savings (= cycle_stats.money_on_hand today)
}

// balanceTimeline replays the ledger from the first cycle's day to today:
// one point per local day (its end-of-day money on hand); today's point is
// the live figure. Empty for users without cycles.
func balanceTimeline(uid uint, k cycleClock) []timelinePoint {
	l, ok := loadLedger(uid, k)
	if !ok {
		return []timelinePoint{}
	}
	all, txs, poolCat := l.Cycles, l.Txs, l.PoolCat

	today := k.dayStart(k.Now)
	points := []timelinePoint{}
	for day := k.dayStart(all[0].CycleStartAt); !day.After(today); day = day.AddDate(0, 0, 1) {
		var at *time.Time
		if day.Before(today) {
			end := day.AddDate(0, 0, 1)
			at = &end
		}
		if v, ok := moneyOnHandAt(all, txs, poolCat, at); ok {
			points = append(points, timelinePoint{
				Date: day.Format("2006-01-02"), Spendable: v.Spendable, Savings: v.Savings,
				Total: round2(v.Spendable + v.Savings),
			})
		}
	}
	return points
}

// GetBalanceTimeline — GET /api/balance/timeline
// The "real money on hand" series for the balance chart: spendable budget,
// savings pool and their total per day. Empty when the user never had a salary cycle (the
// client keeps its cash-flow chart then).
func GetBalanceTimeline(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)
	c.JSON(http.StatusOK, gin.H{"points": balanceTimeline(uid, requestClock(c, uid))})
}
