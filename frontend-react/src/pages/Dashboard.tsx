// frontend-react/src/pages/Dashboard.tsx
import React from 'react';

const Dashboard: React.FC = () => {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Главная панель</h1>
      <p>Добро пожаловать в приложение для отслеживания расходов!</p>
      <p>Здесь будет отображаться краткий обзор ваших текущих расходов и возможность быстро добавить новую транзакцию.</p>
    </div>
  );
};

export default Dashboard;