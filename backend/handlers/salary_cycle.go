package handlers

import (
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// BudgetFramework is the computed 50/30/20 (or custom ratio) allocation.
type BudgetFramework struct {
	TotalIncome     float64 `json:"total_income"`
	NeedsLimit      float64 `json:"needs_limit"`
	WantsLimit      float64 `json:"wants_limit"`
	SavingsLimit    float64 `json:"savings_limit"`
	FixedNeedsTotal float64 `json:"fixed_needs_total"`
	FixedWantsTotal float64 `json:"fixed_wants_total"`
	VarNeedsBudget  float64 `json:"var_needs_budget"`
	VarWantsBudget  float64 `json:"var_wants_budget"`
	DeficitWarning  bool    `json:"deficit_warning"`
	SuggestedProfile *string `json:"suggested_profile"`
}

type FixedExpenseInput struct {
	Amount       float64 `json:"amount"`
	Description  string  `json:"description"`
	CategoryType string  `json:"category_type"` // need | want
}

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
		s := "65/20/15"
		fw.SuggestedProfile = &s
	}
	return fw
}

// ── Localized category name maps ─────────────────────────────────────────────

var fixedCatByLang = map[string]string{
	"en": "Fixed Payments",
	"de": "Fixkosten",
	"ru": "Базовые затраты",
	"uk": "Базові витрати",
}

var savedMoneyCatByLang = map[string]string{
	"en": "Saved Money",
	"de": "Ersparnisse",
	"ru": "Сбережения",
	"uk": "Заощадження",
}

// ── CycleStats ───────────────────────────────────────────────────────────────

// CycleStats is the server-authoritative aggregation for a salary cycle.
// All numbers are derived from LIVE (non-deleted) transactions so that any
// mutation (create / update / soft-delete) is immediately reflected.
type CycleStats struct {
	// Core cycle totals — exclude savings-pool category transactions
	CycleIncome           float64 `json:"cycle_income"`
	CycleExpenses         float64 `json:"cycle_expenses"`
	CycleFixedExpenses    float64 `json:"cycle_fixed_expenses"`
	CycleVariableExpenses float64 `json:"cycle_variable_expenses"`

	// Dynamic Variable Allowance = income − (income×savings_pct%) − fixed_expenses
	// This is the starting budget for discretionary (variable) spending.
	VariableAllowance float64 `json:"variable_allowance"`
	// DynamicSavings = income × savings_pct% — the portion earmarked for the pool.
	DynamicSavings float64 `json:"dynamic_savings"`
	// SavedMoneyBalance = cumulative all-time net balance of the savings pool.
	SavedMoneyBalance float64 `json:"saved_money_balance"`

	// Kept for backward-compat with components that already read this field.
	// Equals VariableAllowance.
	NetDiscretionaryBudget float64 `json:"net_discretionary_budget"`

	PreviousSavings float64 `json:"previous_savings"`

	// Cycle timing
	DaysTotal    int `json:"days_total"`
	DaysElapsed  int `json:"days_elapsed"`
	DaysRemaining int `json:"days_remaining"`

	// Rolling cycle-week engine (7-day chunks from cycle_start_at)
	BaseWeeklyAllowance  float64 `json:"base_weekly_allowance"`
	CurrentWeekIndex     int     `json:"current_week_index"`
	CurrentWeekAllowance float64 `json:"current_week_allowance"`
	CurrentWeekSpent     float64 `json:"current_week_spent"`
	Rollover             float64 `json:"rollover"`
}

