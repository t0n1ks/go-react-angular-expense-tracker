// How a transaction row moves money, for display (sign, colour, type label).
// Mirrors the Go export's txDirection so the list, the detail view and the
// PDF always agree:
//
//   - in       income, savings deposit                         → "+", green
//   - out      expense, withdrawal spent from savings          → "−", red
//   - transfer a "Переменный бюджет" row (money returned from
//              savings, neutral) or a today-dated "savings →
//              budget" transfer from a closed cycle's deposit  → no sign, grey
//
// Transfers are neither earning nor spending, so month totals skip them.

export type TxFlow = 'in' | 'out' | 'transfer';

export interface KindTransaction {
  type: string;
  source?: string;
}

/** The system category money returned from savings is filed under. */
export const VARIABLE_BUDGET_KEY = 'category.variable_budget';

/** A neutral "Переменный бюджет" row (budget_transfer). */
export const isBudgetRow = (tx: KindTransaction): boolean => tx.type === 'budget_transfer';

/** A today-dated "savings → budget" transfer (from a closed cycle's deposit). */
export const isSavingsToBudgetTransfer = (tx: KindTransaction): boolean =>
  tx.type === 'savings_withdrawal' && tx.source === 'savings_to_budget';

export function txFlow(tx: KindTransaction): TxFlow {
  if (isBudgetRow(tx) || isSavingsToBudgetTransfer(tx)) return 'transfer';
  if (tx.type === 'income' || tx.type === 'savings_deposit') return 'in';
  return 'out';
}

/** Amount prefix: "+", "−" or none for a transfer. */
export const flowSign = (flow: TxFlow): string => (flow === 'in' ? '+' : flow === 'out' ? '-' : '');

/** CSS suffix shared by amount and type badge: income | expense | transfer. */
export const flowClass = (flow: TxFlow): string =>
  flow === 'in' ? 'income' : flow === 'out' ? 'expense' : 'transfer';

/** i18n key of the row's type label. */
export const flowLabelKey = (flow: TxFlow): string =>
  flow === 'in' ? 'transactions.type_income' : flow === 'out' ? 'transactions.type_expense' : 'transactions.type_transfer';

/** System categories that ordinary entries can't be filed under (pickers hide them). */
export const isPickableCategory = (c: { translation_key?: string | null }): boolean =>
  c.translation_key !== VARIABLE_BUDGET_KEY;
