import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, TrendingUp, TrendingDown, Info, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
  created_at?: string;
  category?: { id: number; name: string };
}

interface Props {
  transactions: Transaction[];
  monthlyBudget: number;
  formatAmount: (n: number) => string;
  cycleStartAt?: Date;
  onCycleReset?: () => void;
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value || value === 'null' || value === 'undefined') return null;
  const raw = value.includes('T') ? value : value + 'T12:00:00';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function getFixedPaydayDates(fixedDay: number): { last: Date; next: Date } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  const lastDate = d >= fixedDay ? new Date(y, m, fixedDay) : new Date(y, m - 1, fixedDay);
  const nextDate = d < fixedDay ? new Date(y, m, fixedDay) : new Date(y, m + 1, fixedDay);
  return { last: lastDate, next: nextDate };
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

const WeeklyBudgetCard: React.FC<Props> = ({
  transactions,
  monthlyBudget,
  formatAmount,
  cycleStartAt,
  onCycleReset,
}) => {
  const { t } = useTranslation();
  const { paydayMode, fixedPayday, manualNextPayday, settings, saveSettings, refreshCycle, currentCycle } = useSettings();
  const { user, axiosInstance } = useAuth();
  const [editingPayday, setEditingPayday] = useState(false);
  const [pendingDate, setPendingDate] = useState('');
  const [paydayEditError, setPaydayEditError] = useState('');
  const [showInsight, setShowInsight] = useState(false);
  const insightRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toLocalDateStr(today);
  const tomorrowStr = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toLocalDateStr(d);
  })();

  // ── Cycle boundaries ──────────────────────────────────────────────────────
  let lastPayday: Date | null = null;
  let nextPayday: Date | null = null;

  if (cycleStartAt) {
    lastPayday = cycleStartAt;
    const parsedNext = safeParseDate(manualNextPayday);
    if (parsedNext) { nextPayday = parsedNext; nextPayday.setHours(0, 0, 0, 0); }
  } else if (paydayMode === 'fixed' && fixedPayday > 0) {
    const { last, next } = getFixedPaydayDates(fixedPayday);
    lastPayday = last;
    nextPayday = next;
  } else {
    const lastIncomeTx = transactions
      .filter(tx => tx.type === 'income' && (tx.income_type === 'one_time' || !tx.income_type))
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : new Date(a.date).getTime();
        const bTs = b.created_at ? new Date(b.created_at).getTime() : new Date(b.date).getTime();
        return bTs - aTs;
      })[0] ?? null;
    if (lastIncomeTx) {
      lastPayday = lastIncomeTx.created_at
        ? new Date(lastIncomeTx.created_at)
        : new Date(lastIncomeTx.date + 'T00:00:00');
    } else {
      lastPayday = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    const parsedNext = safeParseDate(manualNextPayday);
    if (parsedNext) { nextPayday = parsedNext; nextPayday.setHours(0, 0, 0, 0); }
  }

  const hasCycle = cycleStartAt !== undefined || nextPayday !== null;

  // ── Fixed-expense identification ──────────────────────────────────────────
  // Transactions tagged with the "Fixed Payments" category are committed
  // expenses. We exclude them from "variable" spend so the rolling limit
  // reflects only day-to-day discretionary spending.
  const fixedExpCatID = currentCycle?.fixed_exp_category_id ?? 0;

  const isVariableExpense = (tx: Transaction): boolean => {
    if (tx.type !== 'expense') return false;
    if (fixedExpCatID > 0 && tx.category?.id === fixedExpCatID) return false;
    return true;
  };

  // ── Rolling cycle-week calculation ────────────────────────────────────────
  // Cycle-weeks are 7-day chunks starting strictly from cycleStartAt.
  // Over-/under-spend in a completed week rolls into the next week's allowance.
  const cycleStartMs = cycleStartAt?.getTime() ?? 0;
  const totalCycleDays = cycleStartAt && nextPayday
    ? Math.max(7, Math.ceil((nextPayday.getTime() - cycleStartAt.getTime()) / (3600 * 24 * 1000)))
    : 30;
  const baseWeeklyAllowance = monthlyBudget > 0 ? (monthlyBudget / totalCycleDays) * 7 : 0;

  const daysSinceCycleStart = cycleStartAt
    ? Math.max(0, (today.getTime() - cycleStartAt.getTime()) / (3600 * 24 * 1000))
    : 0;
  const currentWeekIndex = cycleStartAt ? Math.floor(daysSinceCycleStart / 7) : 0;

  // Variable expenses in a half-open interval (fromMs, toMs]
  const getVarExpensesInRange = useMemo(() => (fromMs: number, toMs: number): number => {
    return transactions
      .filter(tx => {
        if (!isVariableExpense(tx)) return false;
        const txTs = tx.created_at
          ? new Date(tx.created_at).getTime()
          : new Date(tx.date.slice(0, 10) + 'T23:59:59').getTime();
        return txTs > fromMs && txTs <= toMs;
      })
      .reduce((sum, tx) => sum + Number(tx.amount), 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, fixedExpCatID]);

  // Rollover = surplus/deficit carried from every completed cycle-week
  const rollovers = useMemo(() => {
    if (!cycleStartAt || currentWeekIndex === 0) return 0;
    let acc = 0;
    for (let w = 0; w < currentWeekIndex; w++) {
      const wFrom = cycleStartMs + w * WEEK_MS;
      const wTo = cycleStartMs + (w + 1) * WEEK_MS;
      acc += baseWeeklyAllowance - getVarExpensesInRange(wFrom, wTo);
    }
    return acc;
  }, [cycleStartAt, cycleStartMs, currentWeekIndex, baseWeeklyAllowance, getVarExpensesInRange]);

  // This week's allowance (base + accumulated rollover from prior weeks)
  const currentWeekAllowance = cycleStartAt ? Math.max(0, baseWeeklyAllowance + rollovers) : 0;

  // Variable expenses in the current cycle-week
  const currentWeekFromMs = cycleStartMs + currentWeekIndex * WEEK_MS;
  const currentWeekToMs = currentWeekFromMs + WEEK_MS;
  const currentWeekVarSpent = cycleStartAt
    ? getVarExpensesInRange(currentWeekFromMs, currentWeekToMs)
    : 0;

  // Variable expenses since cycle start (for "Spent since payday" row)
  const variableSpentSincePayday = cycleStartAt
    ? getVarExpensesInRange(cycleStartMs, Date.now())
    : 0;

  // ── Legacy weekly pacing (non-cycle path) ─────────────────────────────────
  const lastPaydayTs = lastPayday ? lastPayday.getTime() : 0;

  const spentSincePaydayLegacy = transactions
    .filter(tx => {
      if (tx.type !== 'expense' || !tx.date) return false;
      const txTs = tx.created_at
        ? new Date(tx.created_at).getTime()
        : new Date(tx.date.slice(0, 10) + 'T23:59:59').getTime();
      return txTs > lastPaydayTs;
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const daysRemainingLegacy = nextPayday
    ? Math.max(1, Math.ceil((nextPayday.getTime() - today.getTime()) / 86_400_000))
    : 30;
  const weeklyAllowanceLegacy = hasCycle && nextPayday && !cycleStartAt
    ? Math.max(0, (monthlyBudget - spentSincePaydayLegacy) / (daysRemainingLegacy / 7))
    : 0;
  const baseLimitPerWeek = monthlyBudget / 4.3;

  // localStorage lock for legacy pacing
  const currentWeekStartStr = toLocalDateStr((() => {
    const d = new Date(today);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  })());
  const lockKey = `weekly_lock_${user?.id ?? 'anon'}`;
  let lockedAllowanceLegacy = 0;
  if (hasCycle && !cycleStartAt) {
    try {
      const raw = localStorage.getItem(lockKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.weekStart === currentWeekStartStr && typeof parsed.lockedAllowance === 'number') {
          lockedAllowanceLegacy = parsed.lockedAllowance;
        } else {
          lockedAllowanceLegacy = Math.max(0, weeklyAllowanceLegacy);
          localStorage.setItem(lockKey, JSON.stringify({ weekStart: currentWeekStartStr, lockedAllowance: lockedAllowanceLegacy }));
        }
      } else {
        lockedAllowanceLegacy = Math.max(0, weeklyAllowanceLegacy);
        localStorage.setItem(lockKey, JSON.stringify({ weekStart: currentWeekStartStr, lockedAllowance: lockedAllowanceLegacy }));
      }
    } catch {
      lockedAllowanceLegacy = Math.max(0, weeklyAllowanceLegacy);
    }
  }
  const savingsBonusLegacy = Math.max(0, lockedAllowanceLegacy - baseLimitPerWeek);

  // Legacy calendar-week spending (Mon-Sun)
  const weekStart = (() => {
    const d = new Date(today);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  const weekSpentLegacy = transactions
    .filter(tx => {
      if (tx.type !== 'expense') return false;
      const d = safeParseDate(tx.date);
      return d !== null && d >= weekStart && d <= weekEnd;
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  // ── Unified display values ────────────────────────────────────────────────
  const displaySpentSincePayday = cycleStartAt ? variableSpentSincePayday : spentSincePaydayLegacy;
  const displayCanSpend = cycleStartAt ? currentWeekAllowance : lockedAllowanceLegacy;
  const displayThisWeek = cycleStartAt ? currentWeekVarSpent : weekSpentLegacy;
  const isOver = hasCycle && displayThisWeek > displayCanSpend;
  const pct = displayCanSpend > 0 ? Math.min((displayThisWeek / displayCanSpend) * 100, 100) : 0;
  const barColor = !hasCycle ? '#94a3b8' : isOver ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#38bdf8';

  // Delta: today's variable spend vs daily baseline
  const spentToday = transactions
    .filter(tx => isVariableExpense(tx) && tx.date?.slice(0, 10) === todayStr)
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const dailyBaseline = displayCanSpend / 7;
  const deltaDirection: 'up' | 'down' | 'neutral' =
    !hasCycle || displayCanSpend === 0 ? 'neutral'
    : spentToday < dailyBaseline - 0.01 ? 'up'
    : spentToday > dailyBaseline + 0.01 ? 'down'
    : 'neutral';

  const daysRemaining = nextPayday
    ? Math.max(1, Math.ceil((nextPayday.getTime() - today.getTime()) / 86_400_000))
    : daysRemainingLegacy;
  const isPaydayToday = nextPayday?.toISOString().slice(0, 10) === todayStr;
  const nextPaydayDisplay = nextPayday
    ? nextPayday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  const nextPaydayStr = nextPayday ? nextPayday.toISOString().slice(0, 10) : '';

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openPaydayPicker = () => {
    const defaultNext = new Date(today);
    defaultNext.setMonth(defaultNext.getMonth() + 1);
    setPendingDate(nextPaydayStr || defaultNext.toISOString().slice(0, 10));
    setEditingPayday(true);
  };

  const handleSave = async () => {
    if (!pendingDate) return;
    await saveSettings({ ...settings, manualNextPayday: pendingDate });
    if (onCycleReset) onCycleReset();
    setEditingPayday(false);
  };

  const handleCyclePaydaySave = async () => {
    if (!pendingDate) return;
    setPaydayEditError('');
    try {
      await axiosInstance.patch('/salary-cycle/current', { next_payday: pendingDate });
      await refreshCycle();
      setEditingPayday(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })
        ?.response?.data?.error ?? 'Failed to update payday';
      setPaydayEditError(msg);
    }
  };

  const handleCancel = () => { setEditingPayday(false); setPendingDate(''); setPaydayEditError(''); };

  useEffect(() => {
    if (!showInsight) return;
    const onClickOutside = (e: MouseEvent) => {
      if (insightRef.current && !insightRef.current.contains(e.target as Node)) setShowInsight(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowInsight(false); };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showInsight]);

  return (
    <div className="weekly-budget-card">
      <div className="weekly-budget-header">
        <div className="weekly-budget-icon"><CalendarDays size={22} /></div>
        <span className="weekly-budget-title">{t('dashboard.weekly_budget')}</span>
      </div>

      {isPaydayToday && (
        <p className="weekly-budget-payday-today">{t('dashboard.weekly_payday_today')}</p>
      )}

      {hasCycle ? (
        <>
          <div className="weekly-budget-body">

            {/* Row 1: Net discretionary budget (50/30 portion minus fixed) */}
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_budget_limit')}</span>
              <span className="weekly-budget-stat-value">{formatAmount(monthlyBudget)}</span>
            </div>

            {/* Row 2: Variable expenses only since cycle start */}
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_spent_since')}</span>
              <span
                className="weekly-budget-stat-value"
                style={{ color: displaySpentSincePayday > monthlyBudget ? '#ef4444' : 'var(--color-expense-text)' }}
              >
                {formatAmount(displaySpentSincePayday)}
              </span>
            </div>

            {/* Row 3: Rolling weekly allowance (Можно потратить) */}
            <div className="weekly-budget-stat" style={{ position: 'relative' }}>
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_can_spend')}</span>
              <div className="budget-can-spend-row">
                <span
                  className="weekly-budget-stat-value"
                  style={{ color: isOver ? '#ef4444' : 'var(--color-text-heading)' }}
                >
                  {formatAmount(displayCanSpend)}
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

              {!cycleStartAt && savingsBonusLegacy > 0.01 && (
                <span className="weekly-budget-bonus-label">
                  +{formatAmount(savingsBonusLegacy)} ({t('dashboard.weekly_savings_bonus')})
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
                          remaining: formatAmount(monthlyBudget - displaySpentSincePayday),
                          days: daysRemaining,
                          daily: formatAmount(dailyBaseline),
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

            {/* Row 4: Variable spent this cycle-week */}
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_spent')}</span>
              <span
                className="weekly-budget-stat-value"
                style={{ color: isOver ? '#ef4444' : 'var(--color-expense-text)' }}
              >
                {formatAmount(displayThisWeek)}
              </span>
            </div>
          </div>

          {/* Progress bar: this-week variable spend / week allowance */}
          <div className="weekly-budget-bar-track">
            <div className="weekly-budget-bar-fill" style={{ width: `${pct}%`, background: barColor }} />
          </div>
        </>
      ) : (
        <div className="weekly-budget-no-cycle">
          <p className="weekly-budget-no-cycle-text">{t('dashboard.weekly_no_cycle')}</p>
        </div>
      )}

      {/* Footer: next payday display / inline edit */}
      <div className="weekly-budget-footer">
        {editingPayday ? (
          <div className="weekly-budget-payday-form">
            <input
              type="date"
              className="weekly-budget-date-input"
              value={pendingDate}
              min={tomorrowStr}
              onChange={e => { setPendingDate(e.target.value); setPaydayEditError(''); }}
            />
            <button
              className="weekly-budget-action-btn weekly-budget-action-btn--save"
              onClick={cycleStartAt ? handleCyclePaydaySave : handleSave}
            >
              {t('dashboard.weekly_save')}
            </button>
            <button className="weekly-budget-action-btn weekly-budget-action-btn--cancel" onClick={handleCancel}>
              {t('dashboard.weekly_cancel')}
            </button>
            {paydayEditError && <span className="wbc-payday-error">{paydayEditError}</span>}
          </div>
        ) : cycleStartAt ? (
          nextPayday ? (
            <div className="weekly-budget-payday-info">
              <span className="weekly-budget-payday-label">{t('dashboard.weekly_next_payday_label')}:</span>
              <span className="weekly-budget-payday-date">{nextPaydayDisplay}</span>
              <button
                className="wbc-edit-payday-btn"
                onClick={openPaydayPicker}
                title={t('dashboard.weekly_edit_payday')}
                type="button"
              >
                <Pencil size={12} />
              </button>
              <span className="weekly-budget-days-left">
                ({t('dashboard.weekly_days_left', { days: daysRemaining })})
              </span>
            </div>
          ) : (
            <button className="wbc-set-payday-btn" onClick={openPaydayPicker} type="button">
              + {t('dashboard.weekly_set_next_payday')}
            </button>
          )
        ) : (
          nextPayday && (
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
          )
        )}
      </div>
    </div>
  );
};

export default WeeklyBudgetCard;
