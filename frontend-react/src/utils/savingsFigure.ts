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

const round2 = (v: number): number => Math.round(v * 100) / 100;

export interface IncomeSplit {
  needsLimit: number;
  wantsLimit: number;
  savingsLimit: number;
}

/**
 * Pre-start PREVIEW mirror of the Go ComputeBudgetFramework split (the server
 * stays authoritative once the cycle exists). The automatic savings allocation
 * is rounded DOWN to whole currency units (€504 × 20% → €100) and the shed cents
 * go to Wants (spendable), so needs + wants + savings still equals the income.
 */
export function splitIncome(
  totalIncome: number, needsPct: number, wantsPct: number, savingsPct: number,
): IncomeSplit {
  const exactSavings = totalIncome > 0 && savingsPct > 0 ? round2(totalIncome * savingsPct / 100) : 0;
  const savingsLimit = Math.floor(exactSavings);
  const remainder = round2(exactSavings - savingsLimit);
  return {
    needsLimit: totalIncome * needsPct / 100,
    wantsLimit: totalIncome * wantsPct / 100 + remainder,
    savingsLimit,
  };
}
