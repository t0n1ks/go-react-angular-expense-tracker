import { describe, it, expect } from 'vitest';
import { txFlow, flowSign, flowClass, flowLabelKey, isPickableCategory, formCategoryId, VARIABLE_BUDGET_KEY } from './transactionKind';

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

describe('formCategoryId', () => {
  const system = { id: 1, translation_key: VARIABLE_BUDGET_KEY };
  const food = { id: 2, translation_key: 'category.food' };
  const mine = { id: 3, translation_key: null };

  it('never defaults to a system category, even when it comes first', () => {
    expect(formCategoryId([system, food, mine], '')).toBe('2');
  });
  it('replaces a held system category with the first pickable one', () => {
    expect(formCategoryId([system, food, mine], '1')).toBe('2');
  });
  it('keeps a valid choice', () => {
    expect(formCategoryId([system, food, mine], '3')).toBe('3');
  });
  it('drops a choice that no longer exists', () => {
    expect(formCategoryId([system, food], '9')).toBe('2');
  });
  it('is empty when only system categories exist', () => {
    expect(formCategoryId([system], '')).toBe('');
  });
});
