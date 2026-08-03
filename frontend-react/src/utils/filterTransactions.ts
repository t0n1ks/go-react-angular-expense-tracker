/**
 * Client-side search/filter for the transaction history.
 *
 * The history view loads every transaction up front (`GET /transactions` is not
 * paginated), so filtering is a pure function over the in-memory list — no
 * extra network round-trips, and results appear as the user types.
 */

/** How the date control is being used. */
export type DateMode = 'day' | 'range';

export interface TransactionFilters {
  /** Free text; matched against description + resolved category label. */
  query: string;
  /** Category id as a string ('' = any category). */
  categoryId: string;
  dateMode: DateMode;
  /** 'YYYY-MM-DD'. In 'day' mode this is the single selected day. */
  dateFrom: string;
  /** 'YYYY-MM-DD'. Ignored in 'day' mode. */
  dateTo: string;
}

export const EMPTY_FILTERS: TransactionFilters = {
  query: '',
  categoryId: '',
  dateMode: 'day',
  dateFrom: '',
  dateTo: '',
};

/** Minimal shape the filter needs — keeps this decoupled from the page's types. */
export interface FilterableTransaction {
  id: number;
  /** ISO date string; only the calendar-day part is used. */
  date: string;
  description: string;
  category?: { id: number } | null;
}

/**
 * True when at least one filter would narrow the list. Used to decide whether
 * to show the results count, the reset button, and the "nothing found" state
 * (as opposed to the plain "no transactions yet" empty state).
 */
export function hasActiveFilters(f: TransactionFilters): boolean {
  if (f.query.trim() !== '') return true;
  if (f.categoryId !== '') return true;
  if (f.dateFrom !== '') return true;
  // A lone "to" date is a valid open-ended range ("everything up to X").
  if (f.dateMode === 'range' && f.dateTo !== '') return true;
  return false;
}

/** Number of filters currently narrowing the list — drives the mobile badge. */
export function activeFilterCount(f: TransactionFilters): number {
  let n = 0;
  if (f.query.trim() !== '') n += 1;
  if (f.categoryId !== '') n += 1;
  if (f.dateFrom !== '' || (f.dateMode === 'range' && f.dateTo !== '')) n += 1;
  return n;
}

/**
 * Calendar day of a transaction as 'YYYY-MM-DD'.
 *
 * Taken by splitting the ISO string rather than via `new Date()`, so a row
 * stored as '2026-05-01T00:00:00Z' stays May 1st for viewers in every timezone
 * — the same rule groupTransactionsByMonth follows.
 */
function txDay(isoDate: string): string {
  return isoDate.split('T')[0];
}

/**
 * Lowercases for accent/­case-insensitive comparison.
 *
 * `toLowerCase()` is Unicode-aware, so Cyrillic folds correctly ('МОЛОКО' →
 * 'молоко') — the same call that makes Latin and German text match.
 */
function fold(s: string): string {
  return s.toLowerCase().trim();
}

/**
 * Builds a lowercase haystack per transaction: description + category label.
 *
 * The category label must be resolved by the caller (built-in categories are
 * translated, custom ones are not), and it is passed in already-resolved so the
 * search matches whatever the user actually sees on screen — typing "Еда" in
 * Russian finds the built-in Food rows.
 *
 * Built once per (transactions, language) pair and reused across keystrokes.
 */
export function buildSearchIndex<T extends FilterableTransaction>(
  transactions: T[],
  categoryLabelOf: (tx: T) => string,
): Map<number, string> {
  const index = new Map<number, string>();
  for (const tx of transactions) {
    index.set(tx.id, fold(`${tx.description} ${categoryLabelOf(tx)}`));
  }
  return index;
}

/**
 * Applies all three filters with AND semantics. Each is optional: an empty
 * filter is skipped entirely, so any one alone, any two, or all three work.
 *
 * Returns the original array reference when nothing is filtering, which keeps
 * downstream `useMemo`s on the grouped list from recomputing needlessly.
 */
export function filterTransactions<T extends FilterableTransaction>(
  transactions: T[],
  filters: TransactionFilters,
  searchIndex: Map<number, string>,
): T[] {
  if (!hasActiveFilters(filters)) return transactions;

  const needle = fold(filters.query);
  const { categoryId, dateMode, dateFrom, dateTo } = filters;

  // In 'day' mode the range collapses to a single day; in 'range' mode either
  // end may be omitted, giving an open-ended "from X" or "up to Y".
  const from = dateFrom;
  const to = dateMode === 'day' ? dateFrom : dateTo;

  return transactions.filter(tx => {
    if (needle !== '') {
      const haystack = searchIndex.get(tx.id);
      if (haystack === undefined || !haystack.includes(needle)) return false;
    }

    if (categoryId !== '' && String(tx.category?.id ?? '') !== categoryId) {
      return false;
    }

    if (from !== '' || to !== '') {
      // 'YYYY-MM-DD' strings compare correctly with < and >.
      const day = txDay(tx.date);
      if (from !== '' && day < from) return false;
      if (to !== '' && day > to) return false;
    }

    return true;
  });
}