// computeCycleStats builds the full CycleStats for one salary cycle.
// It reads ONLY live (soft-delete-safe) transactions from the DB and performs
// all arithmetic here, so React never needs to do client-side date math.
func computeCycleStats(uid uint, cycle models.SalaryCycle) CycleStats {
	since := cycle.CycleStartAt

	// Load all live transactions in the cycle window.
	// Upper bound = next_payday_at when set (inclusive) — prevents pre/post
	// cycle data from polluting the rollover calculation.
	var txs []models.Transaction
	q := database.DB.Where("user_id = ? AND created_at >= ?", uid, since)
	if cycle.NextPaydayAt != nil {
		q = q.Where("created_at <= ?", *cycle.NextPaydayAt)
	}
	q.Find(&txs) // GORM v2: deleted_at IS NULL added automatically

	var income, expenses, fixedExp, variableExp float64
	for _, tx := range txs {
		// Savings-pool transactions are tracked separately, never mixed into
		// cycle income / expense totals (they would double-count the pool).
		if cycle.SavedMoneyCategoryID > 0 && tx.CategoryID == cycle.SavedMoneyCategoryID {
			continue
		}
		switch tx.Type {
		case "income":
			income += tx.Amount
		case "expense":
			expenses += tx.Amount
			if cycle.FixedExpCategoryID > 0 && tx.CategoryID == cycle.FixedExpCategoryID {
				fixedExp += tx.Amount
			} else {
				variableExp += tx.Amount
			}
		}
	}

	// Dynamic savings allocation — scales with actual income so ghost data
	// (snapshot values from a deleted salary tx) cannot persist.
	dynamicSavings := income * cycle.SavingsPct / 100

	// Variable Allowance = what's truly available for discretionary spending.
	variableAllowance := math.Max(0, income-dynamicSavings-fixedExp)

	// All-time savings pool balance (all users' transactions to the saved-money cat).
	var savedMoneyBalance float64
	if cycle.SavedMoneyCategoryID > 0 {
		var pool []models.Transaction
		database.DB.
			Where("user_id = ? AND category_id = ?", uid, cycle.SavedMoneyCategoryID).
			Find(&pool)
		for _, p := range pool {
			if p.Type == "income" {
				savedMoneyBalance += p.Amount
			} else {
				savedMoneyBalance -= p.Amount
			}
		}
	}

	// Previous savings = net all-time minus net this cycle.
	var allIncome, allExpense float64
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type = 'income'", uid).
		Select("COALESCE(SUM(amount), 0)").Scan(&allIncome)
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type = 'expense'", uid).
		Select("COALESCE(SUM(amount), 0)").Scan(&allExpense)
	previousSavings := (allIncome - allExpense) - (income - expenses)

	// Cycle timing
	now := time.Now()
	daysTotal := 30
	if cycle.NextPaydayAt != nil {
		d := int(cycle.NextPaydayAt.Sub(cycle.CycleStartAt).Hours() / 24)
		if d >= 7 {
			daysTotal = d
		}
	}
	daysElapsed := int(now.Sub(cycle.CycleStartAt).Hours() / 24)
	if daysElapsed < 0 {
		daysElapsed = 0
	}
	daysRemaining := daysTotal - daysElapsed
	if daysRemaining < 0 {
		daysRemaining = 0
	}

	baseWeekly := 0.0
	if daysTotal > 0 {
		baseWeekly = variableAllowance / float64(daysTotal) * 7
	}

	// Rolling cycle-weeks: 7-day chunks from cycle_start_at.
	// Surplus / deficit from completed weeks carry into the next week's limit.
	currentWeekIndex := daysElapsed / 7
	rollover := 0.0
	for w := 0; w < currentWeekIndex; w++ {
		wFrom := cycle.CycleStartAt.AddDate(0, 0, w*7)
		wTo := cycle.CycleStartAt.AddDate(0, 0, (w+1)*7)
		rollover += baseWeekly - sumVariableInRange(txs, cycle.FixedExpCategoryID, cycle.SavedMoneyCategoryID, wFrom, wTo)
	}
	currentWeekFrom := cycle.CycleStartAt.AddDate(0, 0, currentWeekIndex*7)
	currentWeekTo := currentWeekFrom.AddDate(0, 0, 7)
	currentWeekSpent := sumVariableInRange(txs, cycle.FixedExpCategoryID, cycle.SavedMoneyCategoryID, currentWeekFrom, currentWeekTo)
	currentWeekAllowance := baseWeekly + rollover
	if currentWeekAllowance < 0 {
		currentWeekAllowance = 0
	}

	return CycleStats{
		CycleIncome:            income,
		CycleExpenses:          expenses,
		CycleFixedExpenses:     fixedExp,
		CycleVariableExpenses:  variableExp,
		VariableAllowance:      variableAllowance,
		DynamicSavings:         dynamicSavings,
		SavedMoneyBalance:      savedMoneyBalance,
		NetDiscretionaryBudget: variableAllowance,
		PreviousSavings:        previousSavings,
		DaysTotal:              daysTotal,
		DaysElapsed:            daysElapsed,
		DaysRemaining:          daysRemaining,
		BaseWeeklyAllowance:    baseWeekly,
		CurrentWeekIndex:       currentWeekIndex,
		CurrentWeekAllowance:   currentWeekAllowance,
		CurrentWeekSpent:       currentWeekSpent,
		Rollover:               rollover,
	}
}

