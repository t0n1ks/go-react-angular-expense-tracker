import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import './Register.css';

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
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      const response = await axiosInstance.post('/register', { username, password });
      setSuccess(response.data.message || t('auth.register_success'));
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      console.error("Registration failed:", err);
      let errorMessage = t('auth.register_error');
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const axiosError = err as AxiosErrorResponse;
        if (axiosError.response?.data?.error) {
          const apiError = axiosError.response.data.error;
          errorMessage = apiError.includes("unique constraint failed")
            ? t('auth.register_error')
            : apiError;
        }
      }
      setError(errorMessage);
    }
  };

  return (
    <div className="auth-page-reg">
      <div className="auth-card-reg">
        <h2 className="auth-title-reg">{t('auth.register_title')}</h2>

        {error && <div className="auth-status-msg msg-error">{error}</div>}
        {success && <div className="auth-status-msg msg-success">{success}</div>}

        <form onSubmit={handleSubmit} className="auth-form-reg">
          <div className="auth-field-reg">
            <label className="auth-label-reg" htmlFor="username">{t('auth.username')}</label>
            <input
              className="auth-input-reg"
              id="username"
              type="text"
              placeholder={t('auth.username_ph')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="auth-field-reg">
            <label className="auth-label-reg" htmlFor="password">{t('auth.password')}</label>
            <input
              className="auth-input-reg"
              id="password"
              type="password"
              placeholder={t('auth.password_ph')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-submit-button-reg">
            {t('auth.register_btn')}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/login" className="auth-link" style={{ color: '#00b09b' }}>
            {t('auth.have_account')}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
