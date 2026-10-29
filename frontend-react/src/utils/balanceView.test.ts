import { describe, it, expect } from 'vitest';
import { seriesFor, viewValue, BALANCE_VIEWS, BALANCE_CURVE, loadBalanceView, selectedIndex, formatDay } from './balanceView';
import { withinPeriod, type MoneyPoint } from './balanceTimeline';

// Points exactly as the server sends them: total is the server's own
// spendable + savings for the day (money on hand).
const points: MoneyPoint[] = [
  { date: '2026-09-28', spendable: 404, savings: 100, total: 504 },
  { date: '2026-10-27', spendable: -12.5, savings: 54, total: 41.5 }, // overspent budget
  { date: '2026-10-28', spendable: 798, savings: 154, total: 952 }, // payday jump
  { date: '2026-10-29', spendable: 11.84, savings: 0, total: 11.84 },
];

describe('balance views', () => {
  it('each view is one line straight from the server data', () => {
    expect(seriesFor(points, 'budget').map((p) => p.value)).toEqual([404, -12.5, 798, 11.84]);
    expect(seriesFor(points, 'savings').map((p) => p.value)).toEqual([100, 54, 154, 0]);
    expect(seriesFor(points, 'total').map((p) => p.value)).toEqual([504, 41.5, 952, 11.84]);
  });

  it('Общий = Бюджет + Копилка at every point (reconciliation)', () => {
    for (const p of points) {
      expect(viewValue(p, 'total')).toBeCloseTo(viewValue(p, 'budget') + viewValue(p, 'savings'), 10);
    }
  });

  it('the latest point of each view is today’s figure', () => {
    const last = points[points.length - 1];
    expect(BALANCE_VIEWS.map((v) => viewValue(last, v))).toEqual([11.84, 11.84, 0]);
  });

  it('the period filter applies to every view alike', () => {
    for (const v of BALANCE_VIEWS) {
      const sliced = withinPeriod(seriesFor(points, v), 2, new Date(2026, 9, 29, 12));
      expect(sliced.map((p) => p.date)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    }
  });

  it('draws every view as a smooth, non-overshooting curve (no steps)', () => {
    expect(BALANCE_CURVE).toBe('monotone');
  });

  it('defaults to "total" when nothing is remembered or storage is unavailable', () => {
    expect(loadBalanceView()).toBe('total');
  });
});

describe('selected day', () => {
  const dates = ['2026-10-27', '2026-10-28', '2026-10-29'];

  it('defaults to the latest day', () => {
    expect(selectedIndex(dates, null)).toBe(2);
  });

  it('keeps the picked day (also across a tab switch — same dates)', () => {
    expect(selectedIndex(dates, '2026-10-28')).toBe(1);
  });

  it('falls back to the latest day when the pick leaves the visible range', () => {
    expect(selectedIndex(dates, '2026-07-01')).toBe(2);
  });

  it('is -1 for an empty series', () => {
    expect(selectedIndex([], null)).toBe(-1);
  });

  it('formats the day in the user\u2019s locale', () => {
    expect(formatDay('2026-10-29', 'en-GB')).toBe('29 Oct 2026');
  });
});
