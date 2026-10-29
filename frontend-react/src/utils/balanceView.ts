// The three views of the balance chart — Общий / Бюджет / Копилка — each one
// line read straight from the server's real-money timeline (GET
// /api/balance/timeline). No money is computed here: "total" is the server's
// own per-day sum (spendable + savings = money on hand), never an all-time
// income − expenses sum.

import type { MoneyPoint } from './balanceTimeline';

export type BalanceView = 'total' | 'budget' | 'savings';

export const BALANCE_VIEWS: readonly BalanceView[] = ['total', 'budget', 'savings'];

/** The day's value in a view. */
export function viewValue(p: MoneyPoint, view: BalanceView): number {
  switch (view) {
    case 'budget':
      return p.spendable;
    case 'savings':
      return p.savings;
    default:
      return p.total;
  }
}

/** One view's line: { date, value } per day. */
export function seriesFor(points: MoneyPoint[], view: BalanceView): { date: string; value: number }[] {
  return points.map((p) => ({ date: p.date, value: viewValue(p, view) }));
}

/** DOM id of a view's tab (the chart panel is labelled by it). */
export const balanceTabId = (view: BalanceView): string => `balance-tab-${view}`;

/** i18n key of a view's label (tabs, "today" header, aria). */
export const viewLabelKey = (view: BalanceView): string => `statistics.balance_view_${view}`;

// ── Remembered tab (per viewer, this browser only) ───────────────────────────

const STORAGE_KEY = 'finguard.balanceView';

export function loadBalanceView(): BalanceView {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && (BALANCE_VIEWS as readonly string[]).includes(v)) return v as BalanceView;
  } catch {
    // storage unavailable (private mode, blocked) — fall back to the default
  }
  return 'total';
}

export function saveBalanceView(view: BalanceView): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // not remembered — harmless
  }
}
