import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings, type SalaryCycle, type CycleStats } from '../context/SettingsContext';
import { txEventTime } from '../utils/categoryWindow';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, Target, PiggyBank, Plus } from 'lucide-react';
import TamagotchiWidget from '../components/TamagotchiWidget';
import WeeklyBudgetCard from '../components/WeeklyBudgetCard';
import SalaryCycleCard from '../components/SalaryCycleCard';
import IncomeHistoryModal from '../components/IncomeHistoryModal';
import ExpensesHistoryModal from '../components/ExpensesHistoryModal';
import SavingsHistoryModal from '../components/SavingsHistoryModal';
import AddIncomeModal from '../components/AddIncomeModal';
import { useAIAssistant } from '../hooks/useAIAssistant';
import { useCompanion } from '../hooks/useCompanion';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { healthChangeText, messageText, reasonText } from '../utils/companion';
import './Dashboard.css';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal' | 'budget_transfer';
  income_type?: string;
  date: string;
  created_at?: string;
  effective_at?: string;
  category?: { id: number; name: string };
}

// Wide desktop: the stats grid has 3 columns and a free 6th cell directly
// under Income, which the companion's cosmos screen takes. Keep in sync with
// the matching media query in Dashboard.css.
const COSMOS_IN_GRID_QUERY = '(min-width: 1272px)';

