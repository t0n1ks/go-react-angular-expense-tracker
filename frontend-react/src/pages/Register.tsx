// frontend-react/src/pages/Register.tsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Register.css';

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
    <div className="auth-page-reg">
      <div className="auth-card-reg">
        <h2 className="auth-title-reg">Создать аккаунт</h2>

        {error && <div className="auth-status-msg msg-error">{error}</div>}
        {success && <div className="auth-status-msg msg-success">{success}</div>}

        <form onSubmit={handleSubmit} className="auth-form-reg">
          <div className="auth-field-reg">
            <label className="auth-label-reg" htmlFor="username">Имя пользователя</label>
            <input
              className="auth-input-reg"
              id="username"
              type="text"
              placeholder="Придумайте имя"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="auth-field-reg">
            <label className="auth-label-reg" htmlFor="password">Пароль</label>
            <input
              className="auth-input-reg"
              id="password"
              type="password"
              placeholder="Придумайте пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-submit-button-reg">
            Зарегистрироваться
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/login" className="auth-link" style={{ color: '#00b09b' }}>
            Уже есть аккаунт? Войти
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
