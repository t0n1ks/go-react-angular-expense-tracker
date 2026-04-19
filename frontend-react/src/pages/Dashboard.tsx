// frontend-react/src/pages/Dashboard.tsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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
        // ИСПРАВЛЕНИЕ: обращаемся к response.data.transactions
        if (response.data && Array.isArray(response.data.transactions)) {
            setTransactions(response.data.transactions);
        } else {
            setTransactions([]);
        }
      } catch (error) {
        console.error('Ошибка загрузки транзакций:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchTransactions();
  }, [axiosInstance]);

  if (loading) {
      return <div className="p-6 text-center text-gray-500">Загрузка данных...</div>;
  }

  // Считаем суммы
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
  const balance = totalIncome - totalExpense;

  // Данные для графика
  const chartData = [
    { name: 'Доходы', value: totalIncome, color: '#10B981' }, // Зеленый
    { name: 'Расходы', value: totalExpense, color: '#EF4444' }  // Красный
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-gray-800">Обзор финансов</h1>

      {/* Карточки сводки */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow-md p-6 flex items-center border-l-4 border-blue-500">
          <div className="p-3 rounded-full bg-blue-100 mr-4">
            <Wallet className="w-8 h-8 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Текущий баланс</p>
            <p className="text-2xl font-bold text-gray-800">{balance.toFixed(2)} $</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 flex items-center border-l-4 border-green-500">
          <div className="p-3 rounded-full bg-green-100 mr-4">
            <TrendingUp className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Общий доход</p>
            <p className="text-2xl font-bold text-gray-800">{totalIncome.toFixed(2)}$</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 flex items-center border-l-4 border-red-500">
          <div className="p-3 rounded-full bg-red-100 mr-4">
            <TrendingDown className="w-8 h-8 text-red-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500 font-medium">Общие расходы</p>
            <p className="text-2xl font-bold text-gray-800">{totalExpense.toFixed(2)} $</p>
          </div>
        </div>
      </div>

      {/* График Recharts */}
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-xl font-semibold mb-6 text-gray-700">Соотношение доходов и расходов</h2>
        
        {(totalIncome > 0 || totalExpense > 0) ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80} // Делает график кольцевым (Donut)
                  outerRadius={120}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value} $`} />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
            Нет данных для отображения графика. Добавьте свои первые транзакции!
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;