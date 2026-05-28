import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, Target } from 'lucide-react';
import TamagotchiWidget from '../components/TamagotchiWidget';
import WeeklyBudgetCard from '../components/WeeklyBudgetCard';
import { useAIAssistant } from '../hooks/useAIAssistant';
import './Dashboard.css';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
  created_at?: string;
  category?: { name: string };
}

const Dashboard: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount, currencySymbol, aiAdviceEnabled, monthlySpendingGoal, expectedSalary, paydayMode, fixedPayday } = useSettings();
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiData, setAIData] = useState<{ tamagotchi_mood: string; predicted_savings_balance?: number } | null>(null);
  const [aiServiceMode, setAIServiceMode] = useState<'online' | 'autonomous' | 'initializing'>('initializing');

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/transactions');
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch {
      // silent — loading state reset in finally
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

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount), 0);
  const balance = totalIncome - totalExpense;

  const hasFull = transactions.some(t => t.type === 'income' && (t.income_type === 'one_time' || !t.income_type));

  const incomePercent = expectedSalary > 0
    ? (hasFull ? 100 : Math.min((totalIncome / expectedSalary) * 100, 100))
    : 0;
  const incomeOver = expectedSalary > 0 && (hasFull || totalIncome >= expectedSalary);

  const forecast = expectedSalary > 0
    ? (hasFull ? totalIncome - totalExpense : Math.max(totalIncome, expectedSalary) - totalExpense)
    : null;

  // Cycle-start for Budget Health card: respects payday mode so the card resets on salary
  const cycleStart = (() => {
    if (paydayMode === 'fixed' && fixedPayday > 0) {
      const now = new Date();
      const d = now.getDate(), m = now.getMonth(), y = now.getFullYear();
      return d >= fixedPayday ? new Date(y, m, fixedPayday) : new Date(y, m - 1, fixedPayday);
    }
    // Smart mode: use created_at of last one_time income for sub-day precision
    const lastSalary = transactions
      .filter(t => t.type === 'income' && (t.income_type === 'one_time' || !t.income_type))
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : new Date(a.date).getTime();
        const bTs = b.created_at ? new Date(b.created_at).getTime() : new Date(b.date).getTime();
        return bTs - aTs;
      })[0];
    if (lastSalary) {
      return lastSalary.created_at
        ? new Date(lastSalary.created_at)
        : new Date(lastSalary.date + 'T00:00:00');
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  })();

  const cycleExpenses = transactions
    .filter(t => {
      if (t.type !== 'expense') return false;
      const txTs = t.created_at
        ? new Date(t.created_at).getTime()
        : new Date(t.date.slice(0, 10) + 'T23:59:59').getTime();
      return txTs > cycleStart.getTime();
    })
    .reduce((acc, t) => acc + Number(t.amount), 0);

  const budgetPercent = monthlySpendingGoal > 0 ? (cycleExpenses / monthlySpendingGoal) * 100 : 0;
  const budgetBarColor = budgetPercent >= 100 ? '#ef4444' : budgetPercent >= 80 ? '#f59e0b' : '#38bdf8';

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

  if (loading) return <div className="dashboard-wrapper">{t('dashboard.loading')}</div>;

  return (
    <div className="dashboard-wrapper">
      <h1 className="dashboard-title">{t('dashboard.title')}</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon wallet"><Wallet size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.balance')}</p>
            <p className="value">{formatAmount(balance)}</p>
            {forecast !== null && (
              <p className="forecast-text">{t('dashboard.forecast')}: {formatAmount(forecast)}</p>
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon income"><TrendingUp size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.income')}</p>
            <p className="value-plus">+{formatAmount(totalIncome)}</p>
            {expectedSalary > 0 && (
              <>
                <div className={`progress-track${incomeOver ? ' progress-track--glow' : ''}`}>
                  <div className="progress-fill" style={{ width: `${incomePercent}%`, background: incomeOver ? '#10b981' : '#38bdf8' }} />
                </div>
                <p className="progress-label">{t('dashboard.income_of_expected', { expected: formatAmount(expectedSalary) })}</p>
              </>
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon expense"><TrendingDown size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.expenses')}</p>
            <p className="value-minus">-{formatAmount(totalExpense)}</p>
            <p className="stat-sublabel">{t('dashboard.expenses_this_month')}</p>
          </div>
        </div>
        {monthlySpendingGoal > 0 && (
          <div className="stat-card">
            <div className="stat-icon budget-icon"><Target size={24}/></div>
            <div className="stat-content">
              <p className="label">{t('dashboard.budget_health')}</p>
              <p className="value" style={{ color: budgetBarColor }}>{formatAmount(cycleExpenses)} / {formatAmount(monthlySpendingGoal)}</p>
              <div className="budget-health-bar-track">
                <div className="budget-health-bar-fill" style={{ width: `${Math.min(budgetPercent, 100)}%`, background: budgetBarColor }} />
              </div>
              <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
            </div>
          </div>
        )}
      </div>

      {monthlySpendingGoal > 0 && (
        <WeeklyBudgetCard
          transactions={transactions}
          monthlyBudget={monthlySpendingGoal}
          formatAmount={formatAmount}
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
