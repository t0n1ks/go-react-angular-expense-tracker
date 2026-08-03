import { describe, it, expect } from 'vitest';
import {
  filterTransactions,
  buildSearchIndex,
  hasActiveFilters,
  activeFilterCount,
  EMPTY_FILTERS,
  type TransactionFilters,
  type FilterableTransaction,
} from './filterTransactions';

interface Tx extends FilterableTransaction {
  id: number;
  date: string;
  description: string;
  category: { id: number };
  /** Label as the user sees it — built-ins translated, custom verbatim. */
  label: string;
}

const GROCERIES = { id: 1 };
const TRANSPORT = { id: 2 };
const CUSTOM = { id: 3 };

const txs: Tx[] = [
  { id: 1, date: '2026-06-03T00:00:00Z', description: 'молоко и хлеб', category: GROCERIES, label: 'Еда' },
  { id: 2, date: '2026-06-15T00:00:00Z', description: 'Молоко 2%', category: GROCERIES, label: 'Еда' },
  { id: 3, date: '2026-06-15T00:00:00Z', description: 'Bus ticket', category: TRANSPORT, label: 'Transport' },
  { id: 4, date: '2026-07-01T00:00:00Z', description: 'Käse und Brötchen', category: GROCERIES, label: 'Еда' },
  { id: 5, date: '2026-07-20T00:00:00Z', description: '', category: CUSTOM, label: 'Продукты у дома' },
];

const index = buildSearchIndex(txs, tx => tx.label);

function apply(partial: Partial<TransactionFilters>): number[] {
  const filters = { ...EMPTY_FILTERS, ...partial };
  return filterTransactions(txs, filters, index).map(t => t.id);
}

describe('hasActiveFilters / activeFilterCount', () => {
  it('treats the empty filter set as inactive', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('ignores a whitespace-only query', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: '   ' })).toBe(false);
  });

  it('counts each filled filter once', () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, query: 'x' })).toBe(1);
    expect(activeFilterCount({ ...EMPTY_FILTERS, query: 'x', categoryId: '1' })).toBe(2);
    expect(
      activeFilterCount({ ...EMPTY_FILTERS, query: 'x', categoryId: '1', dateFrom: '2026-06-01' }),
    ).toBe(3);
  });

  it('counts a from+to range as a single date filter', () => {
    expect(
      activeFilterCount({
        ...EMPTY_FILTERS,
        dateMode: 'range',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      }),
    ).toBe(1);
  });

  it('treats an open-ended "up to" range as active', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, dateMode: 'range', dateTo: '2026-06-30' })).toBe(true);
  });
});

describe('no filters', () => {
  it('returns everything, preserving the original reference', () => {
    const out = filterTransactions(txs, EMPTY_FILTERS, index);
    expect(out).toBe(txs);
  });
});

describe('text search alone', () => {
  it('matches Cyrillic in the description', () => {
    expect(apply({ query: 'молоко' })).toEqual([1, 2]);
  });

  it('is case-insensitive for Cyrillic', () => {
    expect(apply({ query: 'МОЛОКО' })).toEqual([1, 2]);
    expect(apply({ query: 'Молоко' })).toEqual([1, 2]);
  });

  it('matches Latin text case-insensitively', () => {
    expect(apply({ query: 'bus' })).toEqual([3]);
    expect(apply({ query: 'BUS TICKET' })).toEqual([3]);
  });

  it('matches German umlauts', () => {
    expect(apply({ query: 'käse' })).toEqual([4]);
    expect(apply({ query: 'Brötchen' })).toEqual([4]);
  });

  it('matches the translated label of a built-in category', () => {
    expect(apply({ query: 'Еда' })).toEqual([1, 2, 4]);
  });

  it('matches a custom category name that was never translated', () => {
    expect(apply({ query: 'Продукты' })).toEqual([5]);
  });

  it('trims surrounding whitespace', () => {
    expect(apply({ query: '  молоко  ' })).toEqual([1, 2]);
  });

  it('returns nothing for a non-matching query', () => {
    expect(apply({ query: 'zzzz' })).toEqual([]);
  });
});

