package handlers

import (
	"errors"
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
	TotalIncome      float64 `json:"total_income"`
	NeedsLimit       float64 `json:"needs_limit"`
	WantsLimit       float64 `json:"wants_limit"`
	SavingsLimit     float64 `json:"savings_limit"`
	FixedNeedsTotal  float64 `json:"fixed_needs_total"`
	FixedWantsTotal  float64 `json:"fixed_wants_total"`
	VarNeedsBudget   float64 `json:"var_needs_budget"`
	VarWantsBudget   float64 `json:"var_wants_budget"`
	DeficitWarning   bool    `json:"deficit_warning"`
	SuggestedProfile *string `json:"suggested_profile"`
}

type FixedExpenseInput struct {
	Amount       float64 `json:"amount"`
	Description  string  `json:"description"`
	CategoryType string  `json:"category_type"` // need | want
}

func ComputeBudgetFramework(totalIncome, needsPct, wantsPct, savingsPct float64, fixedExpenses []FixedExpenseInput) BudgetFramework {
	// Savings is rounded down to whole units; the cents it sheds go to Wants
	// (spendable), so needs + wants + savings still equals totalIncome exactly.
	needsLimit := totalIncome * needsPct / 100
	wantsLimit := totalIncome*wantsPct/100 + savingsRoundingRemainder(totalIncome, savingsPct)
	savingsLimit := plannedSavingsAllocation(totalIncome, savingsPct)

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
	DaysTotal     int `json:"days_total"`
	DaysElapsed   int `json:"days_elapsed"`
	DaysRemaining int `json:"days_remaining"`

	// Rolling cycle-week engine (7-day chunks from cycle_start_at)
	BaseWeeklyAllowance  float64 `json:"base_weekly_allowance"`
	CurrentWeekIndex     int     `json:"current_week_index"`
	CurrentWeekAllowance float64 `json:"current_week_allowance"`
	CurrentWeekSpent     float64 `json:"current_week_spent"`
	Rollover             float64 `json:"rollover"`
}

// computeCycleStats builds CycleStats for a cycle as of now, in the user's
// remembered timezone. Entry point for work outside a request (background
// resync, AI hints); request handlers use computeCycleStatsAt with their clock.
func computeCycleStats(uid uint, cycle models.SalaryCycle) CycleStats {
	all, _ := loadUserCycles(uid)
	return computeCycleStatsAt(uid, cycle, all, userClock(uid))
}

