export interface MonthGroup<T extends { date: string }> {
  /** "YYYY-MM" — lexicographically sortable */
  key: string;
  year: number;
  /** 0-indexed (Jan = 0) — matches the Date constructor */
  month: number;
  transactions: T[];
}

/**
 * Groups a flat list by calendar month.
 *
 * Timezone-safe: dates are parsed by splitting the ISO string on "T", so a
 * transaction stored as "2026-05-01T00:00:00Z" is always treated as May
 * regardless of the viewer's UTC offset (avoids the classic +/-1-day shift
 * that `new Date(isoString).getMonth()` produces for users east/west of UTC).
 *
 * Empty groups are never produced by construction — every key in the map has
 * at least one transaction.
 *
 * Returns groups sorted newest-month-first.
 */
export function groupTransactionsByMonth<T extends { date: string }>(
  transactions: T[],
): MonthGroup<T>[] {
  const map = new Map<string, T[]>();

  for (const tx of transactions) {
    const [year, month] = tx.date.split('T')[0].split('-').map(Number);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(tx);
    } else {
      map.set(key, [tx]);
    }
  }

  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, txs]) => {
      const [y, m] = key.split('-').map(Number);
      return { key, year: y, month: m - 1, transactions: txs };
    });
}

/** Returns the current calendar month key, e.g. "2026-05". */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Returns a fully-localized "Month Year" label using the browser's Intl API
 * (e.g. "May 2026", "Mai 2026", "Май 2026", "Травень 2026").
 *
 * The first character is upper-cased because some locales (Russian, Ukrainian)
 * return a lowercase month name from Intl.DateTimeFormat.
 */
export function formatMonthLabel(year: number, month: number, locale: string): string {
  const raw = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(year, month),
  );
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