// sumVariableInRange sums variable expenses in [from, to), excluding the
// fixed-payments category AND the savings-pool category.
func sumVariableInRange(txs []models.Transaction, fixedCatID uint, savedMoneyCatID uint, from, to time.Time) float64 {
	var sum float64
	for _, tx := range txs {
		if tx.Type != "expense" {
			continue
		}
		if fixedCatID > 0 && tx.CategoryID == fixedCatID {
			continue
		}
		if savedMoneyCatID > 0 && tx.CategoryID == savedMoneyCatID {
			continue
		}
		if !tx.CreatedAt.Before(from) && tx.CreatedAt.Before(to) {
			sum += tx.Amount
		}
	}
	return sum
}

// ── StartSalaryCycle ─────────────────────────────────────────────────────────

func StartSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		BaseSalary     float64             `json:"base_salary"`
		Bonuses        float64             `json:"bonuses"`
		NextPayday     string              `json:"next_payday_date"`
		ReceivedAtDate string              `json:"received_at_date"`
		Language       string              `json:"language"`
		NeedsPct       float64             `json:"needs_pct"`
		WantsPct       float64             `json:"wants_pct"`
		SavingsPct     float64             `json:"savings_pct"`
		FixedExpenses  []FixedExpenseInput `json:"fixed_expenses"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.BaseSalary <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "base_salary must be greater than zero"})
		return
	}
	if req.NeedsPct == 0 && req.WantsPct == 0 && req.SavingsPct == 0 {
		req.NeedsPct, req.WantsPct, req.SavingsPct = 50, 30, 20
	}
	total := req.NeedsPct + req.WantsPct + req.SavingsPct
	if total < 99.9 || total > 100.1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "needs_pct + wants_pct + savings_pct must equal 100"})
		return
	}

	var receivedAt time.Time
	if req.ReceivedAtDate != "" {
		parsed, err := time.Parse("2006-01-02", req.ReceivedAtDate)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid received_at_date format. Use YYYY-MM-DD"})
			return
		}
		y, m, d := parsed.Date()
		receivedAt = time.Date(y, m, d, 12, 0, 0, 0, time.Local)
	} else {
		receivedAt = time.Now()
	}

	cycleStart := receivedAt
	txDate := receivedAt.Truncate(24 * time.Hour)

	totalIncome := req.BaseSalary + req.Bonuses
	fw := ComputeBudgetFramework(totalIncome, req.NeedsPct, req.WantsPct, req.SavingsPct, req.FixedExpenses)

	lang := normalizeLang(req.Language)

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
		CycleStartAt:    cycleStart,
		CreatedAt:       receivedAt,
		UpdatedAt:       receivedAt,
	}
	if req.NextPayday != "" {
		parsed, err := time.Parse("2006-01-02", req.NextPayday)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid next_payday_date format. Use YYYY-MM-DD"})
			return
		}
		cycle.NextPaydayAt = &parsed
	}

	// ── Overlap guard ────────────────────────────────────────────────────────
	// Load every existing cycle for this user (ASC). If receivedAt — normalised
	// to midnight UTC so timezone offsets can never shift the calendar day —
	// falls within any existing cycle's [start, end] window, that cycle IS the
	// current period. Return it directly instead of inserting a new row and
	// fragmenting the timeline.
	targetDate := toDateOnly(cycleStart)
	var allUserCycles []models.SalaryCycle
	database.DB.Preload("FixedExpenses").
		Where("user_id = ?", uid).
		Order("cycle_start_at ASC").
		Find(&allUserCycles)

	for i := range allUserCycles {
		if isDateInCycleWindow(targetDate, allUserCycles[i]) {
			existing := allUserCycles[i]
			log.Printf("start salary cycle: user=%v date=%v already covered by cycle id=%v (start=%v) — returning existing",
				uid, targetDate.Format("2006-01-02"), existing.ID,
				toDateOnly(existing.CycleStartAt).Format("2006-01-02"))
			stats := computeCycleStats(uid, existing)
			fw := BudgetFramework{
				TotalIncome:     existing.TotalIncome,
				NeedsLimit:      existing.NeedsLimit,
				WantsLimit:      existing.WantsLimit,
				SavingsLimit:    existing.SavingsLimit,
				FixedNeedsTotal: existing.FixedNeedsTotal,
				FixedWantsTotal: existing.FixedWantsTotal,
				VarNeedsBudget:  existing.VarNeedsBudget,
				VarWantsBudget:  existing.VarWantsBudget,
				DeficitWarning:  existing.VarNeedsBudget < 0,
			}
			c.JSON(http.StatusOK, gin.H{
				"cycle":            existing,
				"budget_framework": fw,
				"cycle_stats":      stats,
			})
			return
		}
	}

	// No overlap — safe to create a new cycle.
	// The most-recent existing cycle (last in ASC slice) is the "previous" one
	// for end-of-cycle surplus/deficit resolution.
	var prevCycle *models.SalaryCycle
	if len(allUserCycles) > 0 {
		prev := allUserCycles[len(allUserCycles)-1]
		prevCycle = &prev
	}

	var incomeTxID uint

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&cycle).Error; err != nil {
			return err
		}

		// Fixed expense metadata
		for _, fe := range req.FixedExpenses {
			ct := strings.ToLower(strings.TrimSpace(fe.CategoryType))
			if ct != "want" {
				ct = "need"
			}
			fex := models.FixedExpense{
				SalaryCycleID: cycle.ID,
				UserID:        uid,
				Amount:        fe.Amount,
				Description:   strings.TrimSpace(fe.Description),
				CategoryType:  ct,
				CreatedAt:     receivedAt,
				UpdatedAt:     receivedAt,
			}
			if err := tx.Create(&fex).Error; err != nil {
				return err
			}
		}

		// ── Income category ────────────────────────────────────────────────
		var incomeCat models.Category
		if err := tx.Where("user_id = ?", uid).
			Where("LOWER(name) IN ('income','доход','дохід','einkommen','salary')").
			First(&incomeCat).Error; err != nil {
			if err2 := tx.Where("user_id = ?", uid).First(&incomeCat).Error; err2 != nil {
				incomeCat = models.Category{UserID: uid, Name: "Income", CreatedAt: receivedAt, UpdatedAt: receivedAt}
				if err3 := tx.Create(&incomeCat).Error; err3 != nil {
					return err3
				}
			}
		}

		// ── "Fixed Payments" category (localized) ─────────────────────────
		fixedCatName := fixedCatByLang[lang]
		var fixedCat models.Category
		found := false
		for _, name := range fixedCatByLang {
			if err := tx.Where("user_id = ? AND name = ?", uid, name).First(&fixedCat).Error; err == nil {
				found = true
				break
			}
		}
		if !found {
			fixedCat = models.Category{UserID: uid, Name: fixedCatName, CreatedAt: receivedAt, UpdatedAt: receivedAt}
			if err := tx.Create(&fixedCat).Error; err != nil {
				return err
			}
		}
		cycle.FixedExpCategoryID = fixedCat.ID
		if err := tx.Model(&cycle).Update("fixed_exp_category_id", fixedCat.ID).Error; err != nil {
			return err
		}

		// ── "Saved Money" category (localized) ────────────────────────────
		savedCatName := savedMoneyCatByLang[lang]
		var savedCat models.Category
		savedFound := false
		for _, name := range savedMoneyCatByLang {
			if err := tx.Where("user_id = ? AND name = ?", uid, name).First(&savedCat).Error; err == nil {
				savedFound = true
				break
			}
		}
		if !savedFound {
			savedCat = models.Category{UserID: uid, Name: savedCatName, CreatedAt: receivedAt, UpdatedAt: receivedAt}
			if err := tx.Create(&savedCat).Error; err != nil {
				return err
			}
		}
		cycle.SavedMoneyCategoryID = savedCat.ID
		if err := tx.Model(&cycle).Update("saved_money_category_id", savedCat.ID).Error; err != nil {
			return err
		}

		// ── Pillar 4: End-of-cycle surplus / deficit resolution ────────────
		// When the user starts a new cycle, compute the previous cycle's
		// remaining variable balance and inject a real transaction into the
		// savings pool ("Pleasant bonus" or "Penalty from previous cycle").
		if prevCycle != nil && savedCat.ID > 0 {
			// Re-query previous cycle's transactions (closed window)
			var prevTxs []models.Transaction
			tx.Where("user_id = ? AND created_at >= ? AND created_at < ?",
				uid, prevCycle.CycleStartAt, cycleStart).
				Find(&prevTxs)

			var prevIncome, prevFixed, prevVariable float64
			for _, pt := range prevTxs {
				if (cycle.SavedMoneyCategoryID > 0 && pt.CategoryID == cycle.SavedMoneyCategoryID) ||
					(prevCycle.SavedMoneyCategoryID > 0 && pt.CategoryID == prevCycle.SavedMoneyCategoryID) {
					continue
				}
				switch pt.Type {
				case "income":
					prevIncome += pt.Amount
				case "expense":
					if prevCycle.FixedExpCategoryID > 0 && pt.CategoryID == prevCycle.FixedExpCategoryID {
						prevFixed += pt.Amount
					} else {
						prevVariable += pt.Amount
					}
				}
			}

			prevSavingsAlloc := prevIncome * prevCycle.SavingsPct / 100
			prevVarAllowance := math.Max(0, prevIncome-prevSavingsAlloc-prevFixed)
			remainingBalance := prevVarAllowance - prevVariable

			if math.Abs(remainingBalance) > 0.01 {
				transferType := "income"
				transferDesc := "Pleasant bonus from the previous cycle"
				if remainingBalance < 0 {
					transferType = "expense"
					transferDesc = "Penalty from previous cycle"
				}
				savingsTx := models.Transaction{
					UserID:      uid,
					CategoryID:  savedCat.ID,
					Amount:      math.Abs(remainingBalance),
					Description: transferDesc,
					Date:        txDate,
					Type:        transferType,
					IncomeType:  "one_time",
					CreatedAt:   receivedAt,
					UpdatedAt:   receivedAt,
				}
				if err := tx.Create(&savingsTx).Error; err != nil {
					return err
				}
			}
		}

		// ── Income transaction ─────────────────────────────────────────────
		incomeTxn := models.Transaction{
			UserID:      uid,
			CategoryID:  incomeCat.ID,
			Amount:      totalIncome,
			Description: "Salary",
			Date:        txDate,
			Type:        "income",
			IncomeType:  "one_time",
			CreatedAt:   receivedAt,
			UpdatedAt:   receivedAt,
		}
		if err := tx.Create(&incomeTxn).Error; err != nil {
			return err
		}
		incomeTxID = incomeTxn.ID

		// ── Fixed expense transactions ─────────────────────────────────────
		for _, fe := range req.FixedExpenses {
			if fe.Amount <= 0 {
				continue
			}
			desc := strings.TrimSpace(fe.Description)
			if desc == "" {
				desc = fixedCatName
			}
			expTx := models.Transaction{
				UserID:      uid,
				CategoryID:  fixedCat.ID,
				Amount:      fe.Amount,
				Description: desc,
				Date:        txDate,
				Type:        "expense",
				IncomeType:  "one_time",
				CreatedAt:   receivedAt,
				UpdatedAt:   receivedAt,
			}
			if err := tx.Create(&expTx).Error; err != nil {
				return err
			}
		}

		// ── Sync user profile ─────────────────────────────────────────────
		profileUpdates := map[string]any{
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

// ── GetCurrentSalaryCycle ─────────────────────────────────────────────────────

func GetCurrentSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	// Load cycles ASC, then find the one whose date window covers today.
	// This prevents empty "fragment" cycles (created by backdated inserts)
	// from being returned as the active cycle instead of the canonical earlier one.
	var allCycles []models.SalaryCycle
	if dbErr := database.DB.Preload("FixedExpenses").
		Where("user_id = ?", uid).
		Order("cycle_start_at ASC").
		Find(&allCycles).Error; dbErr != nil {
		log.Printf("get current cycle: user=%v err=%v", uid, dbErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch salary cycle"})
		return
	}
	if len(allCycles) == 0 {
		// User has never started a cycle — clean no-cycle state, no INSERT.
		c.JSON(http.StatusOK, gin.H{
			"cycle":            nil,
			"budget_framework": nil,
			"cycle_stats":      nil,
			"has_active_cycle": false,
		})
		return
	}

	today := toDateOnly(time.Now())
	var activeCycle *models.SalaryCycle
	hasActive := false
	for i := range allCycles {
		if isDateInCycleWindow(today, allCycles[i]) {
			activeCycle = &allCycles[i]
			hasActive = true
			break // ASC order → first match is the earliest (canonical) covering cycle
		}
	}
	if activeCycle == nil {
		activeCycle = &allCycles[len(allCycles)-1] // all ended — show most recent for reference
	}
	cycle := *activeCycle

	// Only compute live stats when a cycle actually covers today.
	// When the last cycle has ended (hasActive == false) we return cycle_stats: null
	// so the frontend shows strictly zero in every card rather than stale numbers
	// from a period that is already over.
	var cycleStatsPayload interface{}
	if hasActive {
		s := computeCycleStats(uid, cycle)
		cycleStatsPayload = s
	}

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
		"cycle_stats":      cycleStatsPayload, // nil → JSON null when no active cycle
		"has_active_cycle": hasActive,
	})
}

// ── UpdateCycleNextPayday ─────────────────────────────────────────────────────

func UpdateCycleNextPayday(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		NextPayday string `json:"next_payday" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	newDate, err := time.Parse("2006-01-02", req.NextPayday)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid next_payday format. Use YYYY-MM-DD"})
		return
	}

	var cycle models.SalaryCycle
	if err := database.DB.Where("user_id = ?", uid).
		Order("cycle_start_at DESC").
		First(&cycle).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "No active salary cycle found"})
			return
		}
		log.Printf("patch cycle payday: find user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycle"})
		return
	}

	// Timezone-safe date comparison: compare YYYY-MM-DD strings at UTC midnight.
	cycleStartDateStr := cycle.CycleStartAt.UTC().Format("2006-01-02")
	startDateOnly, _ := time.Parse("2006-01-02", cycleStartDateStr)
	if !newDate.After(startDateOnly) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "next_payday must be after the cycle start date"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&cycle).Updates(map[string]any{
		"next_payday_at": newDate,
		"updated_at":     now,
	}).Error; err != nil {
		log.Printf("patch cycle payday: update user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update next payday"})
		return
	}

	if err := database.DB.Model(&models.User{}).Where("id = ?", uid).
		Update("manual_next_payday", req.NextPayday).Error; err != nil {
		log.Printf("patch cycle payday: profile sync user=%v err=%v", uid, err)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":        "Next payday updated",
		"next_payday_at": newDate.Format("2006-01-02"),
	})
}

