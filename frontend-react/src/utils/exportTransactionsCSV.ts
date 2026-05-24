interface ExportTransaction {
  date: string;
  category: { name: string };
  amount: number;
  type: 'expense' | 'income';
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
      escapeField(tx.type === 'expense' ? labels.expense : labels.income),
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
