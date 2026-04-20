import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import './Dashboard.css';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
}

const Dashboard: React.FC = () => {
  const { axiosInstance } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/transactions');
      // Проверка структуры ответа (может быть response.data или response.data.transactions)
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Ошибка загрузки:', err);
    } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + Number(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + Number(t.amount), 0);
  const balance = totalIncome - totalExpense;

  if (loading) return <div className="dashboard-wrapper">Загрузка...</div>;

  return (
    <div className="dashboard-wrapper">
      <h1 className="dashboard-title">Обзор финансов</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon wallet"><Wallet size={24}/></div>
          <div className="stat-content">
            <p className="label">Текущий баланс</p>
            <p className="value">${balance.toLocaleString()}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon income"><TrendingUp size={24}/></div>
          <div className="stat-content">
            <p className="label">Доходы</p>
            <p className="value-plus">+${totalIncome.toLocaleString()}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon expense"><TrendingDown size={24}/></div>
          <div className="stat-content">
            <p className="label">Расходы</p>
            <p className="value-minus">-${totalExpense.toLocaleString()}</p>
          </div>
        </div>
      </div>
      
      {/* Лаконичная инфо-карточка вместо тяжелых графиков */}
      <div className="welcome-card">
        <h2>Рады вас видеть!</h2>
        <p>Ваши финансы под контролем. Детальную аналитику по категориям вы можете найти в разделе <strong>Статистика</strong>.</p>
      </div>
    </div>
  );
};

export default Dashboard;