// ── GetSalaryCycleHistory ─────────────────────────────────────────────────────

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

// ── AddCycleIncome (Pillar 5) ─────────────────────────────────────────────────
// POST /api/salary-cycle/income
// Adds an additional income transaction to the active cycle, then returns
// fresh cycle stats so the dashboard re-renders immediately.

func AddCycleIncome(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		Amount      float64 `json:"amount"      binding:"required,gt=0"`
		Date        string  `json:"date"`        // YYYY-MM-DD; defaults to today
		Description string  `json:"description"` // user-supplied note
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cycle := findActiveCycle(uid)
	if cycle == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active salary cycle found"})
		return
	}

	// Find or create the income category
	var incomeCat models.Category
	if err := database.DB.Where("user_id = ?", uid).
		Where("LOWER(name) IN ('income','доход','дохід','einkommen','salary')").
		First(&incomeCat).Error; err != nil {
		if err2 := database.DB.Where("user_id = ?", uid).First(&incomeCat).Error; err2 != nil {
			incomeCat = models.Category{UserID: uid, Name: "Income"}
			if err3 := database.DB.Create(&incomeCat).Error; err3 != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to find income category"})
				return
			}
		}
	}

	now := time.Now()
	txDate := now.Truncate(24 * time.Hour)
	if req.Date != "" {
		if parsed, err := time.Parse("2006-01-02", req.Date); err == nil {
			txDate = parsed
		}
	}

	desc := strings.TrimSpace(req.Description)
	if desc == "" {
		desc = "Additional Income"
	}

	newTx := models.Transaction{
		UserID:      uid,
		CategoryID:  incomeCat.ID,
		Amount:      req.Amount,
		Description: desc,
		Date:        txDate,
		Type:        "income",
		IncomeType:  "one_time",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := database.DB.Create(&newTx).Error; err != nil {
		log.Printf("add cycle income: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add income"})
		return
	}

	stats := computeCycleStats(uid, *cycle)
	c.JSON(http.StatusCreated, gin.H{
		"transaction": newTx,
		"cycle_stats": stats,
	})
}

