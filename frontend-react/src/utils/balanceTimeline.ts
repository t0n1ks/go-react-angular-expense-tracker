// Series for the "Balance dynamics" chart.
//
// Users with a salary cycle get the server's REAL-MONEY series
// (GET /api/balance/timeline: cycle spendable remainder + savings pool per
// day, from the first cycle; the latest point is today's money on hand). The
// client never re-derives it. Users who never had a cycle keep the plain
// cash-flow series built here (unchanged behaviour).

import { toLocalDateStr } from './localDate';

export interface TimelinePoint {
  date: string; // YYYY-MM-DD
  balance: number;
}

interface CashFlowTx {
  type: string;
  amount: number;
  date: string;
  created_at?: string;
}

/**
 * Cumulative income − expense per day, across ALL history (no-cycle users).
 * Savings-pool transfers are internal movements and are excluded.
 */
export function cashFlowSeries(transactions: CashFlowTx[]): TimelinePoint[] {
  const events = transactions.filter((t) => t.type === 'income' || t.type === 'expense');
  // Bucket by created_at's day (the event time), falling back to date.
  const keyOf = (t: CashFlowTx) => (t.created_at ?? t.date).slice(0, 10);
  const sorted = [...events].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

  const daily = new Map<string, number>();
  let running = 0;
  sorted.forEach((tx) => {
    running += tx.type === 'income' ? Number(tx.amount) : -Number(tx.amount);
    daily.set(keyOf(tx), running); // last write wins → end-of-day balance
  });
  return Array.from(daily, ([date, balance]) => ({ date, balance }));
}

/**
 * Keeps the points inside the selected period (0 = all time). Sliced AFTER
 * the series is built, so the first visible point keeps its true balance.
 */
export function withinPeriod(points: TimelinePoint[], periodDays: number, now = new Date()): TimelinePoint[] {
  if (periodDays <= 0) return points;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffKey = toLocalDateStr(cutoff);
  return points.filter((p) => p.date >= cutoffKey);
}