// computeCycleStatsAt builds the full CycleStats for one salary cycle.
// It reads ONLY live (soft-delete-safe) transactions in the cycle's window
// (see cycle_window.go) and performs all arithmetic here, so React never needs
// to do client-side date math.
func computeCycleStatsAt(uid uint, cycle models.SalaryCycle, all []models.SalaryCycle, k cycleClock) CycleStats {
	txs := loadWindowTransactions(uid, k.window(cycle, all), k)

	var income, expenses, fixedExp, variableExp float64
	for _, tx := range txs {
		if isSavingsPoolTx(tx.Transaction, cycle.SavedMoneyCategoryID) {
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
	// Whole units only; the rounded-off cents stay in the variable allowance below.
	dynamicSavings := plannedSavingsAllocation(income, cycle.SavingsPct)

	// Variable Allowance = what's truly available for discretionary spending.
	variableAllowance := math.Max(0, income-dynamicSavings-fixedExp)

	// Live remaining savings-pool balance (allocated − withdrawn + additions).
	savedMoneyBalance := savingsPoolBalance(uid, cycle.SavedMoneyCategoryID)

	// Previous savings = net all-time minus net this cycle.
	var allIncome, allExpense float64
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type IN ('income', 'savings_deposit')", uid).
		Select("COALESCE(SUM(amount), 0)").Scan(&allIncome)
	database.DB.Model(&models.Transaction{}).
		Where("user_id = ? AND type IN ('expense', 'savings_withdrawal')", uid).
		Select("COALESCE(SUM(amount), 0)").Scan(&allExpense)
	previousSavings := (allIncome - allExpense) - (income - expenses)

	// Cycle timing (payday evaluated at local midnight in the user's zone)
	daysTotal := 30
	if ps := k.paydayStart(cycle); ps != nil {
		d := int(ps.Sub(cycle.CycleStartAt).Hours() / 24)
		if d >= 7 {
			daysTotal = d
		}
	}
	daysElapsed := int(k.Now.Sub(cycle.CycleStartAt).Hours() / 24)
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

	// Hard ceiling: the week's allowance can never authorise spending more,
	// across the rest of the cycle, than the cycle's remaining variable balance.
	// Without this, accumulated rollover/surplus (amplified when a manual income
	// recomputes baseWeekly retroactively) lets "can spend this week" exceed the
	// total left in the cycle — a mathematically impossible figure. Cap so that
	// (allowance - currentWeekSpent) <= remaining cycle balance.
	cycleRemaining := variableAllowance - variableExp
	maxAllowance := cycleRemaining + currentWeekSpent
	if currentWeekAllowance > maxAllowance {
		currentWeekAllowance = maxAllowance
	}
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

// sumVariableInRange sums variable expenses whose event instant is in
// [from, to), excluding the fixed-payments category AND the savings-pool category.
func sumVariableInRange(txs []windowTx, fixedCatID uint, savedMoneyCatID uint, from, to time.Time) float64 {
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
		if !tx.At.Before(from) && tx.At.Before(to) {
			sum += tx.Amount
		}
	}
	return sum
}

// ── StartSalaryCycle ─────────────────────────────────────────────────────────

// resolveCycleStart turns the "salary received on" date (+ optional local
// HH:MM) into the cycle's exact start instant:
//   - no date, or today without a time → now (not a fixed noon, which used to
//     put same-morning transactions before the cycle start);
//   - another date without a time → 00:00 local on that date;
//   - an explicit time is honoured, clamped to now so a start is never later
//     than the moment it is recorded on the same day.
//
// Truncated to microseconds — the database's precision — so the handover
// instant written to the previous cycle compares equal after a round-trip.
func resolveCycleStart(dateStr, timeStr string, k cycleClock) (time.Time, error) {
	day := k.today()
	if dateStr != "" {
		d, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			return time.Time{}, errors.New("Invalid received_at_date format. Use YYYY-MM-DD")
		}
		day = d
	}
	var start time.Time
	switch {
	case timeStr != "":
		hm, err := time.Parse("15:04", timeStr)
		if err != nil {
			return time.Time{}, errors.New("Invalid received_at_time format. Use HH:MM")
		}
		start = k.storedDayStart(day).Add(time.Duration(hm.Hour())*time.Hour + time.Duration(hm.Minute())*time.Minute)
		if day.Equal(k.today()) && start.After(k.Now) {
			start = k.Now
		}
	case day.Equal(k.today()):
		start = k.Now
	default:
		start = k.storedDayStart(day)
	}
	return start.UTC().Truncate(time.Microsecond), nil
}

// cycleToHandOver is the cycle a new one starting at `start` takes over from:
// the latest cycle starting before it that has not been handed over yet.
func cycleToHandOver(start time.Time, all []models.SalaryCycle) *models.SalaryCycle {
	var prev *models.SalaryCycle
	for i := range all {
		if all[i].CycleStartAt.Before(start) {
			prev = &all[i]
		}
	}
	if prev == nil || handoverAt(*prev, all) != nil {
		return nil
	}
	return prev
}

// previousCycleSurplus is the variable-budget balance left in a cycle over its
// final window [start, handover): positive = surplus (bonus to the pool),
// negative = overspend (penalty from the pool).
func previousCycleSurplus(uid uint, prev models.SalaryCycle, handover time.Time, k cycleClock) float64 {
	txs := loadWindowTransactions(uid, cycleWindow{Start: prev.CycleStartAt, End: &handover}, k)
	var income, fixed, variable float64
	for _, t := range txs {
		if isSavingsPoolTx(t.Transaction, prev.SavedMoneyCategoryID) {
			continue
		}
		switch t.Type {
		case "income":
			income += t.Amount
		case "expense":
			if prev.FixedExpCategoryID > 0 && t.CategoryID == prev.FixedExpCategoryID {
				fixed += t.Amount
			} else {
				variable += t.Amount
			}
		}
	}
	allowance := math.Max(0, income-plannedSavingsAllocation(income, prev.SavingsPct)-fixed)
	return allowance - variable
}

// frameworkOf rebuilds the stored budget framework of a cycle.
func frameworkOf(c models.SalaryCycle) BudgetFramework {
	return BudgetFramework{
		TotalIncome:     c.TotalIncome,
		NeedsLimit:      c.NeedsLimit,
		WantsLimit:      c.WantsLimit,
		SavingsLimit:    c.SavingsLimit,
		FixedNeedsTotal: c.FixedNeedsTotal,
		FixedWantsTotal: c.FixedWantsTotal,
		VarNeedsBudget:  c.VarNeedsBudget,
		VarWantsBudget:  c.VarWantsBudget,
		DeficitWarning:  c.VarNeedsBudget < 0,
	}
}

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
		ReceivedAtTime string              `json:"received_at_time"` // optional HH:MM, local
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

	k := requestClock(c, uid)
	receivedAt, parseErr := resolveCycleStart(req.ReceivedAtDate, req.ReceivedAtTime, k)
	if parseErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": parseErr.Error()})
		return
	}

	cycleStart := receivedAt
	txDate := k.storedDate(receivedAt)

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
		// Shared invariant with the edit gate: a cycle must be at least 7 days.
		if parsed.Before(k.storedDate(cycleStart).AddDate(0, 0, MinCycleDays)) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": validationMessage(errCycleTooShort), "code": errCycleTooShort,
			})
			return
		}
		cycle.NextPaydayAt = &parsed
	}

	allUserCycles, dbErr := loadUserCycles(uid)
	if dbErr != nil {
		log.Printf("start salary cycle: fetch user=%v err=%v", uid, dbErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch salary cycles"})
		return
	}

	// ── Idempotent resubmit ──────────────────────────────────────────────────
	// A live cycle that already started on the same local day IS this period
	// (e.g. a double-submitted form): return it instead of fragmenting the
	// timeline.
	for i := range allUserCycles {
		existing := allUserCycles[i]
		if existing.StoppedAt != nil || !k.storedDate(existing.CycleStartAt).Equal(k.storedDate(cycleStart)) {
			continue
		}
		log.Printf("start salary cycle: user=%v already has cycle id=%v starting %v — returning existing",
			uid, existing.ID, k.storedDate(existing.CycleStartAt).Format("2006-01-02"))
		c.JSON(http.StatusOK, gin.H{
			"cycle":            existing,
			"budget_framework": frameworkOf(existing),
			"cycle_stats":      computeCycleStatsAt(uid, existing, allUserCycles, k),
		})
		return
	}

	// ── No-overlap rule (§3) ─────────────────────────────────────────────────
	// A new cycle may not start inside any existing cycle's planned days
	// (stopped or not — the user still lived on that period). The payday itself
	// is shared: starting on or after the previous cycle's payday (local time)
	// is a handover, not an overlap. See conflictingCycle.
	if ex := k.conflictingCycle(cycleStart, cycle.NextPaydayAt, allUserCycles); ex != nil {
		log.Printf("start salary cycle: user=%v new start %v overlaps cycle id=%v (start=%v) — rejected",
			uid, cycleStart.Format(time.RFC3339), ex.ID, ex.CycleStartAt.Format(time.RFC3339))
		c.JSON(http.StatusBadRequest, gin.H{
			"error": validationMessage(errCycleOverlap), "code": errCycleOverlap,
		})
		return
	}

	// The cycle handed over to the new one: the latest one starting before it
	// that has not been handed over yet. Its leftover variable balance goes to
	// the savings pool (Pillar 4), computed over its final window.
	prevCycle := cycleToHandOver(cycleStart, allUserCycles)
	var prevSurplus float64
	if prevCycle != nil {
		prevSurplus = previousCycleSurplus(uid, *prevCycle, cycleStart, k)
	}

	var incomeTxID uint

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&cycle).Error; err != nil {
			return err
		}

		// Hand over: the previous cycle ends exactly where this one begins, so
		// no instant belongs to both cycles and none to neither. Only the end
		// instant is recorded — its start and planned payday stay untouched, and
		// no transaction is moved.
		if prevCycle != nil {
			if err := tx.Model(&models.SalaryCycle{}).Where("id = ?", prevCycle.ID).
				Update("ended_at", cycleStart).Error; err != nil {
				return err
			}
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
				incomeCat = models.Category{UserID: uid, Name: "Income", TranslationKey: "category.income", CreatedAt: receivedAt, UpdatedAt: receivedAt}
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
			fixedCat = models.Category{UserID: uid, Name: fixedCatName, TranslationKey: "category.fixed_payments", CreatedAt: receivedAt, UpdatedAt: receivedAt}
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
			savedCat = models.Category{UserID: uid, Name: savedCatName, TranslationKey: "category.saved_money", CreatedAt: receivedAt, UpdatedAt: receivedAt}
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
			remainingBalance := prevSurplus
			if math.Abs(remainingBalance) > 0.01 {
				transferType := "savings_deposit"
				transferDesc := "Pleasant bonus from the previous cycle"
				if remainingBalance < 0 {
					transferType = "savings_withdrawal"
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

		// ── Auto savings deposit ───────────────────────────────────────────
		// Transfer the planned savings allocation straight into the pool so
		// the savings card shows the correct balance from day one (digital
		// piggy bank). Amount = salary × savings_pct% rounded down to whole
		// units (fw.SavingsLimit); excluded from cycle income by type +
		// category checks in computeCycleStats.
		if fw.SavingsLimit > 0 && savedCat.ID > 0 {
			savingsAmount := fw.SavingsLimit
			autoSavingsTx := models.Transaction{
				UserID:      uid,
				CategoryID:  savedCat.ID,
				Amount:      savingsAmount,
				Description: "Planned savings allocation",
				Date:        txDate,
				Type:        "savings_deposit",
				IncomeType:  "one_time",
				CreatedAt:   receivedAt,
				UpdatedAt:   receivedAt,
			}
			if err := tx.Create(&autoSavingsTx).Error; err != nil {
				return err
			}
		}

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
			// Starting a salary cycle means the track-only intent no longer
			// applies — auto-disable Lite mode so the full UI returns. No data
			// is deleted; the user can re-enable it after ending the cycle.
			"lite_mode": false,
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

	InvalidateCycleCache(uid)

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

	// Fast path: serve the cached payload when fresh (invalidated on any write).
	if cached, ok := getCachedCycle(uid); ok {
		c.JSON(http.StatusOK, cached)
		return
	}

	k := requestClock(c, uid)
	allCycles, dbErr := loadUserCycles(uid)
	if dbErr != nil {
		log.Printf("get current cycle: user=%v err=%v", uid, dbErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch salary cycle"})
		return
	}
	if len(allCycles) == 0 {
		// User has never started a cycle — clean no-cycle state, no INSERT.
		payload := gin.H{
			"cycle":            nil,
			"budget_framework": nil,
			"cycle_stats":      nil,
			"has_active_cycle": false,
			"resumable_cycle":  nil,
			"payday_status":    paydayStatusNone,
			"window_start":     nil,
			"window_end":       nil,
		}
		setCachedCycle(uid, payload, nil)
		c.JSON(http.StatusOK, payload)
		return
	}

	// The current cycle (see cycle_window.go) — it stays current after its
	// payday until the next one starts, so new transactions never fall into a
	// gap. With none current (stopped), show the most recent one for reference.
	activeCycle, hasActive := k.currentOrLatest(allCycles)

	// Ensure the savings category is always linked — heals old/migrated cycles.
	if hasActive {
		ensureSavingsCategory(uid, activeCycle)
	}
	cycle := *activeCycle

	// Live stats only for a current cycle. A stopped cycle returns
	// cycle_stats: null so the frontend falls back to the no-cycle budget.
	var cycleStatsPayload interface{}
	if hasActive {
		cycleStatsPayload = computeCycleStatsAt(uid, cycle, allCycles, k)
	}

	// A stopped cycle whose planned dates still cover now can be resumed.
	// Surfaced so the UI can offer "Resume" (or show it disabled when another
	// cycle is active).
	var resumable interface{}
	if rc := findResumableCycle(uid, allCycles, k); rc != nil {
		resumable = gin.H{
			"id":             rc.ID,
			"cycle_start_at": rc.CycleStartAt,
			"next_payday_at": rc.NextPaydayAt,
		}
	}

	// The exact window the stats were computed over, so client-side views
	// (Statistics donut, card fallbacks) scope transactions identically.
	win := k.window(cycle, allCycles)

	payload := gin.H{
		"cycle":            cycle,
		"budget_framework": frameworkOf(cycle),
		"cycle_stats":      cycleStatsPayload, // nil → JSON null when no active cycle
		"has_active_cycle": hasActive,
		"resumable_cycle":  resumable, // nil → JSON null when nothing is resumable
		"payday_status":    k.paydayStatus(cycle),
		"window_start":     win.Start,
		"window_end":       win.End, // nil → open (current until handed over)
	}
	setCachedCycle(uid, payload, k.nextBoundary(cycle))
	c.JSON(http.StatusOK, payload)
}

// ── Cycle end-date (next payday) editing — §4 rules ───────────────────────────

// MinCycleDays is the hard floor on cycle length. An end date earlier than
// start + MinCycleDays is rejected outright (a "pocket-money for the week"
// cycle is legitimate; anything shorter is not).
const MinCycleDays = 7

// MaxCycleDays bounds an open-ended edit when no later cycle constrains it.
const MaxCycleDays = 180

// Structured validation codes the UI maps to localized hints.
const (
	errCycleTooShort   = "CYCLE_TOO_SHORT"          // end < start + 7d
	errEndBeforeLastTx = "CYCLE_END_BEFORE_LAST_TX" // end < last recorded expense
	errEndTooLate      = "CYCLE_END_TOO_LATE"       // end crosses into the next cycle / > max
	errNoActiveCycle   = "NO_ACTIVE_CYCLE"          // nothing editable
	errCycleOverlap    = "CYCLE_OVERLAP"            // new cycle overlaps an existing one
)

// cycleEndBounds computes the inclusive [min, max] range of local calendar days
// a cycle's next payday may be moved to (§4.3):
//
//	min = max(start + 7d, day of the latest transaction in the cycle) — never orphan a tx
//	max = the next cycle's start day if a later cycle exists (the payday is the
//	      shared handover day), else start + 180d
func cycleEndBounds(cycle models.SalaryCycle, allCycles []models.SalaryCycle, lastTx *time.Time, k cycleClock) (minEnd, maxEnd time.Time) {
	start := k.storedDate(cycle.CycleStartAt)

	minEnd = start.AddDate(0, 0, MinCycleDays)
	if lastTx != nil {
		if lt := k.storedDate(*lastTx); lt.After(minEnd) {
			minEnd = lt
		}
	}

	maxEnd = start.AddDate(0, 0, MaxCycleDays)
	for _, other := range allCycles {
		if other.ID == cycle.ID || !other.CycleStartAt.After(cycle.CycleStartAt) {
			continue
		}
		if next := k.storedDate(other.CycleStartAt); next.Before(maxEnd) {
			maxEnd = next
		}
	}
	return minEnd, maxEnd
}

// validateCycleEnd is the single authoritative gate for a new end date (a
// date-only value). It returns "" when valid, otherwise a structured error code.
func validateCycleEnd(cycle models.SalaryCycle, newEnd time.Time, lastTx *time.Time, maxEnd time.Time, k cycleClock) string {
	start := k.storedDate(cycle.CycleStartAt)
	nd := toDateOnly(newEnd)

	if nd.Before(start.AddDate(0, 0, MinCycleDays)) {
		return errCycleTooShort
	}
	if lastTx != nil && nd.Before(k.storedDate(*lastTx)) {
		return errEndBeforeLastTx
	}
	if nd.After(maxEnd) {
		return errEndTooLate
	}
	return ""
}

// latestTxAt is the event instant of the most recent transaction, or nil.
func latestTxAt(txs []windowTx) *time.Time {
	var latest *time.Time
	for i := range txs {
		if latest == nil || txs[i].At.After(*latest) {
			at := txs[i].At
			latest = &at
		}
	}
	return latest
}

func validationMessage(code string) string {
	switch code {
	case errCycleTooShort:
		return "A cycle must be at least 7 days long"
	case errEndBeforeLastTx:
		return "The end date can't be before your last recorded expense"
	case errEndTooLate:
		return "The end date can't overlap your next cycle"
	case errNoActiveCycle:
		return "No active salary cycle to edit"
	case errCycleOverlap:
		return "A cycle can't overlap another cycle"
	default:
		return "Invalid end date"
	}
}

// writeCycleAudit appends an immutable audit record. Called INSIDE the same
// transaction as the mutation so the change and its audit commit atomically.
func writeCycleAudit(tx *gorm.DB, uid, cycleID uint, field, oldVal, newVal string, ts time.Time) error {
	return tx.Create(&models.SalaryCycleAudit{
		UserID:        uid,
		SalaryCycleID: cycleID,
		Field:         field,
		OldValue:      oldVal,
		NewValue:      newVal,
		CreatedAt:     ts,
	}).Error
}

// UpdateCycleNextPayday — PATCH /api/salary-cycle/current
// Edits ONLY the active cycle's end date (start is immutable). Runs every change
// through validateCycleEnd. With "preview": true it validates + computes the
// PROJECTED stats without persisting (§4.6); otherwise it applies the change
// atomically and returns fresh stats (§4.4). Idempotent when unchanged.
func UpdateCycleNextPayday(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	var req struct {
		NextPayday string `json:"next_payday" binding:"required"`
		Preview    bool   `json:"preview"`
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

	// Resolve the CURRENT cycle. Only it is editable (§4.1 / closed-period lock);
	// stopped and handed-over cycles are never current.
	k := requestClock(c, uid)
	allCycles, dbErr := loadUserCycles(uid)
	if dbErr != nil {
		log.Printf("patch cycle payday: fetch user=%v err=%v", uid, dbErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycles"})
		return
	}
	cycle := k.currentCycle(allCycles)
	if cycle == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": validationMessage(errNoActiveCycle), "code": errNoActiveCycle})
		return
	}

	cycleTxs := loadWindowTransactions(uid, k.window(*cycle, allCycles), k)
	lastTx := latestTxAt(cycleTxs)
	minEnd, maxEnd := cycleEndBounds(*cycle, allCycles, lastTx, k)

	if code := validateCycleEnd(*cycle, newDate, lastTx, maxEnd, k); code != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":    validationMessage(code),
			"code":     code,
			"min_date": minEnd.Format("2006-01-02"),
			"max_date": maxEnd.Format("2006-01-02"),
		})
		return
	}

	// Projected stats on an in-memory copy with the new end — used for BOTH the
	// preview response and (after persisting) the applied response.
	preview := *cycle
	preview.NextPaydayAt = &newDate
	projected := computeCycleStatsAt(uid, preview, allCycles, k)

	// Transactions up to the end of the new payday (local time).
	newPaydayEnd := k.storedDayStart(newDate).AddDate(0, 0, 1)
	txInWindow := int64(0)
	for _, t := range cycleTxs {
		if t.At.Before(newPaydayEnd) {
			txInWindow++
		}
	}

	if req.Preview {
		c.JSON(http.StatusOK, gin.H{
			"preview":        true,
			"next_payday_at": newDate.Format("2006-01-02"),
			"min_date":       minEnd.Format("2006-01-02"),
			"max_date":       maxEnd.Format("2006-01-02"),
			"cycle_stats":    projected,
			"tx_in_window":   txInWindow,
			"days_total":     projected.DaysTotal,
		})
		return
	}

	// Idempotent no-op when unchanged — no write, no audit.
	if cycle.NextPaydayAt != nil && toDateOnly(*cycle.NextPaydayAt).Equal(toDateOnly(newDate)) {
		c.JSON(http.StatusOK, gin.H{
			"message":        "Next payday unchanged",
			"next_payday_at": newDate.Format("2006-01-02"),
			"cycle_stats":    projected,
		})
		return
	}

	// Apply atomically: nothing is half-written, and NO transaction is deleted or
	// moved — only the cycle window changes (§4.4).
	now := time.Now()
	oldEnd := ""
	if cycle.NextPaydayAt != nil {
		oldEnd = toDateOnly(*cycle.NextPaydayAt).Format("2006-01-02")
	}
	err = database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.SalaryCycle{}).Where("id = ?", cycle.ID).
			Updates(map[string]any{"next_payday_at": newDate, "updated_at": now}).Error; err != nil {
			return err
		}
		return writeCycleAudit(tx, uid, cycle.ID, "next_payday_at", oldEnd, newDate.Format("2006-01-02"), now)
	})
	if err != nil {
		log.Printf("patch cycle payday: apply user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update next payday"})
		return
	}
	InvalidateCycleCache(uid)

	if err := database.DB.Model(&models.User{}).Where("id = ?", uid).
		Update("manual_next_payday", req.NextPayday).Error; err != nil {
		log.Printf("patch cycle payday: profile sync user=%v err=%v", uid, err)
	}

	freshCycle := *cycle
	freshCycle.NextPaydayAt = &newDate
	c.JSON(http.StatusOK, gin.H{
		"message":        "Next payday updated",
		"next_payday_at": newDate.Format("2006-01-02"),
		"cycle_stats":    computeCycleStatsAt(uid, freshCycle, allCycles, k),
	})
}

