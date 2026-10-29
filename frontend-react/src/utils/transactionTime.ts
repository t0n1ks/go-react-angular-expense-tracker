// Transaction time for the Transactions list: one notion of time, the one the
// cycle boundaries already use (server effective_at, see txEventTime) — never
// a second one, never an invented one.
//
//   - Sort: newest effective time first; same instant → larger amount first
//     (then newest id, so the order is stable).
//   - Shown time: the entry time (created_at) — but only when the entry was
//     made on its own date, i.e. effective_at IS created_at. A backdated entry
//     counts at the start of its date; showing "00:00" would invent a time, so
//     none is shown (the detail view still says when it was added).

import { txEventTime, type TimedTransaction } from './categoryWindow';

export interface SortableTransaction extends TimedTransaction {
  id: number;
  amount: number;
}

/** Comparator: time descending, then amount descending, then id descending. */
export function compareByTimeThenAmount(a: SortableTransaction, b: SortableTransaction): number {
  const ta = txEventTime(a).getTime() || 0;
  const tb = txEventTime(b).getTime() || 0;
  if (tb !== ta) return tb - ta;
  const amountDiff = Number(b.amount) - Number(a.amount);
  if (amountDiff !== 0) return amountDiff;
  return b.id - a.id;
}

/** The real entry time to display, or null when only the date is known. */
export function entryTime(tx: TimedTransaction): Date | null {
  if (!tx.created_at || !tx.effective_at) return null;
  const created = new Date(tx.created_at);
  const effective = new Date(tx.effective_at);
  if (isNaN(created.getTime()) || created.getTime() !== effective.getTime()) return null;
  return created;
}

/** Short local time, e.g. "14:05" / "2:05 PM". */
export function formatEntryTime(d: Date, locale?: string): string {
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The stored calendar date (YYYY-MM-DD…) formatted as a local date, without
 * the UTC-midnight parse that shows the previous day west of UTC.
 */
export function formatTxDate(date: string, locale?: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale);
}
