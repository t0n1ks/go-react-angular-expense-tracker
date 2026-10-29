// Prefill for the new-cycle form: the fixed-expense list saved on the most
// recently started cycle's form (stopped or not), as an editable DRAFT. It is
// only form state — nothing is recorded until the user presses start, so it
// can never double-enter an expense. Descriptions stay exactly as typed.

export interface FixedExpenseDraft {
  amount: string;
  description: string;
  category_type: 'need' | 'want';
}

interface StoredFixedExpense {
  amount: number;
  description: string;
  category_type: string;
}

interface CycleWithFixedExpenses {
  fixed_expenses?: StoredFixedExpense[] | null;
}

/**
 * Draft rows from GET /salary-cycle/history (newest cycle first). Empty when
 * there is no previous cycle or it had no fixed expenses.
 */
export function fixedExpenseDraft(cyclesNewestFirst: CycleWithFixedExpenses[] | null | undefined): FixedExpenseDraft[] {
  const latest = cyclesNewestFirst?.[0];
  return (latest?.fixed_expenses ?? [])
    .filter((fe) => Number(fe.amount) > 0)
    .map((fe) => ({
      amount: String(fe.amount),
      description: fe.description ?? '',
      category_type: fe.category_type === 'want' ? 'want' : 'need',
    }));
}
