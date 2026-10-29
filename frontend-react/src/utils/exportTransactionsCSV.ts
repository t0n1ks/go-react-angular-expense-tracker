import { txFlow } from './transactionKind';

interface ExportTransaction {
  date: string;
  category: { name: string };
  amount: number;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal' | 'budget_transfer';
  source?: string;
  description: string;
}

function escapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

interface ExportLabels {
  date: string;
  category: string;
  amount: string;
  type: string;
  description: string;
  expense: string;
  income: string;
  /** Budget ↔ savings move (neither earning nor spending). */
  transfer?: string;
}

export function exportTransactionsCSV(
  transactions: ExportTransaction[],
  labels: ExportLabels,
  filename = 'transactions.csv',
): void {
  const BOM = '﻿';
  const header = [
    labels.date,
    labels.category,
    labels.amount,
    labels.type,
    labels.description,
  ]
    .map(escapeField)
    .join(',');

  const rows = transactions.map(tx => {
    const dateStr = tx.date.split('T')[0];
    return [
      escapeField(dateStr),
      escapeField(tx.category?.name ?? ''),
      String(tx.amount),
      // Direction-aware (utils/transactionKind): a savings_deposit is an
      // inflow (Income), a savings_withdrawal an outflow (Expense), and a
      // budget ↔ savings move a Transfer — never label the whole savings pool
      // the same way.
      escapeField(
        txFlow(tx) === 'in' ? labels.income
          : txFlow(tx) === 'transfer' ? (labels.transfer ?? labels.income)
          : labels.expense,
      ),
      escapeField(tx.description ?? ''),
    ].join(',');
  });

  const csv = BOM + [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
