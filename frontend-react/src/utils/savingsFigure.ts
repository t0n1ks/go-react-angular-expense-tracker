// Single source for the "savings pool" figure the UFO advisor reports.
//
// The advisor's "в копилке / saved" number must be the SAME savings-pool balance
// the app shows as "Накопленный баланс" (Statistics' sfAccumulated, i.e.
// cycleStats.saved_money_balance) — NOT the AI service's projected
// predicted_savings_balance, which is a forecast (pool + projected accumulation)
// and drifts as spending changes. Reading the pool balance keeps the advisor and
// the app in agreement.

export interface SavingsPoolSource {
  saved_money_balance?: number | null;
}

/** The real accumulated savings-pool balance, or undefined when there's no cycle. */
export function savingsPoolBalance(
  cycleStats: SavingsPoolSource | null | undefined,
): number | undefined {
  const v = cycleStats?.saved_money_balance;
  return typeof v === 'number' ? v : undefined;
}
