// One message for every path that moves money between the spendable budget
// and savings, in either direction (manual deposit, editing a deposit,
// re-filing an expense, moving savings back to the budget). The server
// enforces the rules — a deposit may not exceed what is left to spend, a
// return may not exceed what savings hold, and both need a current cycle —
// and returns a code; this maps it to the user's language.

import type { TFunction } from 'i18next';

interface MoveErrorBody {
  code?: string;
  available?: number;
}

export type MoveDirection = 'toSavings' | 'toBudget';

/** Localized message for a rejected budget ↔ savings move, or null for other errors. */
export function savingsMoveError(
  err: unknown,
  t: TFunction,
  formatAmount: (n: number) => string,
  direction: MoveDirection = 'toSavings',
): string | null {
  const data = (err as { response?: { data?: MoveErrorBody } })?.response?.data;
  switch (data?.code) {
    case 'DEPOSIT_EXCEEDS_SPENDABLE':
      return t('dashboard.savings_deposit_exceeds', { amount: formatAmount(data.available ?? 0) });
    case 'SAVINGS_INSUFFICIENT':
      return t('dashboard.savings_return_exceeds', { amount: formatAmount(data.available ?? 0) });
    case 'DEPOSIT_OUTSIDE_CYCLE':
    case 'NO_ACTIVE_CYCLE':
      return t(direction === 'toBudget' ? 'dashboard.savings_return_no_cycle' : 'dashboard.savings_deposit_no_cycle');
    default:
      return null;
  }
}