// ── StopSalaryCycle ────────────────────────────────────────────────────────
// POST /api/salary-cycle/stop
// Soft-stops the currently active salary cycle (e.g. job loss). The cycle row,
// its transactions, and the savings-pool history are ALL preserved — only the
// active state flips (StoppedAt is set), so the user falls back to the no-salary
// monthly budget and can start a fresh cycle later. No-op when nothing is active.
func StopSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	cycles, err := loadUserCycles(uid)
	if err != nil {
		log.Printf("stop cycle: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycles"})
		return
	}

	active := requestClock(c, uid).currentCycle(cycles) // never a stopped cycle
	if active == nil {
		// Idempotent: nothing to stop.
		c.JSON(http.StatusOK, gin.H{
			"message": "No active salary cycle to stop", "stopped": false, "has_active_cycle": false,
		})
		return
	}

	now := time.Now()
	if err := database.DB.Model(active).Update("stopped_at", now).Error; err != nil {
		log.Printf("stop cycle: update user=%v cycle=%v err=%v", uid, active.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to stop cycle"})
		return
	}
	InvalidateCycleCache(uid)
	log.Printf("stop cycle: user=%v stopped cycle id=%v (start=%v)",
		uid, active.ID, active.CycleStartAt.Format(time.RFC3339))

	c.JSON(http.StatusOK, gin.H{
		"message": "Salary cycle stopped", "stopped": true,
		"cycle_id": active.ID, "has_active_cycle": false,
	})
}

