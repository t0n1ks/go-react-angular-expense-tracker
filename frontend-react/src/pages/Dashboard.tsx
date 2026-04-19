// frontend-react/src/pages/Dashboard.tsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const response = await axiosInstance.get('/transactions');
        const data = response.data.transactions || response.data;
        if (Array.isArray(data)) setTransactions(data);
      } catch (error) {
        console.error('Error loading transactions:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchTransactions();
  }, [axiosInstance]);

  if (loading) return <div className="loading-state">Loading data...</div>;

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((acc, t) => acc + Number(t.amount), 0);
    
  const totalExpense = transactions
    .filter(t => t.type === 'expense')
    .reduce((acc, t) => acc + Number(t.amount), 0);
    
  const balance = totalIncome - totalExpense;

  const chartData = [
    { name: 'Income', value: totalIncome, color: '#10B981' },
    { name: 'Expenses', value: totalExpense, color: '#EF4444' }
  ];

  // Выносим форматтер отдельно, чтобы не загромождать JSX
  const formatCurrency = (value: unknown): [string, string] => {
  const amount = typeof value === 'number' ? value : Number(value);
  return [`$${amount.toLocaleString()}`, ''];
};

  return (
    <div className="dashboard-wrapper"> 
      <h1 className="dashboard-title">Financial Overview</h1>

      <div className="stats-grid">
        <div className="stat-card card-balance">
          <div className="icon-wrapper bg-blue">
            <Wallet className="icon-blue" />
          </div>
          <div className="stat-content">
            <p className="label">Balance</p>
            <p className="value">${balance.toLocaleString()}</p>
          </div>
        </div>

        <div className="stat-card card-income">
          <div className="icon-wrapper bg-emerald">
            <TrendingUp className="icon-emerald" />
          </div>
          <div className="stat-content">
            <p className="label">Income</p>
            <p className="value-plus">+${totalIncome.toLocaleString()}</p>
          </div>
        </div>

        <div className="stat-card card-expense">
          <div className="icon-wrapper bg-rose">
            <TrendingDown className="icon-rose" />
          </div>
          <div className="stat-content">
            <p className="label">Expenses</p>
            <p className="value-minus">-${totalExpense.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="chart-section">
        <h2 className="section-title">Cash Flow Statistics</h2>
        
        {(totalIncome > 0 || totalExpense > 0) ? (
          <div className="chart-container">
            <ResponsiveContainer width="99%" height={320}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
<Tooltip 
  cursor={{ fill: 'transparent' }}
  wrapperClassName="custom-tooltip-wrapper"
  formatter={formatCurrency}
/>
                <Legend iconType="circle" verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="no-data-placeholder">
            <p className="main-text">No transactions found</p>
            <p className="sub-text">Add some income or expenses to see the chart</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;