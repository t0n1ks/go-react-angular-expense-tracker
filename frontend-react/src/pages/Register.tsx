// frontend-react/src/pages/Register.tsx
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

const Register: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { axiosInstance } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const response = await axiosInstance.post('/register', { username, password });

      setSuccess(response.data.message || "Регистрация успешна!");
      // После успешной регистрации, перенаправляем на страницу входа
      setTimeout(() => navigate('/login'), 1500);

    } catch (err) { // <<< ИСПРАВЛЕНИЕ: удалено ': any'. err теперь 'unknown'.
      console.error("Registration failed:", err);
      
      let errorMessage = "Ошибка регистрации. Попробуйте другое имя пользователя.";

      // Проверяем, что ошибка имеет структуру, похожую на ошибку Axios, 
      // и только тогда безопасно получаем сообщение об ошибке.
      if (typeof err === 'object' && err !== null && 'response' in err) {
        // Приводим к нашему безопасному типу
        const axiosError = err as AxiosErrorResponse; 

        if (axiosError.response?.data?.error) {
          const apiError = axiosError.response.data.error;
          
          // Если Go-бэкенд вернул ошибку, содержащую "unique constraint failed"
          if (apiError.includes("unique constraint failed")) {
              errorMessage = "Пользователь с таким именем уже существует.";
          } else {
              errorMessage = apiError;
          }
        }
      }
      setError(errorMessage);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">Регистрация</h2>
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}
        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative mb-4" role="alert">
            <span className="block sm:inline">{success}</span>
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
              placeholder="Придумайте имя"
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
              placeholder="Придумайте пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Зарегистрироваться
          </button>
        </form>
        <div className="mt-4 text-center">
          <Link to="/login" className="text-blue-500 hover:underline">
            Уже есть аккаунт? Войти
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