// cycleHasLiveIncome reports whether a cycle still has at least one live
// (non-deleted) income transaction in its window. A cycle whose data was removed
// via "delete from history" (its Salary income is soft-deleted) fails this, so
// it is treated as gone and must NOT be offered for resume — resuming it would
// revive an empty/inconsistent cycle (income €0 but €X of cycle info).
func cycleHasLiveIncome(uid uint, cycle models.SalaryCycle, all []models.SalaryCycle, k cycleClock) bool {
	for _, t := range loadWindowTransactions(uid, k.window(cycle, all), k) {
		if t.Type == "income" {
			return true
		}
	}
	return false
}

// findResumableCycle returns the most-recently-started STOPPED cycle that could
// be reactivated — now is within its own planned dates, it was never handed
// over, and its data is intact (not deleted from history) — or nil.
func findResumableCycle(uid uint, cycles []models.SalaryCycle, k cycleClock) *models.SalaryCycle {
	var target *models.SalaryCycle
	for i := range cycles {
		c := &cycles[i]
		if c.StoppedAt == nil || !k.withinPlannedDates(*c) {
			continue
		}
		if !cycleHasLiveIncome(uid, *c, cycles, k) {
			continue // deleted / emptied — nothing to restore
		}
		if target == nil || c.CycleStartAt.After(target.CycleStartAt) {
			target = c
		}
	}
	return target
}

