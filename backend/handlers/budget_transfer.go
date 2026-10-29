package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Budget ↔ savings by re-categorizing ──────────────────────────────────────
//
// A savings deposit made from THIS cycle's budget moves budget −X, savings +X.
// Returning it to the budget re-categorizes the same record instead of adding
// a negative mirror: it becomes a budget_transfer row in the system category
// "Переменный бюджет". That row is NEUTRAL — it moves no money (cycle maths,
// the savings pool, the timeline, the forecast and the AI all ignore it) — so
// the net effect is exactly budget +X, savings −X. Moving it to savings again
// turns it back into a deposit.
//
//   - full return    → the same row changes side (category, type);
//   - partial return → the deposit keeps the remainder, the returned part goes
//     to a "Переменный бюджет" row with the same date and entry time;
//   - rows of the same origin (same entry time, description and source) merge
//     instead of piling up: one deposit is at most one savings row plus one
//     budget row.
//
// Only deposits of the CURRENT cycle change in place. A deposit from a closed
// cycle can't: that cycle's leftover was locked into the next one's
// carry-over at the handover, so un-depositing it there would lose the money.
// Its return is a new transfer row dated today, "Из сбережений → Переменный
// бюджет" (a pool withdrawal credited to the current budget, see
// isReturnToBudget).

const (
	budgetTransferType        = "budget_transfer"
	variableBudgetCategoryKey = "category.variable_budget"
	variableBudgetCategoryNm  = "Variable budget" // displayed via its translation key

	errReturnExceedsDeposit = "RETURN_EXCEEDS_DEPOSIT" // more than this deposit holds
	errTransferLocked       = "TRANSFER_LOCKED"        // a budget row's money fields are system-managed
	errSystemCategory       = "SYSTEM_CATEGORY"        // "Переменный бюджет" is not for ordinary entries
)

func isBudgetTransfer(tx models.Transaction) bool { return tx.Type == budgetTransferType }

// isVariableBudgetCategory reports whether a category is the system
// "Переменный бюджет" category.
func isVariableBudgetCategory(uid, catID uint) bool {
	var n int64
	database.DB.Model(&models.Category{}).
		Where("id = ? AND user_id = ? AND translation_key = ?", catID, uid, variableBudgetCategoryKey).
		Count(&n)
	return n > 0
}

// ensureVariableBudgetCategory returns the user's "Переменный бюджет" system
// category, creating it on first use.
func ensureVariableBudgetCategory(db *gorm.DB, uid uint) (uint, error) {
	var cat models.Category
	err := db.Where("user_id = ? AND translation_key = ?", uid, variableBudgetCategoryKey).First(&cat).Error
	if err == nil {
		return cat.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return 0, err
	}
	cat = models.Category{UserID: uid, Name: variableBudgetCategoryNm, TranslationKey: variableBudgetCategoryKey}
	if err := db.Create(&cat).Error; err != nil {
		return 0, err
	}
	return cat.ID, nil
}

