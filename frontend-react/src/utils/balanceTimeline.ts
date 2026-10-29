// Series for the "Balance dynamics" chart.
//
// Users with a salary cycle get the server's REAL-MONEY series
// (GET /api/balance/timeline: per day, from the first cycle, the cycle's
// spendable remainder, the savings-pool balance and their total — shown one
// view at a time, see balanceView.ts; each line's latest point is today's
// dashboard figure). The client never re-derives it. Users who never had a cycle keep the plain cash-flow series
// built here (unchanged behaviour).

import { toLocalDateStr } from './localDate';

/** One day of the server's real-money series. */
export interface MoneyPoint {
  date: string; // YYYY-MM-DD
  spendable: number; // = cycle_stats.spendable_remaining on the latest day
  savings: number; // = cycle_stats.saved_money_balance on the latest day
  total: number; // = spendable + savings (server-computed) = cycle_stats.money_on_hand
}

/**
 * GET /api/balance/forecast — grounded in the same real-money history: the
 * recency-weighted daily result of completed cycles plus the current cycle's
 * projection. null for users who never had a cycle.
 */
export interface SavingsForecast {
  cycle_result: number; // projected real result of the current cycle
  annual_change: number; // projected change in real money over a year
  money_now: number; // real money on hand now
  in_a_year: number; // money_now + annual_change
  completed_cycles: number;
  rough: boolean; // no completed cycle yet — first-month estimate
}

/**
 * End-of-period budget forecast (the cycle_end block of GET /balance/forecast):
 * budget left at payday (basis "cycle") or at month end against the monthly
 * goal (basis "month"). All math is the server's; the client only renders.
 */
export interface PeriodEndForecast {
  basis: 'cycle' | 'month';
  position: number; // budget left now (the dashboard's figure)
  spent: number; // variable spending so far this period
  days_elapsed: number;
  days_left: number;
  daily_pace: number; // spent ÷ days elapsed (plan-blended in the first 3 days)
  projected_end: number; // position − daily_pace × days_left; negative = deficit
  calibrating: boolean; // first week: the client shows "collecting data", not the projection
}

/** One day of the no-cycle cash-flow series. */
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
export function withinPeriod<T extends { date: string }>(points: T[], periodDays: number, now = new Date()): T[] {
  if (periodDays <= 0) return points;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffKey = toLocalDateStr(cutoff);
  return points.filter((p) => p.date >= cutoffKey);
}
