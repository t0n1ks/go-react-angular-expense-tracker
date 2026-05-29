import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings, type SalaryCycle, type CycleStats } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, Target, PiggyBank, Plus, Banknote } from 'lucide-react';
import TamagotchiWidget from '../components/TamagotchiWidget';
import WeeklyBudgetCard from '../components/WeeklyBudgetCard';
import SalaryCycleCard from '../components/SalaryCycleCard';
import IncomeHistoryModal from '../components/IncomeHistoryModal';
import ExpensesHistoryModal from '../components/ExpensesHistoryModal';
import SavingsHistoryModal from '../components/SavingsHistoryModal';
import AddIncomeModal from '../components/AddIncomeModal';
import { useAIAssistant } from '../hooks/useAIAssistant';
import './Dashboard.css';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
  created_at?: string;
  category?: { id: number; name: string };
}

const Dashboard: React.FC = () => {
  const { axiosInstance } = useAuth();
  const {
    formatAmount,
    currencySymbol,
    aiAdviceEnabled,
    monthlySpendingGoal,
    expectedSalary,
    currentCycle,
    cycleStats: serverCycleStats,
    refreshCycle,
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
  const [aiData, setAIData] = useState<{ tamagotchi_mood: string; predicted_savings_balance?: number } | null>(null);
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
  useEffect(() => {
    axiosInstance.post(`/ai/analyze?language=${analyzeLang}`)
      .then((res: { data: { tamagotchi_mood: string; predicted_savings_balance?: number } }) => setAIData(res.data))
      .catch(() => {});
  }, [axiosInstance, analyzeLang]);

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
      axiosInstance.post(`/ai/analyze?language=${analyzeLang}`)
        .then((res: { data: { tamagotchi_mood: string; predicted_savings_balance?: number } }) => setAIData(res.data))
        .catch(() => {});
    }
    prevModeRef.current = aiServiceMode;
  }, [aiServiceMode, axiosInstance, analyzeLang]);

  // ── Server-authoritative cycle aggregation ────────────────────────────────
  const hasCycle = !!(currentCycle && cycleStats);
  const fixedExpCatID = Number(currentCycle?.fixed_exp_category_id ?? 0);

  const legacyIncome = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount), 0);
  const legacyExpense = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount), 0);

  const cycleIncome        = hasCycle ? cycleStats!.cycle_income        : legacyIncome;
  const cycleExpenses      = hasCycle ? cycleStats!.cycle_expenses      : legacyExpense;
  const cycleFixedExpenses = hasCycle ? cycleStats!.cycle_fixed_expenses : 0;
  const cycleVariableExpenses = hasCycle ? cycleStats!.cycle_variable_expenses : Math.max(0, legacyExpense);

  // Variable Allowance = income − savings_allocation − fixed_expenses (server-computed).
  // For non-cycle users it falls back to the legacy balance.
  const variableAllowance = hasCycle ? (cycleStats!.variable_allowance ?? cycleStats!.net_discretionary_budget) : (legacyIncome - legacyExpense);
  const dynamicSavings    = hasCycle ? (cycleStats!.dynamic_savings ?? 0) : 0;
  const savedMoneyBalance = hasCycle ? (cycleStats!.saved_money_balance ?? 0) : 0;

  // ── Budget Health: (Variable Allowance - Variable Spent) / Variable Allowance ──
  const budgetMax       = variableAllowance;
  const budgetRemaining = Math.max(0, variableAllowance - cycleVariableExpenses);
  const budgetPercent   = budgetMax > 0 ? (cycleVariableExpenses / budgetMax) * 100 : 0;
  const budgetBarColor  = budgetPercent >= 100 ? '#ef4444' : budgetPercent >= 80 ? '#f59e0b' : '#38bdf8';

  // ── Income progress (no-cycle only) ──────────────────────────────────────
  const salaryRef    = currentCycle ? currentCycle.total_income : expectedSalary;
  const incomePercent = salaryRef > 0 ? Math.min((cycleIncome / salaryRef) * 100, 100) : 0;
  const incomeOver    = salaryRef > 0 && cycleIncome >= salaryRef;

  const { heartsCount } = useSettings();

  const { message, dismiss, animationHint } = useAIAssistant({
    transactions,
    aiAdviceEnabled,
    monthlySpendingGoal,
    currencySymbol,
    axiosInstance,
    language: analyzeLang,
    aiServiceMode,
  });

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
  }, [fetchData, refreshCycle]);

  if (loading) return <div className="dashboard-wrapper">{t('dashboard.loading')}</div>;

  return (
    <div className="dashboard-wrapper">
      <h1 className="dashboard-title">{t('dashboard.title')}</h1>

      <SalaryCycleCard onCycleStarted={handleCycleStarted} />

      {/* ── No-active-cycle fallback ─────────────────────────────────────── */}
      {!loading && currentCycle === null && (
        <div className="no-cycle-card">
          <div className="no-cycle-icon-wrap">
            <Banknote size={36} />
          </div>
          <h2 className="no-cycle-title">{t('dashboard.no_cycle_title')}</h2>
          <p className="no-cycle-desc">{t('dashboard.no_cycle_desc')}</p>
        </div>
      )}

      {/* ── Stats grid — only when a cycle exists ────────────────────────── */}
      {currentCycle !== null && <div className="stats-grid">

        {/* Card 1: Variable Allowance (formerly "Current Balance") */}
        <div className="stat-card">
          <div className="stat-icon wallet"><Wallet size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.variable_allowance')}</p>
            <p className="value">{formatAmount(variableAllowance)}</p>
            <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
          </div>
        </div>

        {/* Card 2: Saved money (click → SavingsHistoryModal) — cycle only */}
        {hasCycle && (
          <div
            className="stat-card stat-card--clickable"
            onClick={() => setShowSavingsModal(true)}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setShowSavingsModal(true)}
            title={t('dashboard.saved_money')}
          >
            <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
              <PiggyBank size={24}/>
            </div>
            <div className="stat-content">
              <p className="label">{t('dashboard.saved_money')}</p>
              <p className="value" style={{ color: '#10b981' }}>{formatAmount(dynamicSavings)}</p>
              {savedMoneyBalance > 0 && (
                <p className="income-breakdown">
                  {t('dashboard.savings_pool_total')}: {formatAmount(savedMoneyBalance)}
                </p>
              )}
              <p className="stat-sublabel">{t('salary_cycle.savings_pool')}</p>
            </div>
          </div>
        )}

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
        {(budgetMax > 0 || monthlySpendingGoal > 0) && (
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
        )}
      </div>}

      {(monthlySpendingGoal > 0 || currentCycle) && (
        <WeeklyBudgetCard
          transactions={transactions}
          monthlyBudget={monthlySpendingGoal}
          formatAmount={formatAmount}
        />
      )}

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
          }}
        />
      )}
      {showAddIncomeModal && (
        <AddIncomeModal
          onClose={() => setShowAddIncomeModal(false)}
          onSuccess={handleIncomeAdded}
        />
      )}

      <TamagotchiWidget
        message={message}
        onDismiss={dismiss}
        mood={aiData?.tamagotchi_mood}
        animationHint={animationHint}
        heartsCount={heartsCount}
        aiServiceMode={aiServiceMode}
        savingsBalance={aiData?.predicted_savings_balance}
      />
    </div>
  );
};

export default Dashboard;
