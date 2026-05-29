import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings, type SalaryCycle } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, Target } from 'lucide-react';
import TamagotchiWidget from '../components/TamagotchiWidget';
import WeeklyBudgetCard from '../components/WeeklyBudgetCard';
import SalaryCycleCard from '../components/SalaryCycleCard';
import IncomeHistoryModal from '../components/IncomeHistoryModal';
import ExpensesHistoryModal from '../components/ExpensesHistoryModal';
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
    paydayMode,
    fixedPayday,
    currentCycle,
    refreshCycle,
  } = useSettings();
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showExpensesModal, setShowExpensesModal] = useState(false);
  const [aiData, setAIData] = useState<{ tamagotchi_mood: string; predicted_savings_balance?: number } | null>(null);
  const [aiServiceMode, setAIServiceMode] = useState<'online' | 'autonomous' | 'initializing'>('initializing');

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/transactions');
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch {
      // silent
    } finally {
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
          const mode = (res.data as { mode: string }).mode;
          if (mode === 'online') {
            setAIServiceMode('online');
          } else if (mode === 'autonomous') {
            setAIServiceMode('autonomous');
            timerId = setTimeout(checkStatus, 5_000);
          } else {
            timerId = setTimeout(checkStatus, 10_000);
          }
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

  // ── Cycle start timestamp ─────────────────────────────────────────────────
  // If a SalaryCycle exists, use its precise cycle_start_at as the cutoff.
  // Fall back to the legacy smart/fixed payday logic so old users see no change.
  const cycleStart: Date = (() => {
    if (currentCycle?.cycle_start_at) {
      return new Date(currentCycle.cycle_start_at);
    }
    if (paydayMode === 'fixed' && fixedPayday > 0) {
      const now = new Date();
      const d = now.getDate(), m = now.getMonth(), y = now.getFullYear();
      return d >= fixedPayday ? new Date(y, m, fixedPayday) : new Date(y, m - 1, fixedPayday);
    }
    const lastSalary = transactions
      .filter(tx => tx.type === 'income' && (tx.income_type === 'one_time' || !tx.income_type))
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : new Date(a.date).getTime();
        const bTs = b.created_at ? new Date(b.created_at).getTime() : new Date(b.date).getTime();
        return bTs - aTs;
      })[0];
    if (lastSalary) {
      return lastSalary.created_at ? new Date(lastSalary.created_at) : new Date(lastSalary.date + 'T00:00:00');
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  })();

  const cycleStartTs = cycleStart.getTime();

  // ── Cycle-filtered income & expenses ─────────────────────────────────────
  // Use >= (not >) to survive any sub-second precision loss in SQLite; the
  // 1-second offset in cycle_start_at (Go: receivedAt - 1s) guarantees that
  // pre-salary transactions (ts < cycleStartTs) are still excluded correctly.
  const txTs = (tx: Transaction) =>
    tx.created_at
      ? new Date(tx.created_at).getTime()
      : new Date(tx.date.slice(0, 10) + 'T12:00:00').getTime();

  const cycleIncome = transactions
    .filter(tx => tx.type === 'income' && txTs(tx) >= cycleStartTs)
    .reduce((acc, tx) => acc + Number(tx.amount), 0);

  const cycleExpenses = transactions
    .filter(tx => tx.type === 'expense' && txTs(tx) >= cycleStartTs)
    .reduce((acc, tx) => acc + Number(tx.amount), 0);

  // Fixed vs variable split for the Expenses card sub-label
  const fixedExpCatID = currentCycle?.fixed_exp_category_id ?? 0;
  const cycleFixedExpenses = fixedExpCatID > 0
    ? transactions
        .filter(tx => tx.type === 'expense' && tx.category?.id === fixedExpCatID && txTs(tx) >= cycleStartTs)
        .reduce((acc, tx) => acc + Number(tx.amount), 0)
    : (currentCycle ? currentCycle.fixed_needs_total + currentCycle.fixed_wants_total : 0);
  const cycleVariableExpenses = Math.max(0, cycleExpenses - cycleFixedExpenses);

  // ── Balance: cycle net when active, else all-time ────────────────────────
  // cycleIncome - cycleExpenses = (salary + bonuses) - (fixed + variable)
  const totalIncomeAllTime = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount), 0);
  const totalExpenseAllTime = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount), 0);
  const balance = currentCycle
    ? cycleIncome - cycleExpenses
    : totalIncomeAllTime - totalExpenseAllTime;

  // ── Income progress bar ───────────────────────────────────────────────────
  const hasFull = transactions.some(t => t.type === 'income' && (t.income_type === 'one_time' || !t.income_type) &&
    (t.created_at ? new Date(t.created_at).getTime() : 0) > cycleStartTs);
  const salaryRef = currentCycle ? currentCycle.total_income : expectedSalary;
  const incomePercent = salaryRef > 0
    ? (hasFull ? 100 : Math.min((cycleIncome / salaryRef) * 100, 100))
    : 0;
  const incomeOver = salaryRef > 0 && (hasFull || cycleIncome >= salaryRef);

  // ── Budget Health: (NeedsLimit + WantsLimit) − cycleExpenses ─────────────
  // Spec: "remaining funds from the 50/30 portion" — does NOT include savings.
  const budget5030 = currentCycle
    ? currentCycle.needs_limit + currentCycle.wants_limit
    : monthlySpendingGoal;
  const budgetPercent = budget5030 > 0 ? (cycleExpenses / budget5030) * 100 : 0;
  const budgetBarColor = budgetPercent >= 100 ? '#ef4444' : budgetPercent >= 80 ? '#f59e0b' : '#38bdf8';
  const budgetRemaining = Math.max(0, budget5030 - cycleExpenses);

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
    fetchData();
  }, [fetchData]);

  if (loading) return <div className="dashboard-wrapper">{t('dashboard.loading')}</div>;

  return (
    <div className="dashboard-wrapper">
      <h1 className="dashboard-title">{t('dashboard.title')}</h1>

      {/* ── Salary Cycle Setup Widget ─────────────────────────────────────── */}
      <SalaryCycleCard onCycleStarted={handleCycleStarted} />

      {/* ── Stats grid ───────────────────────────────────────────────────── */}
      <div className="stats-grid">

        {/* Balance = cycle net (salary + bonuses − all expenses) */}
        <div className="stat-card">
          <div className="stat-icon wallet"><Wallet size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.balance')}</p>
            <p className="value">{formatAmount(balance)}</p>
          </div>
        </div>

        {/* Income — current cycle; click → history modal */}
        <div
          className="stat-card stat-card--clickable"
          onClick={() => setShowIncomeModal(true)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setShowIncomeModal(true)}
          title={t('dashboard.income')}
        >
          <div className="stat-icon income"><TrendingUp size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.income')}</p>
            <p className="value-plus">+{formatAmount(cycleIncome)}</p>
            {currentCycle && (
              <p className="income-breakdown">
                {t('dashboard.income_salary')}: {formatAmount(currentCycle.base_salary)}
                {currentCycle.bonuses > 0 && (
                  <span> · {t('dashboard.income_bonuses')}: {formatAmount(currentCycle.bonuses)}</span>
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
        </div>

        {/* Expenses — fixed + variable; click → history modal */}
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

        {/* Budget Health: remaining 50/30 budget */}
        {budget5030 > 0 && (
          <div className="stat-card">
            <div className="stat-icon budget-icon"><Target size={24}/></div>
            <div className="stat-content">
              <p className="label">{t('dashboard.budget_health')}</p>
              <p className="value" style={{ color: budgetBarColor }}>
                {formatAmount(budgetRemaining)} / {formatAmount(budget5030)}
              </p>
              <div className="budget-health-bar-track">
                <div className="budget-health-bar-fill" style={{ width: `${Math.min(budgetPercent, 100)}%`, background: budgetBarColor }} />
              </div>
              <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
            </div>
          </div>
        )}
      </div>

      {(monthlySpendingGoal > 0 || currentCycle) && (
        <WeeklyBudgetCard
          transactions={transactions}
          monthlyBudget={monthlySpendingGoal}
          formatAmount={formatAmount}
          cycleStartAt={cycleStart}
          onCycleReset={refreshCycle}
        />
      )}

      {showIncomeModal && (
        <IncomeHistoryModal
          transactions={transactions}
          currentCycle={currentCycle}
          formatAmount={formatAmount}
          onClose={() => setShowIncomeModal(false)}
        />
      )}
      {showExpensesModal && (
        <ExpensesHistoryModal
          transactions={transactions}
          currentCycle={currentCycle}
          fixedExpCatID={fixedExpCatID}
          formatAmount={formatAmount}
          onClose={() => setShowExpensesModal(false)}
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
