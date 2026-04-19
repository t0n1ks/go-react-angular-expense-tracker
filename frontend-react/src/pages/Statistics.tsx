// frontend-react/src/pages/Statistics.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Минимальные интерфейсы для данных
interface Category {
  name: string;
}

interface Transaction {
  amount: number;
  type: string;
  category?: Category;
}

const Statistics: React.FC = () => {
  const { axiosInstance } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Убрали <ApiResponse> отсюда, чтобы не было ошибки ts(2347)
    axiosInstance.get('/transactions')
      .then((res: { data: { transactions?: Transaction[] } }) => {
        const data = res.data.transactions || [];
        setTransactions(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        console.error('Ошибка:', err);
        setLoading(false);
      });
  }, [axiosInstance]);

  const chartData = useMemo(() => {
    const stats: Record<string, number> = {};
    
    transactions.forEach(t => {
      // Простая проверка типа
      const isExpense = t.type?.toLowerCase().includes('expense');
      if (isExpense) {
        const name = t.category?.name || 'Без категории';
        stats[name] = (stats[name] || 0) + Number(t.amount);
      }
    });

    return Object.keys(stats).map(name => ({
      name,
      value: stats[name]
    }));
  }, [transactions]);

  if (loading) return <div>Загрузка...</div>;

  return (
    <div style={{ padding: '20px', color: '#000' }}>
      <h1>Статистика (Raw Data)</h1>
      
      {/* Текстовый блок для проверки доставки данных */}
      <div style={{ marginBottom: '20px', background: '#f0f0f0', padding: '15px', border: '1px solid #ccc' }}>
        <p><strong>Транзакций в БД:</strong> {transactions.length}</p>
        <p><strong>Категорий расходов:</strong> {chartData.length}</p>
        <pre style={{ fontSize: '12px' }}>{JSON.stringify(chartData, null, 2)}</pre>
      </div>

      {/* Контейнер графика */}
      {chartData.length > 0 ? (
        <div style={{ width: '100%', height: '300px', border: '2px solid red' }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#4F46E5" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ padding: '20px', border: '1px dashed #999' }}>
          Данные для графика отсутствуют. Убедитесь, что есть транзакции с типом "expense".
        </div>
      )}
    </div>
  );
};

export default Statistics;