describe('category filter alone', () => {
  it('keeps only the chosen category', () => {
    expect(apply({ categoryId: '1' })).toEqual([1, 2, 4]);
    expect(apply({ categoryId: '2' })).toEqual([3]);
    expect(apply({ categoryId: '3' })).toEqual([5]);
  });

  it('returns nothing for a category with no transactions', () => {
    expect(apply({ categoryId: '99' })).toEqual([]);
  });
});

describe('date filter alone', () => {
  it('day mode matches exactly one calendar day', () => {
    expect(apply({ dateMode: 'day', dateFrom: '2026-06-15' })).toEqual([2, 3]);
  });

  it('day mode is timezone-safe (midnight UTC row stays on its own day)', () => {
    expect(apply({ dateMode: 'day', dateFrom: '2026-06-03' })).toEqual([1]);
    expect(apply({ dateMode: 'day', dateFrom: '2026-06-02' })).toEqual([]);
  });

  it('range mode is inclusive at both ends', () => {
    expect(apply({ dateMode: 'range', dateFrom: '2026-06-03', dateTo: '2026-06-15' })).toEqual([1, 2, 3]);
  });

  it('range mode spans months', () => {
    expect(apply({ dateMode: 'range', dateFrom: '2026-06-15', dateTo: '2026-07-01' })).toEqual([2, 3, 4]);
  });

  it('range mode with only a start is open-ended forward', () => {
    expect(apply({ dateMode: 'range', dateFrom: '2026-07-01' })).toEqual([4, 5]);
  });

  it('range mode with only an end is open-ended backward', () => {
    expect(apply({ dateMode: 'range', dateTo: '2026-06-15' })).toEqual([1, 2, 3]);
  });

  it('ignores dateTo while in day mode', () => {
    expect(apply({ dateMode: 'day', dateFrom: '2026-06-15', dateTo: '2026-12-31' })).toEqual([2, 3]);
  });
});

describe('combinations are ANDed', () => {
  it('text + category', () => {
    expect(apply({ query: 'молоко', categoryId: '1' })).toEqual([1, 2]);
    // Same text, a category that holds none of those rows → empty.
    expect(apply({ query: 'молоко', categoryId: '2' })).toEqual([]);
  });

  it('text + date day', () => {
    expect(apply({ query: 'молоко', dateMode: 'day', dateFrom: '2026-06-15' })).toEqual([2]);
  });

  it('category + date range', () => {
    expect(
      apply({ categoryId: '1', dateMode: 'range', dateFrom: '2026-06-01', dateTo: '2026-06-30' }),
    ).toEqual([1, 2]);
  });

  it('all three together', () => {
    expect(
      apply({
        query: 'молоко',
        categoryId: '1',
        dateMode: 'range',
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      }),
    ).toEqual([1, 2]);
  });

  it('all three together, narrowed to a single row', () => {
    expect(
      apply({ query: 'молоко', categoryId: '1', dateMode: 'day', dateFrom: '2026-06-03' }),
    ).toEqual([1]);
  });

  it('contradictory filters yield nothing', () => {
    expect(
      apply({ query: 'bus', categoryId: '1', dateMode: 'day', dateFrom: '2026-06-15' }),
    ).toEqual([]);
  });
});

describe('search index', () => {
  it('covers description and label together', () => {
    const idx = buildSearchIndex(txs, tx => tx.label);
    expect(idx.get(1)).toContain('молоко');
    expect(idx.get(1)).toContain('еда');
  });

  it('drops rows whose id is absent from the index rather than throwing', () => {
    const empty = new Map<number, string>();
    expect(filterTransactions(txs, { ...EMPTY_FILTERS, query: 'молоко' }, empty)).toEqual([]);
  });
});