const Dashboard: React.FC = () => {
  const wideDesktop = useMediaQuery(COSMOS_IN_GRID_QUERY);
  const { axiosInstance, user } = useAuth();
  const {
    formatAmount,
    aiAdviceEnabled,
    monthlySpendingGoal,
    expectedSalary,
    currentCycle,
    cycleStats: serverCycleStats,
    cycleWindow,
    refreshCycle,
    liteMode,
    budgetWindow,
  } = useSettings();
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showExpensesModal, setShowExpensesModal] = useState(false);
  const [showSavingsModal, setShowSavingsModal] = useState(false);
  const [showAddIncomeModal, setShowAddIncomeModal] = useState(false);
  // Optimistically update cycleStats after addIncome, before the next refresh
  const [localCycleStats, setLocalCycleStats] = useState<CycleStats | null>(null);
  const [aiServiceMode, setAIServiceMode] = useState<'online' | 'autonomous' | 'initializing'>('initializing');

  // Use locally-patched stats if available, else server stats
  const cycleStats = localCycleStats ?? serverCycleStats;

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/transactions');
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const analyzeLang = i18n.resolvedLanguage ?? 'en';

  // Re-run AI analysis after a mutation so the AI service's per-user learner
  // and visit history stay current. The UFO's mood no longer comes from here:
  // the companion engine (Go) drives health and mood.
  const runAnalyze = useCallback(() => {
    axiosInstance.post(`/ai/analyze?language=${analyzeLang}`).catch(() => {});
  }, [axiosInstance, analyzeLang]);

  useEffect(() => { runAnalyze(); }, [runAnalyze]);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const checkStatus = () => {
      axiosInstance.get('/ai/status')
        .then((res: { data: { mode: string } }) => {
          const mode = res.data.mode;
          if (mode === 'online') setAIServiceMode('online');
          else if (mode === 'autonomous') { setAIServiceMode('autonomous'); timerId = setTimeout(checkStatus, 5_000); }
          else timerId = setTimeout(checkStatus, 10_000);
        })
        .catch(() => { timerId = setTimeout(checkStatus, 15_000); });
    };
    checkStatus();
    return () => clearTimeout(timerId);
  }, [axiosInstance]);

  const prevModeRef = useRef<'online' | 'autonomous' | 'initializing'>('initializing');
  useEffect(() => {
    if (prevModeRef.current !== 'online' && aiServiceMode === 'online') {
      runAnalyze();
    }
    prevModeRef.current = aiServiceMode;
  }, [aiServiceMode, runAnalyze]);

  // ── Server-authoritative cycle aggregation ────────────────────────────────
  const hasCycle = !!(currentCycle && cycleStats);
  const fixedExpCatID = Number(currentCycle?.fixed_exp_category_id ?? 0);

  const savingsCatId = currentCycle?.saved_money_category_id ?? 0;
  // When a cycle exists (active OR stopped), scope the client-side fallback to
  // that cycle's own window — exactly as the server reports it, with each
  // transaction placed by its server effective_at. Otherwise stopping a cycle
  // would flip these figures to an ALL-TIME sum (inflating "Income" for
  // multi-cycle users). No cycle at all → all-time, as before.
  const inCycleWindow = (tx: Transaction): boolean => {
    if (!cycleWindow) return true;
    const ev = txEventTime(tx).getTime();
    if (ev < new Date(cycleWindow.start).getTime()) return false;
    if (cycleWindow.end && ev >= new Date(cycleWindow.end).getTime()) return false;
    return true;
  };
  const legacyIncome = transactions
    .filter(t => t.type === 'income' && !(savingsCatId > 0 && Number(t.category?.id) === savingsCatId) && inCycleWindow(t))
    .reduce((acc, t) => acc + Number(t.amount), 0);
  const legacyExpense = transactions
    .filter(t => t.type === 'expense' && inCycleWindow(t))
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const cycleIncome        = hasCycle ? cycleStats!.cycle_income        : legacyIncome;
  const cycleExpenses      = hasCycle ? cycleStats!.cycle_expenses      : legacyExpense;
  const cycleFixedExpenses = hasCycle ? cycleStats!.cycle_fixed_expenses : 0;
  const cycleVariableExpenses = hasCycle ? cycleStats!.cycle_variable_expenses : Math.max(0, legacyExpense);

  // Variable Allowance = income − savings_allocation − fixed_expenses (server-computed).
  // For non-cycle users it falls back to the legacy balance.
  const variableAllowance = hasCycle ? (cycleStats!.variable_allowance ?? cycleStats!.net_discretionary_budget) : (legacyIncome - legacyExpense);
  const dynamicSavings    = hasCycle ? (cycleStats!.dynamic_savings ?? 0) : 0;
  const savedMoneyBalance = hasCycle ? (cycleStats!.saved_money_balance ?? 0) : 0;
  // Carry-over from the previous cycle — already part of variableAllowance;
  // shown so a higher-than-base budget is never a mystery.
  const carryOver        = hasCycle ? (cycleStats!.carry_over ?? 0) : 0;
  const carryMoved       = hasCycle ? (cycleStats!.carry_over_to_savings ?? 0) : 0;
  const carryMovable     = hasCycle ? (cycleStats!.carry_over_movable ?? 0) : 0;

  // ── Budget Health: (Variable Allowance - Variable Spent) / Variable Allowance ──
  const budgetMax       = variableAllowance;
  const budgetRemaining = Math.max(0, variableAllowance - cycleVariableExpenses);
  const budgetPercent   = budgetMax > 0 ? (cycleVariableExpenses / budgetMax) * 100 : 0;
  const budgetBarColor  = budgetPercent >= 100 ? '#ef4444' : budgetPercent >= 80 ? '#f59e0b' : '#38bdf8';

  // ── Income progress (no-cycle only) ──────────────────────────────────────
  const salaryRef    = currentCycle ? currentCycle.total_income : expectedSalary;
  const incomePercent = salaryRef > 0 ? Math.min((cycleIncome / salaryRef) * 100, 100) : 0;
  const incomeOver    = salaryRef > 0 && cycleIncome >= salaryRef;

  const { message: ambientMessage, dismiss: dismissAmbient, animationHint } = useAIAssistant({
    aiAdviceEnabled,
    axiosInstance,
    language: analyzeLang,
    aiServiceMode,
  });

  // ── Companion: health, mood and contextual messages (server-decided) ─────
  // Refreshed when the figures change so "just happened" reactions are prompt.
  const companionRefreshKey = `${cycleStats?.cycle_variable_expenses}|${cycleStats?.cycle_income}|${cycleStats?.saved_money_balance}|${budgetWindow?.spent_this_window}|${transactions.length}`;
  const companion = useCompanion({ axiosInstance, language: analyzeLang, refreshKey: companionRefreshKey });
  const companionText = companion.message && aiAdviceEnabled
    ? messageText(companion.message, t, formatAmount, analyzeLang)
    : null;
  const companionReason = companion.state ? reasonText(companion.state.reason, t, formatAmount, analyzeLang) : '';

  // Health dropped since this viewer last saw it → say why, once.
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const companionHealth = companion.state?.health;
  useEffect(() => {
    if (companionHealth === undefined || !user?.id) return;
    const key = `tama_health_seen_${user.id}`;
    let previous: number | null = null;
    try {
      const raw = localStorage.getItem(key);
      previous = raw === null ? null : Number(raw);
    } catch { /* storage unavailable — no note */ }
    if (previous !== null && Number.isFinite(previous) && companionHealth < previous - 0.5) {
      setHealthNote(healthChangeText(companionHealth, previous, companionReason, t));
    }
    try { localStorage.setItem(key, String(companionHealth)); } catch { /* ignore */ }
  // Only a new health value matters; the reason text follows it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companionHealth, user?.id]);

  // A companion message (with 👍 / 👎 / neutral ✕) takes the bubble first.
  const shownMessage = companionText ?? ambientMessage;

  const handleCycleStarted = useCallback((_cycle: SalaryCycle) => {
    setLocalCycleStats(null);
    fetchData();
    refreshCycle();
  }, [fetchData, refreshCycle]);

  const handleCycleDeleted = useCallback(() => {
    setShowIncomeModal(false);
    setShowExpensesModal(false);
    setLocalCycleStats(null);
    fetchData();
    refreshCycle();
  }, [fetchData, refreshCycle]);

  const handleIncomeAdded = useCallback((updatedStats: CycleStats) => {
    setLocalCycleStats(updatedStats);
    // Full refresh in background to sync all data
    fetchData();
    refreshCycle().then(() => setLocalCycleStats(null));
    runAnalyze(); // real-time AI prediction refresh
  }, [fetchData, refreshCycle, runAnalyze]);

  // Move the carried-over budget into savings (server applies the whole-unit
  // rule: whole euros move, cents stay spendable).
  const [movingCarry, setMovingCarry] = useState(false);
  const moveCarryOverToSavings = useCallback(async () => {
    setMovingCarry(true);
    try {
      const res = await axiosInstance.post('/salary-cycle/carry-over/savings');
      handleIncomeAdded(res.data.cycle_stats);
    } catch {
      refreshCycle(); // e.g. nothing left to move — resync the figures
    } finally {
      setMovingCarry(false);
    }
  }, [axiosInstance, handleIncomeAdded, refreshCycle]);

  // Lite dashboard is content-short. Tag <body> so the shared layout can fit the
  // actual content instead of reserving full-viewport height (which produced a
  // scrollable empty band below the UFO). Removed when Lite turns off / on leave.
  useEffect(() => {
    if (!liteMode) return;
    document.body.classList.add('dashboard-lite');
    return () => document.body.classList.remove('dashboard-lite');
  }, [liteMode]);

  if (loading) return <div className="dashboard-wrapper">{t('dashboard.loading')}</div>;

  // Lite hides the stats grid, so the companion stays a full-width block there.
  const cosmosInGrid = wideDesktop && !liteMode;
  const companionWidget = (
    <TamagotchiWidget
      message={shownMessage}
      onDismiss={dismissAmbient}
      onMessageAction={companionText ? companion.act : undefined}
      mood={companion.state?.mood}
      animationHint={animationHint}
      aiServiceMode={aiServiceMode}
      health={companion.state?.health}
      reasonText={companionReason}
      healthNote={healthNote}
      questOpen={companion.state?.quest.open ?? false}
      onCatch={companion.catchEntity}
      layout={cosmosInGrid ? 'cell' : 'stack'}
    />
  );

  return (
    <div className={`dashboard-wrapper${liteMode ? ' dashboard-wrapper--lite' : ''}`}>
      <h1 className="dashboard-title">{t('dashboard.title')}</h1>

      {/* Lite mode hides all salary-cycle / analytics cards; only the budget
          card (and the UFO's jokes/facts) remain. Nothing is removed — turning
          Lite off restores everything. */}
      {!liteMode && <SalaryCycleCard onCycleStarted={handleCycleStarted} />}

      {/* ── Stats grid ───────────────────────────────────────────────────── */}
      {!liteMode && (
      <div className="stats-grid">

        {/* Card 1: Variable Allowance (formerly "Current Balance") */}
        <div className="stat-card">
          <div className="stat-icon wallet"><Wallet size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.variable_allowance')}</p>
            <p className="value">{formatAmount(variableAllowance)}</p>
            {carryOver > 0 && (
              <p className="income-breakdown">
                {t('dashboard.carry_over_included', { amount: formatAmount(carryOver) })}
                {carryMoved > 0 && (
                  <span> · {t('dashboard.carry_over_moved', { amount: formatAmount(carryMoved) })}</span>
                )}
              </p>
            )}
            {carryMovable >= 1 && (
              <button
                type="button"
                className="carry-over-move-btn"
                onClick={moveCarryOverToSavings}
                disabled={movingCarry}
                aria-label={t('dashboard.carry_over_move_aria', { amount: formatAmount(carryMovable) })}
              >
                <PiggyBank size={13} aria-hidden="true" />
                {t('dashboard.carry_over_move_btn', { amount: formatAmount(carryMovable) })}
              </button>
            )}
            <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
          </div>
        </div>

        {/* Card 2: Saved money (click → SavingsHistoryModal) */}
        <div
          className={`stat-card${hasCycle ? ' stat-card--clickable' : ''}`}
          onClick={hasCycle ? () => { setShowSavingsModal(true); refreshCycle(); } : undefined}
          role={hasCycle ? 'button' : undefined}
          tabIndex={hasCycle ? 0 : undefined}
          onKeyDown={hasCycle ? (e => e.key === 'Enter' && setShowSavingsModal(true)) : undefined}
          title={t('dashboard.saved_money')}
        >
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
            <PiggyBank size={24}/>
          </div>
          <div className="stat-content">
            <p className="label">{t('dashboard.saved_money')}</p>
            {/* Headline = LIVE remaining pool balance (allocated − withdrawn +
                additions), the same figure Statistics and the savings history
                show. The planned allocation is context, not the balance. */}
            <p className="value" style={{ color: savedMoneyBalance < 0 ? '#ef4444' : '#10b981' }}>
              {savedMoneyBalance < 0 ? '-' : ''}{formatAmount(savedMoneyBalance)}
            </p>
            {dynamicSavings > 0 && (
              <p className="income-breakdown">
                {t('dashboard.savings_planned_this_cycle')}: {formatAmount(dynamicSavings)}
              </p>
            )}
            <p className="stat-sublabel">{t('dashboard.savings_remaining_hint')}</p>
          </div>
        </div>

        {/* Card 3: Income — click → IncomeHistoryModal; + Add Income button */}
        <div
          className="stat-card stat-card--clickable"
          onClick={() => setShowIncomeModal(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setShowIncomeModal(true)}
          title={t('dashboard.income')}
          style={{ position: 'relative' }}
        >
          <div className="stat-icon income"><TrendingUp size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.income')}</p>
            <p className="value-plus">+{formatAmount(cycleIncome)}</p>
            {currentCycle && cycleIncome > 0 && (
              <p className="income-breakdown">
                {t('dashboard.income_salary')}: {formatAmount(currentCycle.base_salary)}
                {currentCycle.bonuses > 0 && (
                  <span> · {t('dashboard.income_bonuses')}: {formatAmount(currentCycle.bonuses)}</span>
                )}
                {cycleIncome - (currentCycle.base_salary + currentCycle.bonuses) > 0.01 && (
                  <span> · {t('dashboard.income_other')}: {formatAmount(cycleIncome - currentCycle.base_salary - currentCycle.bonuses)}</span>
                )}
              </p>
            )}
            {salaryRef > 0 && !currentCycle && (
              <>
                <div className={`progress-track${incomeOver ? ' progress-track--glow' : ''}`}>
                  <div className="progress-fill" style={{ width: `${incomePercent}%`, background: incomeOver ? '#10b981' : '#38bdf8' }} />
                </div>
                <p className="progress-label">{t('dashboard.income_of_expected', { expected: formatAmount(salaryRef) })}</p>
              </>
            )}
            <p className="stat-sublabel">{t('salary_cycle.income_this_cycle')}</p>
          </div>
          {/* Add Income button — only when cycle is active */}
          {hasCycle && (
            <button
              className="stat-card-add-btn"
              onClick={e => { e.stopPropagation(); setShowAddIncomeModal(true); }}
              title={t('dashboard.add_income_title')}
              type="button"
              aria-label={t('dashboard.add_income_title')}
            >
              <Plus size={13} />
            </button>
          )}
        </div>

        {/* Card 4: Expenses — fixed + variable; click → history modal */}
        <div
          className="stat-card stat-card--clickable"
          onClick={() => setShowExpensesModal(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setShowExpensesModal(true)}
          title={t('dashboard.expenses')}
        >
          <div className="stat-icon expense"><TrendingDown size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.expenses')}</p>
            <p className="value-minus">-{formatAmount(cycleExpenses)}</p>
            {currentCycle && cycleFixedExpenses > 0 && (
              <p className="income-breakdown">
                {t('dashboard.expenses_fixed')}: {formatAmount(cycleFixedExpenses)}
                {cycleVariableExpenses > 0 && (
                  <span> · {t('dashboard.expenses_variable')}: {formatAmount(cycleVariableExpenses)}</span>
                )}
              </p>
            )}
            <p className="stat-sublabel">{t('salary_cycle.expenses_this_cycle')}</p>
          </div>
        </div>

        {/* Card 5: Budget Health */}
        <div className="stat-card">
          <div className="stat-icon budget-icon"><Target size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.budget_health')}</p>
            <p className="value" style={{ color: budgetBarColor }}>
              {formatAmount(budgetRemaining)} / {formatAmount(budgetMax)}
            </p>
            <div className="budget-health-bar-track">
              <div className="budget-health-bar-fill" style={{ width: `${Math.min(budgetPercent, 100)}%`, background: budgetBarColor }} />
            </div>
            <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
          </div>
        </div>

        {/* Cell 6 (wide desktop only): the companion, under Income. */}
        {cosmosInGrid && companionWidget}
      </div>
      )}

      {/* Savings Forecast relocated to the Statistics/Analytics section to
          de-duplicate the dashboard (see Statistics.tsx → savings-forecast-card). */}

      <WeeklyBudgetCard
        transactions={transactions}
        monthlyBudget={monthlySpendingGoal}
        formatAmount={formatAmount}
      />

      {showIncomeModal && (
        <IncomeHistoryModal
          transactions={transactions}
          currentCycle={currentCycle}
          formatAmount={formatAmount}
          onClose={() => setShowIncomeModal(false)}
          onCycleDeleted={handleCycleDeleted}
        />
      )}
      {showExpensesModal && (
        <ExpensesHistoryModal
          transactions={transactions}
          currentCycle={currentCycle}
          fixedExpCatID={fixedExpCatID}
          formatAmount={formatAmount}
          onClose={() => setShowExpensesModal(false)}
          onCycleDeleted={handleCycleDeleted}
        />
      )}
      {showSavingsModal && (
        <SavingsHistoryModal
          currentCycle={currentCycle}
          formatAmount={formatAmount}
          savedMoneyBalance={savedMoneyBalance}
          onClose={() => setShowSavingsModal(false)}
          onSaved={stats => {
            setLocalCycleStats(stats);
            refreshCycle().then(() => setLocalCycleStats(null));
            runAnalyze(); // real-time AI prediction refresh
          }}
        />
      )}
      {showAddIncomeModal && (
        <AddIncomeModal
          onClose={() => setShowAddIncomeModal(false)}
          onSuccess={handleIncomeAdded}
        />
      )}

      {!cosmosInGrid && companionWidget}
    </div>
  );
};

export default Dashboard;
