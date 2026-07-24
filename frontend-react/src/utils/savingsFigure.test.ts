import { describe, it, expect } from 'vitest';
import { savingsPoolBalance } from './savingsFigure';

// The UFO advisor's savings figure must match the app's savings-pool balance
// ("Накопленный баланс" = cycleStats.saved_money_balance), not the AI service's
// projected predicted_savings_balance (which drifts as spending changes).
describe('savingsPoolBalance (advisor ↔ app agreement)', () => {
  it('reports the pool balance the app displays, not the forecast', () => {
    // App shows 350 (saved_money_balance); the forecast was 387/368.
    const cycleStats = { saved_money_balance: 350, predicted_savings_balance: 387 } as {
      saved_money_balance: number; predicted_savings_balance: number;
    };
    expect(savingsPoolBalance(cycleStats)).toBe(350);
    expect(savingsPoolBalance(cycleStats)).not.toBe(387);
  });

  it('is undefined without a cycle, so no savings tip fires', () => {
    expect(savingsPoolBalance(null)).toBeUndefined();
    expect(savingsPoolBalance(undefined)).toBeUndefined();
    expect(savingsPoolBalance({})).toBeUndefined();
    expect(savingsPoolBalance({ saved_money_balance: null })).toBeUndefined();
  });

  it('passes a zero balance through (a real, if empty, pool value)', () => {
    expect(savingsPoolBalance({ saved_money_balance: 0 })).toBe(0);
  });
});
