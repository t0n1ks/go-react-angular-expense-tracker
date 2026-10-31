import { describe, it, expect } from 'vitest';
import { withCrossModeRows } from './crossModeList';
import { groupTransactionsByMonth } from './groupTransactionsByMonth';

interface T { id: number; date: string; amount: number; type: string }
const tx = (id: number, date: string, amount: number, type = 'expense'): T => ({ id, date, amount, type });
const byDateDesc = (a: T, b: T) => b.date.localeCompare(a.date);
const monthExpense = (txs: T[]) => txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

const own = [tx(1, '2026-10-20T00:00:00Z', 10), tx(2, '2026-10-05T00:00:00Z', 20), tx(3, '2026-09-10T00:00:00Z', 5)];
const other = [tx(11, '2026-10-12T00:00:00Z', 300), tx(12, '2026-08-01T00:00:00Z', 70, 'income')];

describe('other-mode rows in the list', () => {
  it('opt-in off: groups are exactly the own groups', () => {
    const groups = groupTransactionsByMonth(own);
    const list = withCrossModeRows(groups, [], byDateDesc);
    expect(list.map(g => g.key)).toEqual(groups.map(g => g.key));
    list.forEach((g, i) => {
      expect(g.transactions).toBe(groups[i].transactions);
      expect(g.rows.map(r => r.tx)).toEqual(groups[i].transactions);
      expect(g.rows.every(r => !r.cross)).toBe(true);
    });
  });

  it('opt-in on: other rows slot into their months by date, marked cross', () => {
    const list = withCrossModeRows(groupTransactionsByMonth(own), other, byDateDesc);
    expect(list.map(g => g.key)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(list[0].rows.map(r => [r.tx.id, r.cross])).toEqual([[1, false], [11, true], [2, false]]);
    expect(list[2].rows).toEqual([{ tx: other[1], cross: true }]);
  });

  it('never counts other rows: month counts and totals stay own-only', () => {
    const list = withCrossModeRows(groupTransactionsByMonth(own), other, byDateDesc);
    expect(list[0].transactions.map(t => t.id)).toEqual([1, 2]);
    expect(monthExpense(list[0].transactions)).toBe(30);
    expect(list[1].transactions.map(t => t.id)).toEqual([3]);
    // A month with only other-mode entries counts nothing.
    expect(list[2].transactions).toEqual([]);
    expect(monthExpense(list[2].transactions)).toBe(0);
  });
});