// ── ResumeSalaryCycle ──────────────────────────────────────────────────────
// POST /api/salary-cycle/resume
// Reactivates a soft-stopped cycle by clearing StoppedAt. Non-destructive: the
// stop preserved all data, so nothing is recreated or moved. Allowed only when
// today is within the cycle's own window AND no other cycle is currently active
// (the one-active-cycle invariant). Idempotent.
func ResumeSalaryCycle(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	cycles, err := loadUserCycles(uid)
	if err != nil {
		log.Printf("resume cycle: user=%v err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cycles"})
		return
	}

	k := requestClock(c, uid)
	activeNow := k.currentCycle(cycles) // any (non-stopped) cycle current now?
	target := findResumableCycle(uid, cycles, k)

	if activeNow != nil {
		// Already active and nothing stopped to resume → idempotent no-op.
		if target == nil {
			c.JSON(http.StatusOK, gin.H{
				"message": "A cycle is already active", "resumed": true,
				"cycle_id": activeNow.ID, "has_active_cycle": true,
			})
			return
		}
		// A stopped cycle is resumable, but another cycle is active → block
		// (never two active cycles / no overlap).
		c.JSON(http.StatusConflict, gin.H{
			"error": "Stop the current cycle first", "code": "ANOTHER_CYCLE_ACTIVE",
			"resumed": false, "has_active_cycle": true,
		})
		return
	}

	if target == nil {
		// Nothing to resume (no stopped cycle whose window still covers today).
		c.JSON(http.StatusOK, gin.H{
			"message": "No resumable cycle", "resumed": false, "has_active_cycle": false,
		})
		return
	}

	if err := database.DB.Model(target).
		Updates(map[string]any{"stopped_at": nil, "updated_at": time.Now()}).Error; err != nil {
		log.Printf("resume cycle: update user=%v cycle=%v err=%v", uid, target.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resume cycle"})
		return
	}
	InvalidateCycleCache(uid)
	log.Printf("resume cycle: user=%v resumed cycle id=%v (start=%v)",
		uid, target.ID, target.CycleStartAt.Format(time.RFC3339))

	c.JSON(http.StatusOK, gin.H{
		"message": "Salary cycle resumed", "resumed": true,
		"cycle_id": target.ID, "has_active_cycle": true,
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

	k := requestClock(c, uid)
	cycle := findActiveCycle(uid, k)
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
			incomeCat = models.Category{UserID: uid, Name: "Income", TranslationKey: "category.income"}
			if err3 := database.DB.Create(&incomeCat).Error; err3 != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to find income category"})
				return
			}
		}
	}

	now := time.Now()
	txDate := k.today() // the user's local day, not the server's UTC day
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
	InvalidateCycleCache(uid)
	ScheduleBrainResync(uid)

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

	k := requestClock(c, uid)
	cycle := findActiveCycle(uid, k)
	if cycle == nil {
		c.JSON(http.StatusOK, gin.H{"transactions": []any{}, "balance": 0.0, "savings_category_id": 0})
		return
	}
	ensureSavingsCategory(uid, cycle)
	if cycle.SavedMoneyCategoryID == 0 {
		c.JSON(http.StatusOK, gin.H{"transactions": []any{}, "balance": 0.0, "savings_category_id": 0})
		return
	}

	var txs []models.Transaction
	database.DB.Preload("Category").
		Where("user_id = ? AND category_id = ?", uid, cycle.SavedMoneyCategoryID).
		Order("created_at DESC").
		Find(&txs)

	c.JSON(http.StatusOK, gin.H{
		"transactions":        txs,
		"balance":             savingsPoolNet(txs),
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

	// Undo the handover to the deleted cycle: its predecessor is no longer
	// ended by it, so it becomes current again (payday passed) instead of
	// leaving a gap. Only the recorded end instant changes; dates stay intact.
	if err := database.DB.Model(&models.SalaryCycle{}).
		Where("user_id = ? AND ended_at = ?", uid, cycle.CycleStartAt).
		Update("ended_at", nil).Error; err != nil {
		log.Printf("delete cycle: reopen predecessor user=%v err=%v", uid, err)
	}

	InvalidateCycleCache(uid)

	log.Printf("delete cycle: user=%v deleted cycle id=%v (start=%v)",
		uid, cycleID, cycle.CycleStartAt.Format("2006-01-02"))
	c.JSON(http.StatusOK, gin.H{"message": "Cycle deleted", "id": cycleID})
}

// ── helpers ───────────────────────────────────────────────────────────────────

// ensureSavingsCategory guarantees that cycle.SavedMoneyCategoryID is non-zero.
// If the cycle row already has the value set this is a no-op (fast path).
// Otherwise it finds or creates the savings category and persists the ID back
// to the cycle row — a self-healing operation for old or migrated cycles.
// Returns true if the cycle is usable (category is set after the call).
func ensureSavingsCategory(uid uint, cycle *models.SalaryCycle) bool {
	if cycle.SavedMoneyCategoryID > 0 {
		return true
	}
	var savedCat models.Category
	for _, name := range savedMoneyCatByLang {
		if database.DB.Where("user_id = ? AND name = ?", uid, name).First(&savedCat).Error == nil {
			break
		}
	}
	if savedCat.ID == 0 {
		savedCat = models.Category{
			UserID: uid, Name: "Saved Money", TranslationKey: "category.saved_money",
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		}
		if err := database.DB.Create(&savedCat).Error; err != nil {
			log.Printf("ensureSavingsCategory: create cat user=%v err=%v", uid, err)
			return false
		}
	}
	if err := database.DB.Model(cycle).Update("saved_money_category_id", savedCat.ID).Error; err != nil {
		log.Printf("ensureSavingsCategory: update cycle user=%v err=%v", uid, err)
		return false
	}
	cycle.SavedMoneyCategoryID = savedCat.ID
	return true
}

func normalizeLang(raw string) string {
	lang := strings.ToLower(strings.SplitN(strings.TrimSpace(raw), "-", 2)[0])
	if _, ok := fixedCatByLang[lang]; !ok {
		lang = "en"
	}
	return lang
}

// toDateOnly normalises a stored date-only value (YYYY-MM-DD persisted as UTC
// midnight) to exactly that UTC midnight. Only for date-only values — instants
// are mapped to the user's local day with cycleClock.storedDate.
func toDateOnly(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// findActiveCycle returns the current salary cycle, falling back to the most
// recently started cycle when none is current. nil when the user has no cycles.
func findActiveCycle(uid uint, k cycleClock) *models.SalaryCycle {
	cycles, err := loadUserCycles(uid)
	if err != nil {
		return nil
	}
	cycle, _ := k.currentOrLatest(cycles)
	return cycle
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
		Amount      float64 `json:"amount"`
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

	k := requestClock(c, uid)
	cycle := findActiveCycle(uid, k)
	if cycle == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "No active salary cycle found"})
		return
	}
	if !ensureSavingsCategory(uid, cycle) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to configure savings category"})
		return
	}

	txType := "savings_deposit"
	txAmount := req.Amount
	if txAmount < 0 {
		txType = "savings_withdrawal"
		txAmount = -txAmount
	}

	now := time.Now()
	txDate := k.today() // the user's local day, not the server's UTC day
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
	InvalidateCycleCache(uid)
	ScheduleBrainResync(uid)

	stats := computeCycleStats(uid, *cycle)
	c.JSON(http.StatusCreated, gin.H{"transaction": newTx, "cycle_stats": stats})
}
