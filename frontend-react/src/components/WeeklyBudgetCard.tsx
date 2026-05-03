import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  date: string;
}

interface Props {
  transactions: Transaction[];
  monthlyBudget: number;
  formatAmount: (n: number) => string;
}

function getWeekStart(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  result.setHours(0, 0, 0, 0);
  return result;
}

function computeWeeklyStats(transactions: Transaction[], monthlyBudget: number) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);

  // Collect each distinct Monday that starts a week overlapping the current month
  const weekStartKeys = new Set<string>();
  const cursor = new Date(monthStart);
  while (cursor <= monthEnd) {
    const ws = getWeekStart(cursor);
    weekStartKeys.add(ws.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeksInMonth = weekStartKeys.size;
  const baseWeekly = monthlyBudget / weeksInMonth;

  const currentWeekStart = getWeekStart(today);
  const currentWeekEnd = new Date(currentWeekStart);
  currentWeekEnd.setDate(currentWeekEnd.getDate() + 6);
  currentWeekEnd.setHours(23, 59, 59, 999);

  // Only expenses within the current month
  const monthExpenses = transactions.filter(tx => {
    if (tx.type !== 'expense') return false;
    // Use noon to avoid DST edge-case date shifts
    const d = new Date(tx.date + 'T12:00:00');
    return d >= monthStart && d <= monthEnd;
  });

  // Completed weeks before the current week
  const pastWeekStarts = Array.from(weekStartKeys)
    .map(s => new Date(s + 'T00:00:00'))
    .filter(ws => ws < currentWeekStart)
    .sort((a, b) => a.getTime() - b.getTime());

  let carryOver = 0;
  for (const ws of pastWeekStarts) {
    const we = new Date(ws);
    we.setDate(we.getDate() + 6);
    we.setHours(23, 59, 59, 999);
    const spent = monthExpenses
      .filter(tx => {
        const d = new Date(tx.date + 'T12:00:00');
        return d >= ws && d <= we;
      })
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
    carryOver += baseWeekly - spent;
  }

  const weekSpent = monthExpenses
    .filter(tx => {
      const d = new Date(tx.date + 'T12:00:00');
      return d >= currentWeekStart && d <= currentWeekEnd;
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const weeklyLimit = baseWeekly + carryOver;

  return { weeklyLimit, weekSpent, carryOver, baseWeekly, weeksInMonth };
}

const WeeklyBudgetCard: React.FC<Props> = ({ transactions, monthlyBudget, formatAmount }) => {
  const { t } = useTranslation();
  const { weeklyLimit, weekSpent, carryOver } = computeWeeklyStats(transactions, monthlyBudget);

  const isOver = weekSpent >= weeklyLimit;
  const pct = weeklyLimit > 0 ? Math.min((weekSpent / weeklyLimit) * 100, 100) : 100;

  const barColor = isOver || weeklyLimit <= 0
    ? '#ef4444'
    : pct >= 80
      ? '#f59e0b'
      : '#38bdf8';

  const limitColor = isOver || weeklyLimit <= 0 ? '#ef4444' : 'var(--color-text-heading)';

  return (
    <div className="weekly-budget-card">
      <div className="weekly-budget-header">
        <div className="weekly-budget-icon">
          <CalendarDays size={22} />
        </div>
        <span className="weekly-budget-title">{t('dashboard.weekly_budget')}</span>
      </div>

      <div className="weekly-budget-body">
        <div className="weekly-budget-stat">
          <span className="weekly-budget-stat-label">{t('dashboard.weekly_can_spend')}</span>
          <span className="weekly-budget-stat-value" style={{ color: limitColor }}>
            {formatAmount(weeklyLimit)}
          </span>
        </div>
        <div className="weekly-budget-stat">
          <span className="weekly-budget-stat-label">{t('dashboard.weekly_spent')}</span>
          <span className="weekly-budget-stat-value" style={{ color: isOver ? '#ef4444' : 'var(--color-expense-text)' }}>
            {formatAmount(weekSpent)}
          </span>
        </div>
      </div>

      <div className="weekly-budget-bar-track">
        <div
          className="weekly-budget-bar-fill"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>

      {carryOver !== 0 && (
        <p className="weekly-budget-carryover" style={{ color: carryOver > 0 ? 'var(--color-income-text)' : '#f59e0b' }}>
          {carryOver > 0 ? '↑' : '↓'} {t('dashboard.weekly_carryover', { amount: formatAmount(Math.abs(carryOver)) })}
        </p>
      )}
    </div>
  );
};

export default WeeklyBudgetCard;