// ── GetSavingsHistory (Pillar 4) ──────────────────────────────────────────────
// GET /api/salary-cycle/savings-history
// Returns all savings-pool transactions for the current user, together with
// the running pool balance and the savings category ID.

func GetSavingsHistory(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	cycle := findActiveCycle(uid)
	if cycle == nil || cycle.SavedMoneyCategoryID == 0 {
		c.JSON(http.StatusOK, gin.H{"transactions": []any{}, "balance": 0.0, "savings_category_id": 0})
		return
	}

	var txs []models.Transaction
	database.DB.Preload("Category").
		Where("user_id = ? AND category_id = ?", uid, cycle.SavedMoneyCategoryID).
		Order("created_at DESC").
		Find(&txs)

	var balance float64
	for _, tx := range txs {
		if tx.Type == "income" {
			balance += tx.Amount
		} else {
			balance -= tx.Amount
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"transactions":        txs,
		"balance":             balance,
		"savings_category_id": cycle.SavedMoneyCategoryID,
	})
}

// ── DeleteSalaryCycle ─────────────────────────────────────────────────────────
// DELETE /api/salary-cycle/:id
// Hard-deletes the SalaryCycle row and soft-deletes the auto-generated
// transactions that were created when that specific cycle was provisioned
// (Salary income, fixed expenses, savings transfers — all within 60 s of
// cycle_start_at). User-entered transactions are NOT touched.

func DeleteSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	cycleIDRaw, err := strconv.ParseUint(c.Param("id"), 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cycle ID"})
		return
	}
	cycleID := uint(cycleIDRaw)

	var cycle models.SalaryCycle
	if err := database.DB.Where("id = ? AND user_id = ?", cycleID, uid).
		First(&cycle).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Cycle not found or access denied"})
			return
		}
		log.Printf("delete cycle: find user=%v cycle=%v err=%v", uid, cycleID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycle"})
		return
	}

	// 60-second window captures all auto-provisioned transactions (they all
	// receive CreatedAt == cycleStart during the single atomic write).
	winEnd := cycle.CycleStartAt.Add(60 * time.Second)

	// Soft-delete the auto-generated Salary income transaction.
	database.DB.Where(
		"user_id = ? AND created_at >= ? AND created_at <= ? AND type = 'income' AND description = 'Salary'",
		uid, cycle.CycleStartAt, winEnd,
	).Delete(&models.Transaction{})

	// Soft-delete auto-generated fixed-expense transactions.
	if cycle.FixedExpCategoryID > 0 {
		database.DB.Where(
			"user_id = ? AND created_at >= ? AND created_at <= ? AND category_id = ?",
			uid, cycle.CycleStartAt, winEnd, cycle.FixedExpCategoryID,
		).Delete(&models.Transaction{})
	}

	// Soft-delete auto-generated savings-transfer transactions.
	if cycle.SavedMoneyCategoryID > 0 {
		database.DB.Where(
			"user_id = ? AND created_at >= ? AND created_at <= ? AND category_id = ?",
			uid, cycle.CycleStartAt, winEnd, cycle.SavedMoneyCategoryID,
		).Delete(&models.Transaction{})
	}

	// Hard-delete the FixedExpense metadata rows (no DeletedAt column).
	database.DB.Where("salary_cycle_id = ?", cycle.ID).Delete(&models.FixedExpense{})

	// Hard-delete the SalaryCycle row itself.
	if err := database.DB.Delete(&cycle).Error; err != nil {
		log.Printf("delete cycle: remove user=%v cycle=%v err=%v", uid, cycleID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete cycle"})
		return
	}

	log.Printf("delete cycle: user=%v deleted cycle id=%v (start=%v)",
		uid, cycleID, cycle.CycleStartAt.Format("2006-01-02"))
	c.JSON(http.StatusOK, gin.H{"message": "Cycle deleted", "id": cycleID})
}

