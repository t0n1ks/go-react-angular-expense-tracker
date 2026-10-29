import { describe, it, expect } from 'vitest';
import { compareByTimeThenAmount, entryTime, formatTxDate } from './transactionTime';
import { groupTransactionsByMonth } from './groupTransactionsByMonth';
import { filterTransactions, buildSearchIndex, EMPTY_FILTERS } from './filterTransactions';

const tx = (id: number, amount: number, date: string, created: string, effective = created) => ({
  id, amount, date, created_at: created, effective_at: effective, description: `tx${id}`,
  type: 'expense' as const, category: { id: 1, name: 'Food' },
});

describe('compareByTimeThenAmount', () => {
  it('sorts newest first, same instant by amount (largest first)', () => {
    const salaryAt = '2026-10-28T09:00:00Z';
    const list = [
      tx(1, 39.99, '2026-10-28', salaryAt),
      tx(2, 504, '2026-10-28', salaryAt),
      tx(3, 4.5, '2026-10-29', '2026-10-29T12:30:00Z'),
      tx(4, 58, '2026-10-28', salaryAt),
      tx(5, 12, '2026-10-29', '2026-10-29T08:00:00Z'),
    ];
    expect([...list].sort(compareByTimeThenAmount).map((t) => t.id)).toEqual([3, 5, 2, 4, 1]);
  });

  it('places a backdated entry at its own date, not at when it was typed', () => {
    const backdated = tx(1, 10, '2026-10-20', '2026-10-29T15:00:00Z', '2026-10-20T00:00:00Z');
    const same = tx(2, 5, '2026-10-25', '2026-10-25T10:00:00Z');
    expect([backdated, same].sort(compareByTimeThenAmount).map((t) => t.id)).toEqual([2, 1]);
  });

  it('keeps month grouping and search working on the sorted list', () => {
    const list = [
      tx(1, 10, '2026-09-30', '2026-09-30T10:00:00Z'),
      tx(2, 20, '2026-10-01', '2026-10-01T10:00:00Z'),
      tx(3, 30, '2026-10-01', '2026-10-01T10:00:00Z'),
    ].sort(compareByTimeThenAmount);
    const groups = groupTransactionsByMonth(list);
    expect(groups.map((g) => g.key)).toEqual(['2026-10', '2026-09']);
    expect(groups[0].transactions.map((t) => t.id)).toEqual([3, 2]);
    const index = buildSearchIndex(list, () => 'Food');
    const found = filterTransactions(list, { ...EMPTY_FILTERS, query: 'tx2' }, index);
    expect(found.map((t) => t.id)).toEqual([2]);
  });
});

describe('entryTime', () => {
  it('shows the real entry time when entered on its own date', () => {
    const t = entryTime(tx(1, 1, '2026-10-29', '2026-10-29T14:05:00Z'));
    expect(t?.toISOString()).toBe('2026-10-29T14:05:00.000Z');
  });

  it('shows no time for a backdated entry (never invents 00:00)', () => {
    expect(entryTime(tx(1, 1, '2026-10-20', '2026-10-29T14:05:00Z', '2026-10-20T00:00:00Z'))).toBeNull();
  });

  it('shows no time when the server sent none', () => {
    expect(entryTime({ date: '2026-10-29' })).toBeNull();
  });
});

describe('formatTxDate', () => {
  it('formats the stored calendar day without a timezone shift', () => {
    expect(formatTxDate('2026-10-01T00:00:00Z', 'en-GB')).toBe('01/10/2026');
  });
});
