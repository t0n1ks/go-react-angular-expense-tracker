import { describe, it, expect } from 'vitest';
import {
  evaluatePace,
  resolvePaceWindow,
  type BudgetPaceWindow,
  type CycleStatsWindow,
} from './paceVerdict';

describe('evaluatePace', () => {
  it('returns no verdict when there is no allowance', () => {
    const v = evaluatePace(0, 20, 3, 4);
    expect(v.tier).toBeNull();
  });

  it('is neutral on a fresh week (zero elapsed) with no scary percentage', () => {
    const v = evaluatePace(76.78, 0, 0, 7);
    expect(v.tier).toBe('pacing_fresh');
    expect(v.percentOver).toBe(0);
  });

  it('REGRESSION: under budget never reads as over', () => {
    // The exact screenshot scenario: allowance €76.78, spent €36.58, midweek.
    const v = evaluatePace(76.78, 36.58, 3, 4);
    expect(v.tier).not.toBe('pacing_over');
    expect(v.percentOver).toBe(0);
    expect(v.pctUsed).toBe(48); // 47.6% → 48
  });

  it('invites a treat late in the week when well under', () => {
    const v = evaluatePace(100, 10, 5, 2);
    expect(v.tier).toBe('pacing_great');
    expect(v.percentOver).toBe(0);
  });

  it('is great when remarkably lean past midweek', () => {
    expect(evaluatePace(100, 15, 4, 3).tier).toBe('pacing_great');
  });

  it('is good on an even pace', () => {
    expect(evaluatePace(100, 50, 4, 3).tier).toBe('pacing_good');
  });

  it('gently warns when ahead of pace but still under budget (no over %)', () => {
    const v = evaluatePace(100, 45, 2, 5);
    expect(v.tier).toBe('pacing_warn');
    expect(v.percentOver).toBe(0);
  });

  it('is an honest over-budget warning with the TRUE overage', () => {
    const v = evaluatePace(100, 133, 4, 3);
    expect(v.tier).toBe('pacing_over');
    expect(v.pctUsed).toBe(133);
    expect(v.percentOver).toBe(33);
  });

  it('never emits a positive percentOver while at or under the allowance', () => {
    for (const spent of [0, 10, 50, 99.9, 100]) {
      expect(evaluatePace(100, spent, 4, 3).percentOver).toBe(0);
    }
    expect(evaluatePace(100, 120, 4, 3).percentOver).toBe(20);
  });
});

// ── Window resolution: cycle vs. no-cycle users ──────────────────────────────

const cycleStats = (over: Partial<CycleStatsWindow> = {}): CycleStatsWindow => ({
  current_week_allowance: 100,
  current_week_spent: 40,
  current_week_index: 0,
  days_elapsed: 3,
  days_remaining: 25,
  ...over,
});

const budgetWindow = (over: Partial<BudgetPaceWindow> = {}): BudgetPaceWindow => ({
  has_goal: true,
  current_week_allowance: 100,
  current_week_spent: 40,
  days_elapsed_in_week: 3,
  days_remaining_in_week: 4,
  ...over,
});

describe('resolvePaceWindow', () => {
  it('uses the server budget window for no-cycle (monthly-goal) users', () => {
    const w = resolvePaceWindow(false, null, budgetWindow({ current_week_allowance: 76.78, current_week_spent: 36.58 }));
    expect(w).toEqual({ allowance: 76.78, spent: 36.58, elapsedInWeek: 3, remainingInWeek: 4 });
  });

  it('uses cycle stats for cycle users, deriving the day position from the cycle week', () => {
    const w = resolvePaceWindow(true, cycleStats({ current_week_index: 1, days_elapsed: 10 }), null);
    expect(w).toEqual({ allowance: 100, spent: 40, elapsedInWeek: 3, remainingInWeek: 4 });
  });

  it('caps the cycle week when the cycle ends first', () => {
    const w = resolvePaceWindow(true, cycleStats({ days_elapsed: 3, days_remaining: 1 }), null);
    expect(w!.remainingInWeek).toBe(1);
  });

  it('returns null with no goal — never a baseless percentage', () => {
    expect(resolvePaceWindow(false, null, budgetWindow({ has_goal: false, current_week_allowance: 0 }))).toBeNull();
  });

  it('returns null when the monthly budget is fully spent (zero allowance)', () => {
    expect(resolvePaceWindow(false, null, budgetWindow({ current_week_allowance: 0 }))).toBeNull();
  });

  it('returns null when the user has neither a cycle nor a budget window', () => {
    expect(resolvePaceWindow(false, null, null)).toBeNull();
  });

  it('prefers the active cycle when both windows are present', () => {
    const w = resolvePaceWindow(true, cycleStats({ current_week_allowance: 250 }), budgetWindow());
    expect(w!.allowance).toBe(250);
  });
});

