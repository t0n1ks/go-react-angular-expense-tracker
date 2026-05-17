import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
}

interface Props {
  transactions: Transaction[];
  monthlyBudget: number;
  formatAmount: (n: number) => string;
}

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value || value === 'null' || value === 'undefined') return null;
  const raw = value.includes('T') ? value : value + 'T12:00:00';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekStart(d: Date): Date {
  const result = new Date(d);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  result.setHours(0, 0, 0, 0);
  return result;
}

function getFixedPaydayDates(fixedDay: number): { last: Date; next: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();

  const lastDate = d >= fixedDay
    ? new Date(y, m, fixedDay)
    : new Date(y, m - 1, fixedDay);
  const nextDate = d < fixedDay
    ? new Date(y, m, fixedDay)
    : new Date(y, m + 1, fixedDay);

  return { last: lastDate, next: nextDate };
}

const WeeklyBudgetCard: React.FC<Props> = ({ transactions, monthlyBudget, formatAmount }) => {
  const { t } = useTranslation();
  const { paydayMode, fixedPayday, manualNextPayday, settings, saveSettings } = useSettings();
  const { user } = useAuth();
  const [editingPayday, setEditingPayday] = useState(false);
  const [pendingDate, setPendingDate] = useState('');
  const [showInsight, setShowInsight] = useState(false);
  const insightRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toLocalDateStr(today);

  // --- Determine cycle boundaries ---
  let lastPayday: Date | null = null;
  let nextPayday: Date | null = null;

  if (paydayMode === 'fixed' && fixedPayday > 0) {
    const { last, next } = getFixedPaydayDates(fixedPayday);
    lastPayday = last;
    nextPayday = next;
  } else {
    // Smart mode: find most recent valid one-time income transaction
    const lastIncome = transactions
      .filter(tx => tx.type === 'income' && (tx.income_type === 'one_time' || !tx.income_type))
      .map(tx => safeParseDate(tx.date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    if (lastIncome) {
      lastPayday = new Date(lastIncome);
      lastPayday.setHours(0, 0, 0, 0);
    } else {
      // Fallback: start of current month
      lastPayday = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const parsedNext = safeParseDate(manualNextPayday);
    if (parsedNext) {
      nextPayday = parsedNext;
      nextPayday.setHours(0, 0, 0, 0);
    }
  }

  const hasCycle = nextPayday !== null;

  // --- Spending since last payday ---
  const lastPaydayStr = lastPayday ? toLocalDateStr(lastPayday) : todayStr;
  const spentSincePayday = transactions
    .filter(tx => {
      if (tx.type !== 'expense' || !tx.date) return false;
      const d = tx.date.slice(0, 10);
      return d >= lastPaydayStr && d <= todayStr;
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  // --- Pacing formula ---
  const daysRemaining = nextPayday
    ? Math.max(1, Math.ceil((nextPayday.getTime() - today.getTime()) / 86_400_000))
    : 0;
  const weeklyAllowance = hasCycle
    ? Math.max(0, (monthlyBudget - spentSincePayday) / (daysRemaining / 7))
    : 0;
  const baseLimitPerWeek = monthlyBudget / 4.3;

  // --- This week's spending (Mon–Sun) ---
  const weekStart = getWeekStart(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  const weekSpent = transactions
    .filter(tx => {
      if (tx.type !== 'expense') return false;
      const d = safeParseDate(tx.date);
      return d !== null && d >= weekStart && d <= weekEnd;
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const isPaydayToday = nextPayday?.toISOString().slice(0, 10) === todayStr;

  // --- Static weekly lock ---
  const currentWeekStartStr = toLocalDateStr(getWeekStart(today));
  const lockKey = `weekly_lock_${user?.id ?? 'anon'}`;

  let lockedAllowance: number;
  if (!hasCycle) {
    lockedAllowance = 0;
  } else {
    try {
      const raw = localStorage.getItem(lockKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.weekStart === currentWeekStartStr && typeof parsed.lockedAllowance === 'number') {
          lockedAllowance = parsed.lockedAllowance;
        } else {
          const val = Math.max(0, weeklyAllowance);
          localStorage.setItem(lockKey, JSON.stringify({ weekStart: currentWeekStartStr, lockedAllowance: val }));
          lockedAllowance = val;
        }
      } else {
        const val = Math.max(0, weeklyAllowance);
        localStorage.setItem(lockKey, JSON.stringify({ weekStart: currentWeekStartStr, lockedAllowance: val }));
        lockedAllowance = val;
      }
    } catch {
      lockedAllowance = Math.max(0, weeklyAllowance);
    }
  }

  const savingsBonus = Math.max(0, lockedAllowance - baseLimitPerWeek);
  const isOver = hasCycle && weekSpent > lockedAllowance;
  const pct = lockedAllowance > 0 ? Math.min((weekSpent / lockedAllowance) * 100, 100) : 0;
  const barColor = !hasCycle ? '#94a3b8' : isOver ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#38bdf8';

  // --- Delta: today's spending vs locked daily baseline ---
  const spentToday = transactions
    .filter(tx => tx.type === 'expense' && tx.date?.slice(0, 10) === todayStr)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const lockedDailyBaseline = lockedAllowance / 7;
  const todayDailyLimit = weeklyAllowance / 7; // live rate, used in popover formula

  const deltaDirection: 'up' | 'down' | 'neutral' =
    !hasCycle || lockedAllowance === 0 ? 'neutral'
    : spentToday < lockedDailyBaseline - 0.01 ? 'up'
    : spentToday > lockedDailyBaseline + 0.01 ? 'down'
    : 'neutral';

  const nextPaydayDisplay = nextPayday
    ? nextPayday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  const nextPaydayStr = nextPayday ? nextPayday.toISOString().slice(0, 10) : '';

  // --- Handlers ---
  const openPaydayPicker = () => {
    const defaultNext = new Date(today);
    defaultNext.setMonth(defaultNext.getMonth() + 1);
    setPendingDate(nextPaydayStr || defaultNext.toISOString().slice(0, 10));
    setEditingPayday(true);
  };

  const handleSave = async () => {
    if (!pendingDate) return;
    await saveSettings({ ...settings, manualNextPayday: pendingDate });
    setEditingPayday(false);
  };

  const handleCancel = () => {
    setEditingPayday(false);
    setPendingDate('');
  };

  useEffect(() => {
    if (!showInsight) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (insightRef.current && !insightRef.current.contains(e.target as Node)) {
        setShowInsight(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowInsight(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showInsight]);

  return (
    <div className="weekly-budget-card">
      <div className="weekly-budget-header">
        <div className="weekly-budget-icon">
          <CalendarDays size={22} />
        </div>
        <span className="weekly-budget-title">{t('dashboard.weekly_budget')}</span>
        {paydayMode === 'smart' && !editingPayday && (
          <button className="weekly-budget-salary-btn" onClick={openPaydayPicker}>
            {t('dashboard.weekly_received_salary')}
          </button>
        )}
      </div>

      {isPaydayToday && (
        <p className="weekly-budget-payday-today">{t('dashboard.weekly_payday_today')}</p>
      )}

      {hasCycle ? (
        <>
          <div className="weekly-budget-body">
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_budget_limit')}</span>
              <span className="weekly-budget-stat-value">{formatAmount(monthlyBudget)}</span>
            </div>
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_spent_since')}</span>
              <span className="weekly-budget-stat-value"
                style={{ color: spentSincePayday > monthlyBudget ? '#ef4444' : 'var(--color-expense-text)' }}>
                {formatAmount(spentSincePayday)}
              </span>
            </div>
            <div className="weekly-budget-stat" style={{ position: 'relative' }}>
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_can_spend')}</span>
              <div className="budget-can-spend-row">
                <span
                  className="weekly-budget-stat-value"
                  style={{ color: isOver ? '#ef4444' : 'var(--color-text-heading)' }}
                >
                  {formatAmount(lockedAllowance)}
                </span>

                <AnimatePresence>
                  {deltaDirection !== 'neutral' && (
                    <motion.span
                      key={deltaDirection}
                      className="budget-delta-arrow"
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -4 }}
                      transition={{ duration: 0.2 }}
                      aria-hidden="true"
                    >
                      {deltaDirection === 'up'
                        ? <TrendingUp size={14} color="#10b981" />
                        : <TrendingDown size={14} color="#f87171" />}
                    </motion.span>
                  )}
                </AnimatePresence>

                <button
                  className="budget-insight-btn"
                  onClick={() => setShowInsight(v => !v)}
                  aria-label="Budget insight"
                  type="button"
                >
                  <Info size={14} />
                </button>
              </div>

              {savingsBonus > 0.01 && (
                <span className="weekly-budget-bonus-label">
                  +{formatAmount(savingsBonus)} ({t('dashboard.weekly_savings_bonus')})
                </span>
              )}

              <AnimatePresence>
                {showInsight && (
                  <motion.div
                    ref={insightRef}
                    className="budget-insight-popover"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                  >
                    {deltaDirection !== 'neutral' && (
                      <p className="budget-insight-popover-title">
                        {deltaDirection === 'up'
                          ? t('dashboard.budget_insight_title_up')
                          : t('dashboard.budget_insight_title_down')}
                      </p>
                    )}
                    {deltaDirection !== 'neutral' && (
                      <p className="budget-insight-popover-body">
                        {deltaDirection === 'up'
                          ? t('dashboard.budget_insight_reason_up')
                          : t('dashboard.budget_insight_reason_down')}
                      </p>
                    )}
                    <div className="budget-insight-formula">
                      <span className="budget-insight-formula-label">
                        {t('dashboard.budget_insight_formula_label')}
                      </span>
                      <span>{t('dashboard.budget_insight_formula')}</span>
                      <span>
                        {t('dashboard.budget_insight_example', {
                          remaining: formatAmount(monthlyBudget - spentSincePayday),
                          days: daysRemaining,
                          daily: formatAmount(todayDailyLimit),
                        })}
                      </span>
                    </div>
                    {deltaDirection !== 'neutral' && (
                      <p className={`budget-insight-cheer budget-insight-cheer--${deltaDirection}`}>
                        {deltaDirection === 'up'
                          ? t('dashboard.budget_insight_cheer_up')
                          : t('dashboard.budget_insight_cheer_down')}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_spent')}</span>
              <span className="weekly-budget-stat-value"
                style={{ color: isOver ? '#ef4444' : 'var(--color-expense-text)' }}>
                {formatAmount(weekSpent)}
              </span>
            </div>
          </div>

          <div className="weekly-budget-bar-track">
            <div className="weekly-budget-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
          </div>
        </>
      ) : (
        <div className="weekly-budget-no-cycle">
          <p className="weekly-budget-no-cycle-text">{t('dashboard.weekly_no_cycle')}</p>
        </div>
      )}

      <div className="weekly-budget-footer">
        {editingPayday ? (
          <div className="weekly-budget-payday-form">
            <input
              type="date"
              className="weekly-budget-date-input"
              value={pendingDate}
              min={todayStr}
              onChange={e => setPendingDate(e.target.value)}
            />
            <button className="weekly-budget-action-btn weekly-budget-action-btn--save" onClick={handleSave}>
              {t('dashboard.weekly_save')}
            </button>
            <button className="weekly-budget-action-btn weekly-budget-action-btn--cancel" onClick={handleCancel}>
              {t('dashboard.weekly_cancel')}
            </button>
          </div>
        ) : nextPayday && (
          <div className="weekly-budget-payday-info">
            <span className="weekly-budget-payday-label">{t('dashboard.weekly_next_payday_label')}:</span>
            {paydayMode === 'smart' ? (
              <button className="weekly-budget-payday-btn" onClick={openPaydayPicker}>
                {nextPaydayDisplay}
              </button>
            ) : (
              <span className="weekly-budget-payday-date">{nextPaydayDisplay}</span>
            )}
            <span className="weekly-budget-days-left">
              ({t('dashboard.weekly_days_left', { days: daysRemaining })})
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WeeklyBudgetCard;
