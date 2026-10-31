// The Transactions list's opt-in "other mode" rows (view-only). Pure, so it
// is unit-tested.
//
// Display only: each month keeps `transactions` = the CURRENT mode's own
// entries — the month's count and totals come from them, exactly as before —
// and gets `rows` = those entries plus the other mode's, slotted in by time
// and marked `cross`. No figure anywhere reads `rows`.

import type { MonthGroup } from './groupTransactionsByMonth';
import { groupTransactionsByMonth } from './groupTransactionsByMonth';

export interface ListRow<T> {
  tx: T;
  /** From the other mode: dimmed, view-only, not counted. */
  cross: boolean;
}

export interface ListGroup<T extends { date: string }> extends MonthGroup<T> {
  rows: ListRow<T>[];
}

/**
 * Month groups for the list. `own` must already be grouped (and filtered);
 * `other` is the other mode's filtered entries, or [] when the opt-in is off —
 * then every group is exactly `own` with rows = its own entries.
 */
export function withCrossModeRows<T extends { date: string }>(
  own: MonthGroup<T>[],
  other: T[],
  compare: (a: T, b: T) => number,
): ListGroup<T>[] {
  const otherByMonth = new Map(groupTransactionsByMonth(other).map(g => [g.key, g.transactions]));
  const result: ListGroup<T>[] = own.map(g => {
    const extra = otherByMonth.get(g.key) ?? [];
    otherByMonth.delete(g.key);
    const rows = [
      ...g.transactions.map(tx => ({ tx, cross: false })),
      ...extra.map(tx => ({ tx, cross: true })),
    ];
    if (extra.length) rows.sort((a, b) => compare(a.tx, b.tx));
    return { ...g, rows };
  });
  // Months with only other-mode entries: no own entries, so nothing counted.
  for (const [key, txs] of otherByMonth) {
    const [y, m] = key.split('-').map(Number);
    result.push({
      key, year: y, month: m - 1, transactions: [],
      rows: [...txs].sort(compare).map(tx => ({ tx, cross: true })),
    });
  }
  return result.sort((a, b) => b.key.localeCompare(a.key));
}
