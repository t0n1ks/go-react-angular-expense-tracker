import { describe, it, expect } from 'vitest';
import { computeLegacyWeeklyAllowance, clampCanSpend } from './budgetMath';

// The formula the old code used, kept here so the regression is explicit.
const buggyOldFormula = (monthlyBudget: number, spent: number, daysRemaining: number) =>
  Math.max(0, (monthlyBudget - spent) / (Math.max(1, daysRemaining) / 7));

describe('computeLegacyWeeklyAllowance (Bug A regression)', () => {
  it('does NOT run away as payday approaches (the reported €400→€1 900 bug)', () => {
    const monthlyBudget = 400;
    const spent = 139.98;
    const daysRemaining = 1; // payday tomorrow

    const old = buggyOldFormula(monthlyBudget, spent, daysRemaining);
    expect(old).toBeCloseTo(1820.14, 1); // the old formula really did ~7× the remainder

    const fixed = computeLegacyWeeklyAllowance({ monthlyBudget, spentSincePayday: spent, daysRemaining });
    // Never more than what is actually left in the budget.
    expect(fixed).toBeLessThanOrEqual(monthlyBudget - spent + 1e-9);
    expect(fixed).toBeCloseTo(260.02, 2);
    expect(fixed).toBeLessThan(old);
  });

  it('never exceeds the remaining budget for any days-remaining value', () => {
    const monthlyBudget = 400;
    const spent = 139.98;
    const remaining = monthlyBudget - spent;
    for (let d = 1; d <= 60; d++) {
      const a = computeLegacyWeeklyAllowance({ monthlyBudget, spentSincePayday: spent, daysRemaining: d });
      expect(a).toBeLessThanOrEqual(remaining + 1e-9);
      expect(a).toBeGreaterThanOrEqual(0);
    }
  });

  it('grants a fair one-week share for a full-length month', () => {
    // 30 days left, nothing spent → about 7/30 of the budget this week.
    const a = computeLegacyWeeklyAllowance({ monthlyBudget: 300, spentSincePayday: 0, daysRemaining: 30 });
    expect(a).toBeCloseTo((300 / 30) * 7, 6);
  });

  it('for a 7-day (or shorter) window the week share is the whole remainder', () => {
    expect(computeLegacyWeeklyAllowance({ monthlyBudget: 300, spentSincePayday: 0, daysRemaining: 7 }))
      .toBeCloseTo(300, 6);
    expect(computeLegacyWeeklyAllowance({ monthlyBudget: 300, spentSincePayday: 50, daysRemaining: 3 }))
      .toBeCloseTo(250, 6);
  });

  it('returns 0 when the budget is already exhausted', () => {
    expect(computeLegacyWeeklyAllowance({ monthlyBudget: 100, spentSincePayday: 120, daysRemaining: 5 })).toBe(0);
  });
});

describe('clampCanSpend (guardrail against a stale inflated lock)', () => {
  it('clamps a persisted inflated allowance down to the remaining budget', () => {
    // A stale localStorage lock could hold 1 900 from the old bug.
    expect(clampCanSpend(1900, 400, 139.98)).toBeCloseTo(260.02, 2);
  });
  it('passes through a value already within budget', () => {
    expect(clampCanSpend(100, 400, 139.98)).toBe(100);
  });
  it('never returns a negative', () => {
    expect(clampCanSpend(50, 100, 120)).toBe(0);
  });
});
