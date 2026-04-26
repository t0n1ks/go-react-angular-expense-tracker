import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import PasswordField from '../components/PasswordField';
import './Login.css';

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
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await axiosInstance.post('/login', { username, password });
      const token = response.data.token;
      const tempUserId = 1;
      login(token, username, tempUserId);
      navigate('/', { replace: true });
    } catch (err) {
      console.error("Login failed:", err);
      let errorMessage = t('auth.login_error');
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
        <h2 className="auth-title">{t('auth.login_title')}</h2>

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label" htmlFor="username">{t('auth.username')}</label>
            <input
              className="auth-input"
              id="username"
              type="text"
              placeholder={t('auth.username_ph')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">{t('auth.password')}</label>
            <PasswordField
              id="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.password_ph')}
              required
            />
          </div>

          <button type="submit" className="auth-submit-button">
            {t('auth.login_btn')}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/register" className="auth-link">
            {t('auth.no_account')}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;
