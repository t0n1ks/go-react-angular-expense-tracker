// frontend-react/src/pages/Login.tsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Login.css';

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
    <div className="auth-page">
      <div className="auth-card">
        <h2 className="auth-title">С возвращением</h2>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label" htmlFor="username">Имя пользователя</label>
            <input
              className="auth-input"
              id="username"
              type="text"
              placeholder="Введите имя"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">Пароль</label>
            <input
              className="auth-input"
              id="password"
              type="password"
              placeholder="Введите пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-submit-button">
            Войти
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/register" className="auth-link">
            Нет аккаунта? Зарегистрироваться
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
