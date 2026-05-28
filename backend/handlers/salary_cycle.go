package handlers

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// BudgetFramework is the computed 50/30/20 (or custom ratio) allocation.
// Exported so tests can call ComputeBudgetFramework directly.
type BudgetFramework struct {
	TotalIncome      float64  `json:"total_income"`
	NeedsLimit       float64  `json:"needs_limit"`
	WantsLimit       float64  `json:"wants_limit"`
	SavingsLimit     float64  `json:"savings_limit"`
	FixedNeedsTotal  float64  `json:"fixed_needs_total"`
	FixedWantsTotal  float64  `json:"fixed_wants_total"`
	VarNeedsBudget   float64  `json:"var_needs_budget"`
	VarWantsBudget   float64  `json:"var_wants_budget"`
	DeficitWarning   bool     `json:"deficit_warning"`
	SuggestedProfile *string  `json:"suggested_profile"`
}

type FixedExpenseInput struct {
	Amount       float64 `json:"amount"`
	Description  string  `json:"description"`
	CategoryType string  `json:"category_type"` // need | want
}

// ComputeBudgetFramework applies strict top-down budgeting:
//  1. Split TotalIncome by ratio → hard ceilings
//  2. Subtract fixed costs from their respective ceilings → variable budgets
//  3. Savings pool is NEVER touched by fixed expenses
//  4. Return deficit_warning if variable needs go negative
func ComputeBudgetFramework(totalIncome, needsPct, wantsPct, savingsPct float64, fixedExpenses []FixedExpenseInput) BudgetFramework {
	needsLimit := totalIncome * needsPct / 100
	wantsLimit := totalIncome * wantsPct / 100
	savingsLimit := totalIncome * savingsPct / 100

	var fixedNeedsTotal, fixedWantsTotal float64
	for _, fe := range fixedExpenses {
		switch strings.ToLower(fe.CategoryType) {
		case "want":
			fixedWantsTotal += fe.Amount
		default:
			fixedNeedsTotal += fe.Amount
		}
	}

	varNeedsBudget := needsLimit - fixedNeedsTotal
	varWantsBudget := wantsLimit - fixedWantsTotal
	deficitWarning := varNeedsBudget < 0

	fw := BudgetFramework{
		TotalIncome:     totalIncome,
		NeedsLimit:      needsLimit,
		WantsLimit:      wantsLimit,
		SavingsLimit:    savingsLimit,
		FixedNeedsTotal: fixedNeedsTotal,
		FixedWantsTotal: fixedWantsTotal,
		VarNeedsBudget:  varNeedsBudget,
		VarWantsBudget:  varWantsBudget,
		DeficitWarning:  deficitWarning,
	}

	if deficitWarning {
		// Suggest a 65/20/15 profile where the needs ceiling is expanded
		s := "65/20/15"
		fw.SuggestedProfile = &s
	}
	return fw
}

