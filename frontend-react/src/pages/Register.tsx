import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import PasswordField from '../components/PasswordField';
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [usernameWarning, setUsernameWarning] = useState('');
  const { axiosInstance } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setUsername(val);
    setUsernameWarning(val.includes(' ') ? t('auth.username_space_warning') : '');
  };

  const handleUsernameBlur = () => {
    const trimmed = username.trim().toLowerCase();
    setUsername(trimmed);
    setUsernameWarning(trimmed.includes(' ') ? t('auth.username_space_warning') : '');
  };

  const handlePasswordBlur = () => setPassword(p => p.trim());
  const handleConfirmPasswordBlur = () => setConfirmPassword(p => p.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (cleanPassword !== confirmPassword.trim()) {
      setError(t('auth.passwords_mismatch'));
      return;
    }

    try {
      const response = await axiosInstance.post('/register', { username: cleanUsername, password: cleanPassword });
      setSuccess(response.data.message || t('auth.register_success'));
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      console.error("Registration failed:", err);
      let errorMessage = t('auth.register_error_generic');
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const axiosError = err as AxiosErrorResponse;
        if (axiosError.response?.data?.error === 'username_already_exists') {
          errorMessage = t('auth.error_username_taken');
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
              onChange={handleUsernameChange}
              onBlur={handleUsernameBlur}
              required
            />
            {usernameWarning && <p className="auth-field-hint">{usernameWarning}</p>}
          </div>

          <div className="auth-field-reg">
            <label className="auth-label-reg" htmlFor="password">{t('auth.password')}</label>
            <PasswordField
              id="password"
              className="auth-input-reg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={handlePasswordBlur}
              placeholder={t('auth.password_ph')}
              required
            />
          </div>

          <div className="auth-field-reg">
            <label className="auth-label-reg" htmlFor="confirmPassword">{t('auth.confirm_password')}</label>
            <PasswordField
              id="confirmPassword"
              className="auth-input-reg"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={handleConfirmPasswordBlur}
              placeholder={t('auth.confirm_password_ph')}
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
