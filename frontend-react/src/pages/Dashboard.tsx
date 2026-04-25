import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import UfoWelcome from '../components/UfoWelcome';
import './Dashboard.css';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
}

const Dashboard: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount } = useSettings();
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
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon income"><TrendingUp size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.income')}</p>
            <p className="value-plus">+{formatAmount(totalIncome)}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon expense"><TrendingDown size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.expenses')}</p>
            <p className="value-minus">-{formatAmount(totalExpense)}</p>
          </div>
        </div>
      </div>

      <UfoWelcome />
    </div>
  );
};

export default Dashboard;