// StartSalaryCycle creates a new salary cycle, auto-creates the income
// transaction, and resets monthly_spending_goal + manual_next_payday on the
// user profile so existing components (WeeklyBudgetCard, hearts) continue to
// work without modification.
func StartSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		BaseSalary    float64             `json:"base_salary"`
		Bonuses       float64             `json:"bonuses"`
		NextPayday    string              `json:"next_payday_date"`
		NeedsPct      float64             `json:"needs_pct"`
		WantsPct      float64             `json:"wants_pct"`
		SavingsPct    float64             `json:"savings_pct"`
		FixedExpenses []FixedExpenseInput `json:"fixed_expenses"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.BaseSalary <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_salary must be greater than zero"})
		return
	}

	// Default to 50/30/20 when not provided
	if req.NeedsPct == 0 && req.WantsPct == 0 && req.SavingsPct == 0 {
		req.NeedsPct, req.WantsPct, req.SavingsPct = 50, 30, 20
	}

	total := req.NeedsPct + req.WantsPct + req.SavingsPct
	if total < 99.9 || total > 100.1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "needs_pct + wants_pct + savings_pct must equal 100"})
		return
	}

	totalIncome := req.BaseSalary + req.Bonuses
	fw := ComputeBudgetFramework(totalIncome, req.NeedsPct, req.WantsPct, req.SavingsPct, req.FixedExpenses)

	now := time.Now()

	cycle := models.SalaryCycle{
		UserID:          uid,
		BaseSalary:      req.BaseSalary,
		Bonuses:         req.Bonuses,
		TotalIncome:     totalIncome,
		NeedsPct:        req.NeedsPct,
		WantsPct:        req.WantsPct,
		SavingsPct:      req.SavingsPct,
		NeedsLimit:      fw.NeedsLimit,
		WantsLimit:      fw.WantsLimit,
		SavingsLimit:    fw.SavingsLimit,
		FixedNeedsTotal: fw.FixedNeedsTotal,
		FixedWantsTotal: fw.FixedWantsTotal,
		VarNeedsBudget:  fw.VarNeedsBudget,
		VarWantsBudget:  fw.VarWantsBudget,
		CycleStartAt:    now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if req.NextPayday != "" {
		parsed, err := time.Parse("2006-01-02", req.NextPayday)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid next_payday_date format. Use YYYY-MM-DD"})
			return
		}
		cycle.NextPaydayAt = &parsed
	}

	var incomeTxID uint

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&cycle).Error; err != nil {
			return err
		}

		for _, fe := range req.FixedExpenses {
			fixedExp := models.FixedExpense{
				SalaryCycleID: cycle.ID,
				UserID:        uid,
				Amount:        fe.Amount,
				Description:   strings.TrimSpace(fe.Description),
				CategoryType:  strings.ToLower(strings.TrimSpace(fe.CategoryType)),
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if strings.ToLower(fixedExp.CategoryType) != "want" {
				fixedExp.CategoryType = "need"
			}
			if err := tx.Create(&fixedExp).Error; err != nil {
				return err
			}
		}

		// Find a suitable income category; create one if none exist
		var incomeCat models.Category
		if err := tx.Where("user_id = ?", uid).
			Where("LOWER(name) IN ('income','доход','дохід','einkommen','salary')").
			First(&incomeCat).Error; err != nil {
			// Fallback: any category
			if err2 := tx.Where("user_id = ?", uid).First(&incomeCat).Error; err2 != nil {
				incomeCat = models.Category{
					UserID: uid, Name: "Income", CreatedAt: now, UpdatedAt: now,
				}
				if err3 := tx.Create(&incomeCat).Error; err3 != nil {
					return err3
				}
			}
		}

		// Auto-create the one_time income transaction — this is what smart mode
		// cycle detection latches onto (most recent one_time income created_at).
		incomeTx := models.Transaction{
			UserID:      uid,
			CategoryID:  incomeCat.ID,
			Amount:      totalIncome,
			Description: "Salary",
			Date:        now,
			Type:        "income",
			IncomeType:  "one_time",
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := tx.Create(&incomeTx).Error; err != nil {
			return err
		}
		incomeTxID = incomeTx.ID

		// Sync profile fields so WeeklyBudgetCard and hearts logic work unchanged:
		// monthly_spending_goal = variable discretionary budget (needs + wants)
		profileUpdates := map[string]interface{}{
			"monthly_spending_goal": fw.VarNeedsBudget + fw.VarWantsBudget,
			"expected_salary":       totalIncome,
			"payday_mode":           "smart",
		}
		if req.NextPayday != "" {
			profileUpdates["manual_next_payday"] = req.NextPayday
		}
		return tx.Model(&models.User{}).Where("id = ?", uid).Updates(profileUpdates).Error
	})

	if err != nil {
		log.Printf("start salary cycle: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create salary cycle"})
		return
	}

	if err := database.DB.Preload("FixedExpenses").First(&cycle, cycle.ID).Error; err != nil {
		log.Printf("start salary cycle: preload err=%v", err)
	}

	c.JSON(http.StatusCreated, gin.H{
		"cycle":                 cycle,
		"budget_framework":      fw,
		"income_transaction_id": incomeTxID,
	})
}

// GetCurrentSalaryCycle returns the most recent salary cycle for the user
// together with live cycle stats (income/expenses since cycle_start_at).
func GetCurrentSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var cycle models.SalaryCycle
	err := database.DB.Preload("FixedExpenses").
		Where("user_id = ?", uid).
		Order("cycle_start_at DESC").
		First(&cycle).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusOK, gin.H{"cycle": nil, "budget_framework": nil, "cycle_stats": nil})
			return
		}
		log.Printf("get current cycle: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch salary cycle"})
		return
	}

	cycleIncome, cycleExpenses := fetchCycleStats(uid, cycle.CycleStartAt)

	var allIncome, allExpense float64
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type = 'income'", uid).
		Select("COALESCE(SUM(amount), 0)").Scan(&allIncome)
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type = 'expense'", uid).
		Select("COALESCE(SUM(amount), 0)").Scan(&allExpense)

	previousSavings := (allIncome - allExpense) - (cycleIncome - cycleExpenses)

	fw := BudgetFramework{
		TotalIncome:     cycle.TotalIncome,
		NeedsLimit:      cycle.NeedsLimit,
		WantsLimit:      cycle.WantsLimit,
		SavingsLimit:    cycle.SavingsLimit,
		FixedNeedsTotal: cycle.FixedNeedsTotal,
		FixedWantsTotal: cycle.FixedWantsTotal,
		VarNeedsBudget:  cycle.VarNeedsBudget,
		VarWantsBudget:  cycle.VarWantsBudget,
		DeficitWarning:  cycle.VarNeedsBudget < 0,
	}

	c.JSON(http.StatusOK, gin.H{
		"cycle":            cycle,
		"budget_framework": fw,
		"cycle_stats": gin.H{
			"cycle_income":     cycleIncome,
			"cycle_expenses":   cycleExpenses,
			"previous_savings": previousSavings,
		},
	})
}

// GetSalaryCycleHistory returns the last 24 salary cycles for historical analysis.
func GetSalaryCycleHistory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var cycles []models.SalaryCycle
	if err := database.DB.Preload("FixedExpenses").
		Where("user_id = ?", uid).
		Order("cycle_start_at DESC").
		Limit(24).
		Find(&cycles).Error; err != nil {
		log.Printf("get cycle history: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycle history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"cycles": cycles})
}

func fetchCycleStats(uid uint, since time.Time) (income, expenses float64) {
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type = 'income' AND created_at > ?", uid, since).
		Select("COALESCE(SUM(amount), 0)").Scan(&income)
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type = 'expense' AND created_at > ?", uid, since).
		Select("COALESCE(SUM(amount), 0)").Scan(&expenses)
	return
}