describe('cycle / no-cycle parity', () => {
  it('gives the same verdict for equivalent spent, allowance and days', () => {
    const cases: Array<[number, number, number, number]> = [
      [76.78, 36.58, 3, 4],
      [100, 133, 4, 3],
      [250, 0, 0, 7],
      [250, 20, 5, 2],
    ];
    for (const [allowance, spent, elapsed, remaining] of cases) {
      const fromCycle = resolvePaceWindow(true, cycleStats({
        current_week_allowance: allowance,
        current_week_spent: spent,
        days_elapsed: elapsed,
        days_remaining: remaining,
      }), null)!;
      const fromWindow = resolvePaceWindow(false, null, budgetWindow({
        current_week_allowance: allowance,
        current_week_spent: spent,
        days_elapsed_in_week: elapsed,
        days_remaining_in_week: remaining,
      }))!;
      expect(fromCycle).toEqual(fromWindow);
      expect(evaluatePace(fromCycle.allowance, fromCycle.spent, fromCycle.elapsedInWeek, fromCycle.remainingInWeek))
        .toEqual(evaluatePace(fromWindow.allowance, fromWindow.spent, fromWindow.elapsedInWeek, fromWindow.remainingInWeek));
    }
  });

  it('regression: a no-cycle user under budget is never told they are over', () => {
    // The screenshot scenario, no-cycle flavour: €76.78 allowance, €36.58 spent.
    const w = resolvePaceWindow(false, null, budgetWindow({ current_week_allowance: 76.78, current_week_spent: 36.58 }))!;
    const v = evaluatePace(w.allowance, w.spent, w.elapsedInWeek, w.remainingInWeek);
    expect(v.tier).not.toBe('pacing_over');
    expect(v.percentOver).toBe(0);
    expect(v.pctUsed).toBe(48);
  });

  it('regression: no-cycle percentOver stays 0 across the whole under-budget range', () => {
    for (const spent of [0, 10, 50, 99.9, 100]) {
      const w = resolvePaceWindow(false, null, budgetWindow({ current_week_spent: spent }))!;
      expect(evaluatePace(w.allowance, w.spent, w.elapsedInWeek, w.remainingInWeek).percentOver).toBe(0);
    }
  });

  it('no-cycle tier boundaries match the Python advisor', () => {
    const expectTier = (spent: number, elapsed: number, remaining: number) => {
      const w = resolvePaceWindow(false, null, budgetWindow({
        current_week_spent: spent, days_elapsed_in_week: elapsed, days_remaining_in_week: remaining,
      }))!;
      return evaluatePace(w.allowance, w.spent, w.elapsedInWeek, w.remainingInWeek).tier;
    };
    expect(expectTier(0, 0, 7)).toBe('pacing_fresh');
    expect(expectTier(0, 3, 4)).toBe('pacing_fresh');
    expect(expectTier(50, 4, 3)).toBe('pacing_good');
    expect(expectTier(45, 2, 5)).toBe('pacing_warn');
    expect(expectTier(10, 5, 2)).toBe('pacing_great');
    expect(expectTier(120, 4, 3)).toBe('pacing_over');
  });
});