// sibling finds the live row of the same origin as tx — same entry time,
// description and source — of the given type (the other side of a split).
func sibling(db *gorm.DB, tx models.Transaction, typ string) (*models.Transaction, error) {
	var s models.Transaction
	err := db.Where("user_id = ? AND id <> ? AND type = ? AND created_at = ? AND description = ? AND source = ?",
		tx.UserID, tx.ID, typ, tx.CreatedAt, tx.Description, tx.Source).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// returnInPlace moves `amount` of a current-cycle deposit to the budget side.
// It returns "recategorized" (whole deposit) or "split" (part of it).
func returnInPlace(dep models.Transaction, amount float64) (string, error) {
	mode := "split"
	err := database.DB.Transaction(func(db *gorm.DB) error {
		varCat, err := ensureVariableBudgetCategory(db, dep.UserID)
		if err != nil {
			return err
		}
		budgetRow, err := sibling(db, dep, budgetTransferType)
		if err != nil {
			return err
		}
		now := time.Now()
		whole := amount >= round2(dep.Amount)

		switch {
		case whole && budgetRow != nil: // fold the deposit into its budget row
			mode = "recategorized"
			if err := db.Model(budgetRow).Updates(map[string]any{
				"amount": round2(budgetRow.Amount + dep.Amount), "updated_at": now,
			}).Error; err != nil {
				return err
			}
			return db.Delete(&models.Transaction{}, dep.ID).Error
		case whole: // the same row changes side
			mode = "recategorized"
			return db.Model(&models.Transaction{}).Where("id = ?", dep.ID).Updates(map[string]any{
				"type": budgetTransferType, "category_id": varCat, "updated_at": now,
			}).Error
		}

		// Partial: the deposit keeps the remainder, the returned part goes to
		// the budget row of the same origin (created with the same date and
		// entry time, so it stays in the same cycle).
		if err := db.Model(&models.Transaction{}).Where("id = ?", dep.ID).Updates(map[string]any{
			"amount": round2(dep.Amount - amount), "updated_at": now,
		}).Error; err != nil {
			return err
		}
		if budgetRow != nil {
			return db.Model(budgetRow).Updates(map[string]any{
				"amount": round2(budgetRow.Amount + amount), "updated_at": now,
			}).Error
		}
		part := models.Transaction{
			UserID: dep.UserID, CategoryID: varCat, Amount: amount, Description: dep.Description,
			Date: dep.Date, Type: budgetTransferType, IncomeType: dep.IncomeType, Source: dep.Source,
			CreatedAt: dep.CreatedAt, UpdatedAt: now,
		}
		return db.Create(&part).Error
	})
	return mode, err
}

// moveBudgetRowToSavings turns a "Переменный бюджет" row back into a savings
// deposit (merging into the deposit of the same origin when one exists). The
// caller has already applied the deposit guard.
func moveBudgetRowToSavings(row models.Transaction, poolCat uint) error {
	return database.DB.Transaction(func(db *gorm.DB) error {
		now := time.Now()
		dep, err := sibling(db, row, "savings_deposit")
		if err != nil {
			return err
		}
		if dep != nil {
			if err := db.Model(dep).Updates(map[string]any{
				"amount": round2(dep.Amount + row.Amount), "updated_at": now,
			}).Error; err != nil {
				return err
			}
			return db.Delete(&models.Transaction{}, row.ID).Error
		}
		return db.Model(&models.Transaction{}).Where("id = ?", row.ID).Updates(map[string]any{
			"type": "savings_deposit", "category_id": poolCat, "updated_at": now,
		}).Error
	})
}

// ReturnSavingsToBudget — POST /api/transactions/:id/budget
// Moves money from a savings deposit back into the current cycle's spendable
// budget. Body (optional): {"amount": n} — exact, cents kept; defaults to the
// whole deposit. Current-cycle deposits are re-categorized or split in place;
// a closed cycle's deposit gets a today-dated transfer row instead (see the
// file comment). Rejected beyond what the pool holds (SAVINGS_INSUFFICIENT)
// or, in place, beyond the deposit (RETURN_EXCEEDS_DEPOSIT). Responds with the
// mode ("recategorized" | "split" | "transfer") and fresh CycleStats.
func ReturnSavingsToBudget(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		Amount *float64 `json:"amount"`
	}
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	var dep models.Transaction
	if err := database.DB.Where("id = ? AND user_id = ?", c.Param("id"), uid).First(&dep).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Transaction not found or access denied"})
		return
	}
	if dep.Type != "savings_deposit" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only a savings deposit can be moved back to the budget", "code": "NOT_A_DEPOSIT"})
		return
	}

	k := requestClock(c, uid)
	all, err := loadUserCycles(uid)
	if err != nil {
		log.Printf("return to budget: fetch user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycles"})
		return
	}
	cycle := k.currentCycle(all)
	if cycle == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": validationMessage(errNoActiveCycle), "code": errNoActiveCycle})
		return
	}
	if !ensureSavingsCategory(uid, cycle) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to configure savings category"})
		return
	}

	amount := dep.Amount
	if req.Amount != nil {
		amount = *req.Amount
	}
	amount = round2(amount)
	if amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount must be greater than zero"})
		return
	}
	if pool := round2(savingsPoolBalance(uid, cycle.SavedMoneyCategoryID)); amount > pool {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "That is more than your savings hold", "code": errSavingsInsufficient, "available": max(0, pool),
		})
		return
	}

	mode := "transfer"
	if k.window(*cycle, all).contains(k.txEventAt(dep)) {
		if amount > round2(dep.Amount) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "That is more than this deposit holds", "code": errReturnExceedsDeposit, "available": round2(dep.Amount),
			})
			return
		}
		if mode, err = returnInPlace(dep, amount); err != nil {
			log.Printf("return to budget: user=%v tx=%v err=%v", uid, dep.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to move to the budget"})
			return
		}
	} else {
		// A closed cycle's deposit: a today-dated transfer into this budget.
		now := time.Now()
		ret := models.Transaction{
			UserID: uid, CategoryID: cycle.SavedMoneyCategoryID, Amount: amount,
			Description: "Returned to budget", Date: k.today(), Type: "savings_withdrawal",
			IncomeType: "one_time", Source: savingsToBudgetSource, CreatedAt: now, UpdatedAt: now,
		}
		if err := database.DB.Create(&ret).Error; err != nil {
			log.Printf("return to budget: user=%v err=%v", uid, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to move to the budget"})
			return
		}
	}
	InvalidateCycleCache(uid)
	ScheduleBrainResync(uid)

	c.JSON(http.StatusOK, gin.H{
		"mode":        mode,
		"cycle_stats": computeCycleStatsAt(uid, *cycle, all, k),
	})
}
