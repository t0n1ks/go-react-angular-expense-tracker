import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, TrendingUp, TrendingDown, Info, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { computeLegacyWeeklyAllowance, clampCanSpend } from '../utils/budgetMath';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal';
  income_type?: string;
  date: string;
  created_at?: string;
  category?: { id: number; name: string };
}

interface Props {
  transactions: Transaction[];
  monthlyBudget: number;
  formatAmount: (n: number) => string;
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

const WeeklyBudgetCard: React.FC<Props> = ({ transactions, monthlyBudget, formatAmount }) => {
  const { t } = useTranslation();
  const {
    paydayMode, fixedPayday, manualNextPayday, settings, saveSettings,
    currentCycle, cycleStats, budgetWindow,
  } = useSettings();
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const { user } = useAuth();
  const [editingPayday, setEditingPayday] = useState(false);
  const [pendingDate, setPendingDate] = useState('');
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

  // hasCycle: a SalaryCycle is active and the server returned its stats. In that
  // case ALL numbers come from cycleStats (server-authoritative — no client date
  // math). The legacy path below only runs for users without a SalaryCycle.
  const hasCycle = !!(currentCycle && cycleStats);
  const fixedExpCatID = Number(currentCycle?.fixed_exp_category_id ?? 0);

  // ── Next-payday date for display ──────────────────────────────────────────
  let nextPayday: Date | null = null;
  if (hasCycle) {
    nextPayday = currentCycle!.next_payday_at ? new Date(currentCycle!.next_payday_at) : null;
  } else if (paydayMode === 'fixed' && fixedPayday > 0) {
    nextPayday = getFixedPaydayDates(fixedPayday).next;
  } else {
    const parsedNext = safeParseDate(manualNextPayday);
    if (parsedNext) { nextPayday = parsedNext; nextPayday.setHours(0, 0, 0, 0); }
  }

  // ── Legacy pacing (no SalaryCycle) ────────────────────────────────────────
  let legacyLastPayday: Date | null = null;
  if (paydayMode === 'fixed' && fixedPayday > 0) {
    legacyLastPayday = getFixedPaydayDates(fixedPayday).last;
  } else {
    const lastIncomeTx = transactions
      .filter(tx => tx.type === 'income' && (tx.income_type === 'one_time' || !tx.income_type))
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : new Date(a.date).getTime();
        const bTs = b.created_at ? new Date(b.created_at).getTime() : new Date(b.date).getTime();
        return bTs - aTs;
      })[0] ?? null;
    legacyLastPayday = lastIncomeTx
      ? (lastIncomeTx.created_at ? new Date(lastIncomeTx.created_at) : new Date(lastIncomeTx.date + 'T00:00:00'))
      : new Date(today.getFullYear(), today.getMonth(), 1);
  }

  const legacySpentSincePayday = transactions
    .filter(tx => {
      if (tx.type !== 'expense' || !tx.date) return false;
      const txTs = tx.created_at
        ? new Date(tx.created_at).getTime()
        : new Date(tx.date.slice(0, 10) + 'T23:59:59').getTime();
      return txTs > (legacyLastPayday ? legacyLastPayday.getTime() : 0);
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const daysRemainingLegacy = nextPayday
    ? Math.max(1, Math.ceil((nextPayday.getTime() - today.getTime()) / 86_400_000))
    : 30;
  // Even-pace one-week share of the REMAINING budget, hard-bounded by what's
  // actually left (see computeLegacyWeeklyAllowance). Replaces the old
  // ÷(daysRemaining/7) formula that multiplied the remainder by up to 7×.
  const weeklyAllowanceLegacy = !hasCycle && nextPayday
    ? computeLegacyWeeklyAllowance({
        monthlyBudget,
        spentSincePayday: legacySpentSincePayday,
        daysRemaining: daysRemainingLegacy,
      })
    : 0;

  const currentWeekStartStr = toLocalDateStr((() => {
    const d = new Date(today);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  })());
  // v2: versioned key so any stale v1 lock holding a pre-fix inflated allowance
  // is abandoned (never read) on first load of the fixed build.
  const lockKey = `weekly_lock_v2_${user?.id ?? 'anon'}`;
  let lockedAllowanceLegacy = 0;
  if (!hasCycle && nextPayday) {
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
  // Priority: (1) salary cycle → server cycle stats (unchanged); (2) no cycle
  // but a monthly goal is set → server budget window (GET /api/budget/current,
  // safe & capped server-side); (3) fallback → the Phase-1 client math, used
  // only when the budget endpoint is unavailable, so nothing breaks offline.
  const hasServerBudget = !hasCycle && !!budgetWindow?.has_goal;
  // A no-cycle user who has not set (or auto-generated) a monthly limit yet.
  const needsBudgetSetup = !hasCycle && !!budgetWindow && !budgetWindow.has_goal;

  let displayLimit: number;
  let displaySpentSincePayday: number;
  let displayCanSpend: number;
  let displayThisWeek: number;
  let daysRemaining: number;
  if (hasCycle) {
    // Use variable_allowance if available (new field), else net_discretionary_budget.
    displayLimit = cycleStats!.variable_allowance ?? cycleStats!.net_discretionary_budget;
    displaySpentSincePayday = cycleStats!.cycle_variable_expenses;
    displayCanSpend = cycleStats!.current_week_allowance;
    displayThisWeek = cycleStats!.current_week_spent;
    daysRemaining = cycleStats!.days_remaining;
  } else if (hasServerBudget) {
    displayLimit = budgetWindow!.monthly_budget;
    displaySpentSincePayday = budgetWindow!.spent_this_window;
    displayCanSpend = budgetWindow!.current_week_allowance;
    displayThisWeek = budgetWindow!.current_week_spent;
    daysRemaining = budgetWindow!.days_remaining;
  } else {
    displayLimit = monthlyBudget;
    displaySpentSincePayday = legacySpentSincePayday;
    // Guardrail: even a persisted weekly lock can never authorise spending more
    // than the budget still remaining in the period.
    displayCanSpend = clampCanSpend(lockedAllowanceLegacy, monthlyBudget, legacySpentSincePayday);
    displayThisWeek = weekSpentLegacy;
    daysRemaining = daysRemainingLegacy;
  }
  const showCard = hasCycle || hasServerBudget || nextPayday !== null;

  const isOver = showCard && displayThisWeek > displayCanSpend;
  const pct = displayCanSpend > 0 ? Math.min((displayThisWeek / displayCanSpend) * 100, 100) : 0;

  // ── 3-tier semantic zone (drives dynamic number + progress-bar colors) ─────
  // Safe 0–70% · Warning 70–90% · Danger 90%+, over budget, or no allowance left.
  const consumedRatio = displayCanSpend > 0
    ? displayThisWeek / displayCanSpend
    : (displayThisWeek > 0 ? 1 : 0);
  const budgetZone: 'safe' | 'warning' | 'danger' =
    !showCard ? 'safe'
    : isOver || displayCanSpend <= 0 || consumedRatio >= 0.9 ? 'danger'
    : consumedRatio >= 0.7 ? 'warning'
    : 'safe';

  // The dynamic numbers ("Можно потратить" / "Потрачено") share the zone color.
  // Safe → crisp readable heading white so the card isn't a wall of red.
  const zoneTextColor =
    budgetZone === 'danger' ? '#ef4444'
    : budgetZone === 'warning' ? '#f59e0b'
    : 'var(--color-text-heading)';
  const barColor = !showCard
    ? '#94a3b8'
    : budgetZone === 'danger' ? '#ef4444'
    : budgetZone === 'warning' ? '#f59e0b'
    : '#38bdf8';

  // Today's variable spend vs daily baseline — a small display nicety (delta arrow).
  const spentToday = transactions
    .filter(tx => {
      if (tx.type !== 'expense') return false;
      if (fixedExpCatID > 0 && Number(tx.category?.id) === fixedExpCatID) return false;
      return tx.date?.slice(0, 10) === todayStr;
    })
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const dailyBaseline = displayCanSpend / 7;
  const deltaDirection: 'up' | 'down' | 'neutral' =
    !showCard || displayCanSpend === 0 ? 'neutral'
    : spentToday < dailyBaseline - 0.01 ? 'up'
    : spentToday > dailyBaseline + 0.01 ? 'down'
    : 'neutral';

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
    setEditingPayday(false);
  };

  // No-salary budget setup / edit: persist a monthly spending limit. saveSettings
  // re-fetches the server budget window so the card updates immediately.
  const applyMonthlyBudget = async (amount: number) => {
    if (!(amount > 0) || savingBudget) return;
    setSavingBudget(true);
    try {
      await saveSettings({ ...settings, monthlySpendingGoal: Math.round(amount * 100) / 100 });
      setBudgetInput('');
      setEditingBudget(false);
    } finally {
      setSavingBudget(false);
    }
  };

  // Open the inline editor pre-filled with the current limit so a user can
  // freely CHANGE it after it's been set (the missing control this fixes).
  const openBudgetEdit = () => {
    setBudgetInput(String(budgetWindow?.monthly_budget ?? ''));
    setEditingBudget(true);
  };
  const cancelBudgetEdit = () => { setEditingBudget(false); setBudgetInput(''); };

  const handleCancel = () => {
    setEditingPayday(false);
    setPendingDate('');
  };

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

      {showCard ? (
        <>
          <div className="weekly-budget-body">

            {/* Row 1: Net discretionary budget (50/30 portion minus fixed).
                For the no-salary server budget it's the editable monthly limit. */}
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">{t('dashboard.weekly_budget_limit')}</span>
              {hasServerBudget && editingBudget ? (
                <span className="weekly-budget-limit-edit">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    className="weekly-budget-setup-input"
                    value={budgetInput}
                    onChange={e => setBudgetInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') applyMonthlyBudget(parseFloat(budgetInput));
                      if (e.key === 'Escape') cancelBudgetEdit();
                    }}
                    disabled={savingBudget}
                    autoFocus
                  />
                  <button
                    className="weekly-budget-action-btn weekly-budget-action-btn--save"
                    onClick={() => applyMonthlyBudget(parseFloat(budgetInput))}
                    disabled={savingBudget || !(parseFloat(budgetInput) > 0)}
                    type="button"
                  >
                    {t('dashboard.weekly_save')}
                  </button>
                  <button
                    className="weekly-budget-action-btn weekly-budget-action-btn--cancel"
                    onClick={cancelBudgetEdit}
                    type="button"
                  >
                    {t('dashboard.weekly_cancel')}
                  </button>
                </span>
              ) : (
                <span className="weekly-budget-stat-value">
                  {formatAmount(displayLimit)}
                  {hasServerBudget && (
                    <button
                      className="wbc-edit-payday-btn"
                      onClick={openBudgetEdit}
                      title={t('dashboard.budget_edit_limit')}
                      type="button"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </span>
              )}
            </div>

            {/* Row 2: variable spend so far. No-salary users have no payday, so
                the window is the calendar month → "Spent this month". */}
            <div className="weekly-budget-stat">
              <span className="weekly-budget-stat-label">
                {t(hasServerBudget ? 'dashboard.weekly_spent_month' : 'dashboard.weekly_spent_since')}
              </span>
              <span
                className="weekly-budget-stat-value"
                style={{ color: displaySpentSincePayday > displayLimit ? '#ef4444' : 'var(--color-text-heading)' }}
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
                  style={{ color: zoneTextColor }}
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
                          remaining: formatAmount(Math.max(0, displayLimit - displaySpentSincePayday)),
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
                style={{ color: zoneTextColor }}
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
      ) : needsBudgetSetup ? (
        <div className="weekly-budget-setup">
          <p className="weekly-budget-setup-text">{t('dashboard.budget_setup_prompt')}</p>
          <div className="weekly-budget-setup-form">
            <input
              type="number"
              inputMode="decimal"
              min="1"
              className="weekly-budget-setup-input"
              placeholder={t('dashboard.budget_setup_placeholder')}
              value={budgetInput}
              onChange={e => setBudgetInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyMonthlyBudget(parseFloat(budgetInput)); }}
              disabled={savingBudget}
            />
            <button
              className="weekly-budget-action-btn weekly-budget-action-btn--save"
              onClick={() => applyMonthlyBudget(parseFloat(budgetInput))}
              disabled={savingBudget || !(parseFloat(budgetInput) > 0)}
              type="button"
            >
              {t('dashboard.weekly_save')}
            </button>
          </div>
          <button
            className="weekly-budget-autogen-btn"
            onClick={() => applyMonthlyBudget(budgetWindow!.default_goal)}
            disabled={savingBudget}
            type="button"
          >
            {t('dashboard.budget_setup_autogen', { amount: formatAmount(budgetWindow!.default_goal) })}
          </button>
        </div>
      ) : (
        <div className="weekly-budget-no-cycle">
          <p className="weekly-budget-no-cycle-text">{t('dashboard.weekly_no_cycle')}</p>
        </div>
      )}

      {/* Footer: next payday display / inline edit. Hidden for no-salary users —
          they have no payday, so there is no row (and no empty space) to show. */}
      {!hasServerBudget && (
      <div className="weekly-budget-footer">
        {editingPayday ? (
          /* Legacy (no-cycle, smart-mode) manual payday setter. Salary-cycle
             end-date editing now lives in the salary-cycle card. */
          <div className="weekly-budget-payday-form">
            <div className="weekly-budget-payday-controls">
              <input
                type="date"
                className="weekly-budget-date-input"
                value={pendingDate}
                min={tomorrowStr}
                onChange={e => setPendingDate(e.target.value)}
              />
              <button
                className="weekly-budget-action-btn weekly-budget-action-btn--save"
                onClick={handleSave}
                type="button"
              >
                {t('dashboard.weekly_save')}
              </button>
              <button className="weekly-budget-action-btn weekly-budget-action-btn--cancel" onClick={handleCancel} type="button">
                {t('dashboard.weekly_cancel')}
              </button>
            </div>
          </div>
        ) : hasCycle ? (
          /* Read-only for salaried users — edit the end date in the cycle card. */
          nextPayday && (
            <div className="weekly-budget-payday-info">
              <span className="weekly-budget-payday-label">{t('dashboard.weekly_next_payday_label')}:</span>
              <span className="weekly-budget-payday-date">{nextPaydayDisplay}</span>
              <span className="weekly-budget-days-left">
                ({t('dashboard.weekly_days_left', { days: daysRemaining })})
              </span>
            </div>
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
      )}
    </div>
  );
};

export default WeeklyBudgetCard;