// ── helpers ───────────────────────────────────────────────────────────────────

func normalizeLang(raw string) string {
	lang := strings.ToLower(strings.SplitN(strings.TrimSpace(raw), "-", 2)[0])
	if _, ok := fixedCatByLang[lang]; !ok {
		lang = "en"
	}
	return lang
}

// toDateOnly normalises t to midnight UTC so that timezone offsets or
// time-of-day differences can never make the same calendar day appear to be
// in a different cycle window.
func toDateOnly(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// isDateInCycleWindow reports whether date (should already be midnight UTC via
// toDateOnly) falls in the inclusive range [CycleStartAt, NextPaydayAt].
// An open-ended cycle (NextPaydayAt == nil) covers every date ≥ start.
func isDateInCycleWindow(date time.Time, cycle models.SalaryCycle) bool {
	start := toDateOnly(cycle.CycleStartAt)
	if date.Before(start) {
		return false
	}
	if cycle.NextPaydayAt == nil {
		return true
	}
	end := toDateOnly(*cycle.NextPaydayAt)
	return !date.After(end)
}

// findActiveCycle returns the salary cycle whose window covers today, falling
// back to the most recently started cycle when none is currently active.
// Returns nil when the user has no cycles at all.
func findActiveCycle(uid uint) *models.SalaryCycle {
	var cycles []models.SalaryCycle
	database.DB.Where("user_id = ?", uid).
		Order("cycle_start_at ASC").
		Find(&cycles)
	if len(cycles) == 0 {
		return nil
	}
	today := toDateOnly(time.Now())
	for i := range cycles {
		if isDateInCycleWindow(today, cycles[i]) {
			return &cycles[i]
		}
	}
	return &cycles[len(cycles)-1]
}

// ── AddSavingsManual ──────────────────────────────────────────────────────────
// POST /api/salary-cycle/savings
// Creates a manual entry in the savings pool:
//
//	amount > 0  →  deposit  (income transaction)
//	amount < 0  →  withdrawal (expense transaction)
//
// Returns fresh CycleStats so the dashboard updates without a full page reload.
func AddSavingsManual(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		Amount      float64 `json:"amount" binding:"required"`
		Description string  `json:"description"`
		Date        string  `json:"date"` // YYYY-MM-DD; optional
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Amount == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount must be non-zero"})
		return
	}

	cycle := findActiveCycle(uid)
	if cycle == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active salary cycle found"})
		return
	}
	if cycle.SavedMoneyCategoryID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Savings category not configured — start a new cycle first"})
		return
	}

	txType := "income"
	txAmount := req.Amount
	if txAmount < 0 {
		txType = "expense"
		txAmount = -txAmount
	}

	now := time.Now()
	txDate := now.Truncate(24 * time.Hour)
	if req.Date != "" {
		if parsed, err := time.Parse("2006-01-02", req.Date); err == nil {
			txDate = parsed
		}
	}

	desc := strings.TrimSpace(req.Description)
	if desc == "" {
		desc = "Manual savings transfer"
	}

	newTx := models.Transaction{
		UserID:      uid,
		CategoryID:  cycle.SavedMoneyCategoryID,
		Amount:      txAmount,
		Description: desc,
		Date:        txDate,
		Type:        txType,
		IncomeType:  "one_time",
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := database.DB.Create(&newTx).Error; err != nil {
		log.Printf("add savings manual: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add savings entry"})
		return
	}

	stats := computeCycleStats(uid, *cycle)
	c.JSON(http.StatusCreated, gin.H{"transaction": newTx, "cycle_stats": stats})
}
