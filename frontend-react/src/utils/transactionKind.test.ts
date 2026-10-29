import { describe, it, expect } from 'vitest';
import { txFlow, flowSign, flowClass, flowLabelKey, isPickableCategory, VARIABLE_BUDGET_KEY } from './transactionKind';

describe('txFlow', () => {
  it.each([
    [{ type: 'income' }, 'in'],
    [{ type: 'savings_deposit' }, 'in'],
    [{ type: 'expense' }, 'out'],
    [{ type: 'savings_withdrawal' }, 'out'], // spent from savings
    [{ type: 'budget_transfer' }, 'transfer'], // "Переменный бюджет" row
    [{ type: 'savings_withdrawal', source: 'savings_to_budget' }, 'transfer'], // dated transfer
  ])('%o → %s', (tx, flow) => {
    expect(txFlow(tx)).toBe(flow);
  });

  it('shows a transfer without a sign, neutral, labelled as a transfer', () => {
    expect(flowSign('transfer')).toBe('');
    expect(flowClass('transfer')).toBe('transfer');
    expect(flowLabelKey('transfer')).toBe('transactions.type_transfer');
    expect(flowSign('in')).toBe('+');
    expect(flowSign('out')).toBe('-');
  });
});

describe('isPickableCategory', () => {
  it('hides the system "Переменный бюджет" category from pickers only', () => {
    expect(isPickableCategory({ translation_key: VARIABLE_BUDGET_KEY })).toBe(false);
    expect(isPickableCategory({ translation_key: 'category.food' })).toBe(true);
    expect(isPickableCategory({ translation_key: null })).toBe(true);
  });
});
