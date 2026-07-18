// Pure budget-math helpers for the legacy (no active SalaryCycle) pacing path.
//
// The SalaryCycle path is server-authoritative (computeCycleStats in the Go
// backend) and already hard-caps its rolling weekly allowance. These helpers
// exist ONLY for users without a cycle, and their job is to guarantee the same
// invariant the server enforces: "can spend this week" can never exceed the
// budget actually left in the period.

export interface LegacyWeeklyAllowanceInput {
  /** The period budget (monthly discretionary limit). */
  monthlyBudget: number;
  /** Variable expenses already spent since the last payday. */
  spentSincePayday: number;
  /** Whole days remaining until the next payday (>= 1). */
  daysRemaining: number;
}

/**
 * Legacy weekly spending allowance.
 *
 * Spreads the REMAINING budget evenly across the REMAINING days, then grants at
 * most one week's fair share — and never more than the entire remaining budget.
 *
 * This replaces the previous formula
 *     (monthlyBudget - spent) / (daysRemaining / 7)
 * which DIVIDED by a shrinking fraction of a week and therefore MULTIPLIED the
 * remaining budget by up to 7× as payday approached (daysRemaining → 1 ⇒
 * ÷(1/7) ⇒ ×7), producing runaway "can spend" figures (e.g. €1 820 on a €400
 * limit). Here the result is monotonically bounded by the remaining budget.
 */
export function computeLegacyWeeklyAllowance(input: LegacyWeeklyAllowanceInput): number {
  const remainingBudget = Math.max(0, input.monthlyBudget - input.spentSincePayday);
  const days = Math.max(1, input.daysRemaining);
  const dailyPace = remainingBudget / days;
  const oneWeekShare = dailyPace * 7;
  // At most one week's even-pace share, and never more than what's actually left.
  return Math.min(oneWeekShare, remainingBudget);
}

/**
 * Hard guardrail applied to any displayed "can spend" value — including a value
 * restored from a persisted weekly lock. It can never exceed the budget still
 * remaining in the period, and is never negative.
 */
export function clampCanSpend(
  canSpend: number,
  monthlyBudget: number,
  spentSincePayday: number,
): number {
  const remainingBudget = Math.max(0, monthlyBudget - spentSincePayday);
  return Math.max(0, Math.min(canSpend, remainingBudget));
}
