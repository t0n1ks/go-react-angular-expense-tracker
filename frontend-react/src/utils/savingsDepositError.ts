// One message for every path that moves money into savings (manual deposit,
// editing a deposit, re-filing an expense). The server enforces the rule — a
// deposit comes out of the current cycle's budget and may not exceed what is
// left — and returns a code; this maps it to the user's language.

import type { TFunction } from 'i18next';

interface DepositErrorBody {
  code?: string;
  available?: number;
}

/** Localized message for a rejected savings deposit, or null for other errors. */
export function savingsDepositError(
  err: unknown,
  t: TFunction,
  formatAmount: (n: number) => string,
): string | null {
  const data = (err as { response?: { data?: DepositErrorBody } })?.response?.data;
  switch (data?.code) {
    case 'DEPOSIT_EXCEEDS_SPENDABLE':
      return t('dashboard.savings_deposit_exceeds', { amount: formatAmount(data.available ?? 0) });
    case 'DEPOSIT_OUTSIDE_CYCLE':
    case 'NO_ACTIVE_CYCLE':
      return t('dashboard.savings_deposit_no_cycle');
    default:
      return null;
  }
}
