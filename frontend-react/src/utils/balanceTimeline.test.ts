import { describe, it, expect } from 'vitest';
import { cashFlowSeries, withinPeriod } from './balanceTimeline';
import { savingsDepositError } from './savingsDepositError';
import type { TFunction } from 'i18next';

describe('cashFlowSeries (no-cycle users, unchanged behaviour)', () => {
  it('accumulates income − expense per day and ignores savings transfers', () => {
    const pts = cashFlowSeries([
      { type: 'income', amount: 100, date: '2026-10-01', created_at: '2026-10-01T08:00:00Z' },
      { type: 'expense', amount: 30, date: '2026-10-01', created_at: '2026-10-01T09:00:00Z' },
      { type: 'savings_deposit', amount: 50, date: '2026-10-02' },
      { type: 'savings_withdrawal', amount: 20, date: '2026-10-02' },
      { type: 'expense', amount: 5.5, date: '2026-10-03' },
    ]);
    expect(pts).toEqual([
      { date: '2026-10-01', balance: 70 },
      { date: '2026-10-03', balance: 64.5 },
    ]);
  });
});

describe('withinPeriod', () => {
  const pts = [
    { date: '2026-07-01', balance: 1 },
    { date: '2026-10-20', balance: 2 },
    { date: '2026-10-29', balance: 3 },
  ];
  const now = new Date(2026, 9, 29, 12);

  it('keeps everything for all-time', () => {
    expect(withinPeriod(pts, 0, now)).toHaveLength(3);
  });

  it('slices by local date, keeping each point’s own balance', () => {
    expect(withinPeriod(pts, 30, now)).toEqual(pts.slice(1));
  });
});

describe('savingsDepositError', () => {
  const t = ((key: string, opts?: { amount?: string }) =>
    opts?.amount ? `${key}:${opts.amount}` : key) as unknown as TFunction;
  const fmt = (n: number) => `€${n.toFixed(2)}`;
  const err = (data: object) => ({ response: { data } });

  it('names the most that fits when the deposit exceeds the budget', () => {
    expect(savingsDepositError(err({ code: 'DEPOSIT_EXCEEDS_SPENDABLE', available: 11.84 }), t, fmt))
      .toBe('dashboard.savings_deposit_exceeds:€11.84');
  });

  it('explains that deposits need a current cycle', () => {
    expect(savingsDepositError(err({ code: 'DEPOSIT_OUTSIDE_CYCLE' }), t, fmt)).toBe('dashboard.savings_deposit_no_cycle');
  });

  it('leaves other errors to the caller', () => {
    expect(savingsDepositError(new Error('network'), t, fmt)).toBeNull();
  });
});

describe('withinPeriod on the two-line series', () => {
  it('keeps both components of each day together', () => {
    const pts = [
      { date: '2026-07-01', spendable: 404, savings: 100 },
      { date: '2026-10-29', spendable: 11.84, savings: 0 },
    ];
    expect(withinPeriod(pts, 30, new Date(2026, 9, 29, 12))).toEqual([pts[1]]);
  });
});
