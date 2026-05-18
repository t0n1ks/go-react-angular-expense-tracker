import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
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
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const { axiosInstance } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!privacyOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPrivacyOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [privacyOpen]);

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
      const response = await axiosInstance.post('/register', {
        username: cleanUsername,
        password: cleanPassword,
        language: i18n.language?.split('-')[0] ?? 'en',
      });
      setSuccess(response.data.message || t('auth.register_success'));
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
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
    <>
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

          <div className="flex flex-col gap-[20px] w-full">
            <button type="submit" className="auth-submit-button-reg">
              {t('auth.register_btn')}
            </button>
            <div className="text-center text-[11px] text-gray-400 leading-snug">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={13} className="shrink-0 text-gray-400" />
                <span>
                  {t('auth.disclaimer_short')}{' '}
                  <button
                    type="button"
                    onClick={() => setPrivacyOpen(true)}
                    className="privacy-policy-link"
                  >
                    {t('auth.privacy_policy')}
                  </button>.
                </span>
              </span>
            </div>
          </div>
        </form>

        <div className="auth-footer">
          <Link to="/login" className="auth-link" style={{ color: '#00b09b' }}>
            {t('auth.have_account')}
          </Link>
        </div>
      </div>
    </div>

      <AnimatePresence>
        {privacyOpen && (
          <motion.div
            className="privacy-modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setPrivacyOpen(false)}
          >
            <motion.div
              className="privacy-modal-card"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.97 }}
              transition={{ type: 'spring', damping: 28, stiffness: 380 }}
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="privacy-modal-title"
            >
              <div className="privacy-modal-header">
                <div className="privacy-modal-icon">
                  <ShieldCheck size={16} />
                </div>
                <h2 id="privacy-modal-title" className="privacy-modal-title">
                  {t('auth.privacy_modal_title')}
                </h2>
                <button
                  className="privacy-modal-close"
                  onClick={() => setPrivacyOpen(false)}
                  aria-label="Close"
                >✕</button>
              </div>

              <p className="privacy-modal-body">{t('auth.disclaimer_full')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Register;
