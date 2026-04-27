import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, Target } from 'lucide-react';
import TamagotchiWidget from '../components/TamagotchiWidget';
import { useAIAssistant } from '../hooks/useAIAssistant';
import './Dashboard.css';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
  category?: { name: string };
}

const Dashboard: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount, currencySymbol, aiAdviceEnabled, aiHumorEnabled, monthlySpendingGoal, expectedSalary } = useSettings();
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/transactions');
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  useEffect(() => { fetchData(); }, [fetchData]);

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

  const budgetPercent = monthlySpendingGoal > 0 ? (totalExpense / monthlySpendingGoal) * 100 : 0;
  const budgetBarColor = budgetPercent >= 100 ? '#ef4444' : budgetPercent >= 80 ? '#f59e0b' : '#38bdf8';

  const { message, dismiss } = useAIAssistant({
    transactions,
    aiAdviceEnabled,
    aiHumorEnabled,
    monthlySpendingGoal,
    currencySymbol,
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
          </div>
        </div>
        {monthlySpendingGoal > 0 && (
          <div className="stat-card">
            <div className="stat-icon budget-icon"><Target size={24}/></div>
            <div className="stat-content">
              <p className="label">{t('dashboard.budget_health')}</p>
              <p className="value" style={{ color: budgetBarColor }}>{formatAmount(totalExpense)} / {formatAmount(monthlySpendingGoal)}</p>
              <div className="budget-health-bar-track">
                <div className="budget-health-bar-fill" style={{ width: `${Math.min(budgetPercent, 100)}%`, background: budgetBarColor }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <TamagotchiWidget message={message} onDismiss={dismiss} />
    </div>
  );
};

export default Dashboard;
