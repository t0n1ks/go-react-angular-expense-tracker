import { describe, it, expect } from 'vitest';
import { fixedExpenseDraft } from './fixedExpenseDraft';

describe('fixedExpenseDraft', () => {
  it('drafts the most recently started cycle’s stored list, as typed', () => {
    const draft = fixedExpenseDraft([
      {
        fixed_expenses: [
          { amount: 39.99, description: 'Internet', category_type: 'need' },
          { amount: 58, description: 'D-Ticket', category_type: 'need' },
          { amount: 21.42, description: 'Claude', category_type: 'want' },
        ],
      },
      { fixed_expenses: [{ amount: 999, description: 'older cycle', category_type: 'need' }] },
    ]);
    expect(draft).toEqual([
      { amount: '39.99', description: 'Internet', category_type: 'need' },
      { amount: '58', description: 'D-Ticket', category_type: 'need' },
      { amount: '21.42', description: 'Claude', category_type: 'want' },
    ]);
  });

  it('is empty with no previous cycle — no prefill, no error', () => {
    expect(fixedExpenseDraft([])).toEqual([]);
    expect(fixedExpenseDraft(undefined)).toEqual([]);
    expect(fixedExpenseDraft([{ fixed_expenses: null }])).toEqual([]);
  });

  it('skips zero rows and treats unknown types as needs', () => {
    expect(fixedExpenseDraft([{
      fixed_expenses: [
        { amount: 0, description: 'empty', category_type: 'need' },
        { amount: 12, description: 'Kühlschrank', category_type: '' },
      ],
    }])).toEqual([{ amount: '12', description: 'Kühlschrank', category_type: 'need' }]);
  });
});
