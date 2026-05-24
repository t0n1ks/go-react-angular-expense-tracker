interface PdfTransaction {
  date: string;
  category: { name: string };
  amount: number;
  type: 'expense' | 'income';
  description: string;
}

interface PdfLabels {
  title: string;
  date: string;
  category: string;
  amount: string;
  type: string;
  description: string;
  expense: string;
  income: string;
  generatedOn: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function exportTransactionsPDF(
  transactions: PdfTransaction[],
  labels: PdfLabels,
  formatAmount: (n: number) => string,
): void {
  const today = new Date().toISOString().split('T')[0];

  const rows = transactions
    .map(tx => {
      const dateStr = tx.date.split('T')[0];
      const typeClass = tx.type === 'expense' ? 'type-expense' : 'type-income';
      const typeLabel = tx.type === 'expense' ? labels.expense : labels.income;
      return `<tr>
        <td class="col-date">${escapeHtml(dateStr)}</td>
        <td class="col-category">${escapeHtml(tx.category?.name ?? '')}</td>
        <td class="col-amount amount ${typeClass}">${escapeHtml(formatAmount(tx.amount))}</td>
        <td class="col-type ${typeClass}">${escapeHtml(typeLabel)}</td>
        <td class="col-description">${escapeHtml(tx.description ?? '')}</td>
      </tr>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(labels.title)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 10pt;
      color: #1a1a1a;
      padding: 0;
    }
    h1 { font-size: 15pt; font-weight: 700; margin-bottom: 3mm; color: #111; }
    .meta { font-size: 8pt; color: #777; margin-bottom: 6mm; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    colgroup col.col-date     { width: 10%; }
    colgroup col.col-category { width: 17%; }
    colgroup col.col-amount   { width: 13%; }
    colgroup col.col-type     { width: 10%; }
    colgroup col.col-description { width: 50%; }
    thead tr { background: #f0f0f0; }
    th {
      font-weight: 700;
      text-align: left;
      padding: 5px 7px;
      border-bottom: 2px solid #ccc;
      font-size: 9pt;
      overflow: hidden;
    }
    th.col-amount { text-align: right; }
    td {
      padding: 4px 7px;
      border-bottom: 1px solid #e8e8e8;
      vertical-align: top;
      font-size: 9pt;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    tr:nth-child(even) td { background: #f9f9f9; }
    .amount { text-align: right; font-weight: 600; }
    .type-expense { color: #dc2626; }
    .type-income  { color: #16a34a; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(labels.title)}</h1>
  <p class="meta">${escapeHtml(labels.generatedOn)}: ${today}</p>
  <table>
    <colgroup>
      <col class="col-date">
      <col class="col-category">
      <col class="col-amount">
      <col class="col-type">
      <col class="col-description">
    </colgroup>
    <thead>
      <tr>
        <th class="col-date">${escapeHtml(labels.date)}</th>
        <th class="col-category">${escapeHtml(labels.category)}</th>
        <th class="col-amount">${escapeHtml(labels.amount)}</th>
        <th class="col-type">${escapeHtml(labels.type)}</th>
        <th class="col-description">${escapeHtml(labels.description)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 350); };
  </script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) {
    win.addEventListener('afterprint', () => URL.revokeObjectURL(url));
  } else {
    URL.revokeObjectURL(url);
  }
}
