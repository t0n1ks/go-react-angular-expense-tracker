// frontend-react/src/App.tsx
import React from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';

const App: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token'); // Удаляем токен
    navigate('/login'); // Перенаправляем на страницу входа
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Боковая панель навигации */}
      <aside className="w-64 bg-gray-800 text-white flex flex-col">
        <div className="p-6 text-2xl font-bold border-b border-gray-700">
          Expense Tracker
        </div>
        <nav className="flex-grow">
          <ul className="space-y-2 py-4">
            <li>
              <Link to="/" className="block py-2 px-6 hover:bg-gray-700">
                Главная
              </Link>
            </li>
            <li>
              <Link to="/categories" className="block py-2 px-6 hover:bg-gray-700">
                Категории
              </Link>
            </li>
            <li>
              <Link to="/transactions" className="block py-2 px-6 hover:bg-gray-700">
                Транзакции
              </Link>
            </li>
            <li>
              <Link to="/statistics" className="block py-2 px-6 hover:bg-gray-700">
                Статистика
              </Link>
            </li>
          </ul>
        </nav>
        <div className="p-6 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Выйти
          </button>
        </div>
      </aside>

      {/* Основное содержимое */}
      <main className="flex-grow p-6 overflow-auto">
        <Outlet /> {/* Здесь будут отображаться дочерние маршруты */}
      </main>
    </div>
  );
};

export default App;