// frontend-react/src/pages/Login.tsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Определяем интерфейс для структуры ошибки Axios, чтобы избежать использования 'any'
interface AxiosErrorResponse {
  response?: {
    data?: {
      error?: string;
    };
  };
}

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, axiosInstance } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); // Очищаем предыдущие ошибки

    try {
      const response = await axiosInstance.post('/login', { username, password });
      const token = response.data.token;

      // В Go-бэкенде мы не возвращали user_id при входе, но мы можем его декодировать,
      // или, для простоты, предположим, что мы вернем его позже, или пока просто используем заглушку.
      // В продакшене лучше декодировать JWT или получить данные пользователя отдельным запросом.
      // Для целей MVP, мы пока используем заглушку ID 1, хотя это не идеально.
      // *ПРИМЕЧАНИЕ*: Идеальное решение - изменить Go-бэкенд для возврата ID и Username.
      const tempUserId = 1; // Заглушка, пока не изменим бэкенд

      login(token, username, tempUserId);
      navigate('/', { replace: true });

    } catch (err) {
      console.error("Login failed:", err);
      
      let errorMessage = "Ошибка входа. Проверьте данные.";

      // Проверяем, что ошибка имеет структуру, похожую на ошибку Axios, 
      // и только тогда безопасно получаем сообщение об ошибке.
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const axiosError = err as AxiosErrorResponse;
        errorMessage = axiosError.response?.data?.error || errorMessage;
      }

      setError(errorMessage);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">Вход</h2>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="username">
              Имя пользователя
            </label>
            <input
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              id="username"
              type="text"
              placeholder="Введите имя"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
              Пароль
            </label>
            <input
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-3 leading-tight focus:outline-none focus:shadow-outline"
              id="password"
              type="password"
              placeholder="Введите пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Войти
          </button>
        </form>
        <div className="mt-4 text-center">
          <Link to="/register" className="text-blue-500 hover:underline">
            Нет аккаунта? Зарегистрироваться
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
