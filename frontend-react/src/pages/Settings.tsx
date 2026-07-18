import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Check, LogOut, Trash2, Info, X } from 'lucide-react';
import { useSettings, type Currency, type UserSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import './Settings.css';

const CURRENCIES: { code: Currency; label: string; symbol: string }[] = [
  { code: 'USD', label: 'USD', symbol: '$' },
  { code: 'EUR', label: 'EUR', symbol: '€' },
  { code: 'UAH', label: 'UAH', symbol: '₴' },
];

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
  { code: 'ru', label: 'RU' },
  { code: 'uk', label: 'UA' },
];

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { logout, axiosInstance } = useAuth();
  const navigate = useNavigate();
  const {
    currency,
    aiAdviceEnabled,
    aiHumorEnabled,
    monthlySpendingGoal,
    expectedSalary,
    paydayMode,
    fixedPayday,
    manualNextPayday,
    heartsCount,
    reputationScore,
    liteMode,
    hasActiveCycle,
    saveSettings,
  } = useSettings();

  const [local, setLocal] = useState<UserSettings>({
    currency,
    aiAdviceEnabled,
    aiHumorEnabled,
    monthlySpendingGoal,
    expectedSalary,
    paydayMode,
    fixedPayday,
    manualNextPayday,
    heartsCount,
    reputationScore,
    liteMode,
  });
  const [showLiteInfo, setShowLiteInfo] = useState(false);
  const [showLiteModal, setShowLiteModal] = useState(false);
  const liteInfoRef = useRef<HTMLDivElement>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  // Sync when context updates (e.g. after a salary cycle resets the goal, or
  // auto-disables Lite mode).
  useEffect(() => {
    setLocal(prev => ({
      ...prev,
      currency,
      aiAdviceEnabled,
      aiHumorEnabled,
      monthlySpendingGoal,
      expectedSalary,
      paydayMode,
      fixedPayday,
      manualNextPayday,
      liteMode,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, aiAdviceEnabled, aiHumorEnabled, liteMode]);

  // Dismiss the Lite info popover on outside click / Escape.
  useEffect(() => {
    if (!showLiteInfo) return;
    const onClick = (e: MouseEvent) => {
      if (liteInfoRef.current && !liteInfoRef.current.contains(e.target as Node)) setShowLiteInfo(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowLiteInfo(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showLiteInfo]);

  // Close the "More" modal on Escape (backdrop tap and ✕ are handled inline).
  useEffect(() => {
    if (!showLiteModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowLiteModal(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showLiteModal]);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      await saveSettings(local);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    setDeleteOpen(false);
    setDeleteInput('');
    setDeleteError('');
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      await axiosInstance.delete('/user');
      setDeleteOpen(false);
      setShowSuccessToast(true);
      logout();
      setTimeout(() => navigate('/register'), 1800);
    } catch {
      setDeleteError(t('settings.delete_error'));
      setIsDeleting(false);
    }
  };

  const currentLang = i18n.language?.split('-')[0] ?? 'en';

  return (
    <div className="settings-wrapper">
      <h1 className="settings-title">
        <SettingsIcon size={26} style={{ marginRight: '0.6rem', verticalAlign: 'middle' }} />
        {t('settings.title')}
      </h1>

      {/* Currency */}
      <div className="settings-card">
        <h2 className="settings-card-title">{t('settings.currency_title')}</h2>
        <div className="currency-selector">
          {CURRENCIES.map(c => (
            <button
              key={c.code}
              className={`currency-btn${local.currency === c.code ? ' currency-btn--active' : ''}`}
              onClick={() => setLocal(prev => ({ ...prev, currency: c.code }))}
            >
              <span className="currency-symbol">{c.symbol}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Language */}
      <div className="settings-card">
        <h2 className="settings-card-title">{t('settings.language_title')}</h2>
        <div className="lang-selector">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              className={`lang-btn${currentLang === lang.code ? ' lang-btn--active' : ''}`}
              onClick={() => i18n.changeLanguage(lang.code)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Assistant */}
      <div className="settings-card">
        <h2 className="settings-card-title">{t('settings.ai_title')}</h2>

        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <p className="toggle-label">{t('settings.ai_advice')}</p>
            <p className="toggle-desc">{t('settings.ai_advice_desc')}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={local.aiAdviceEnabled}
              onChange={e => setLocal(prev => ({ ...prev, aiAdviceEnabled: e.target.checked }))}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-text">
            <p className="toggle-label">{t('settings.ai_humor')}</p>
            <p className="toggle-desc">{t('settings.ai_humor_desc')}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={local.aiHumorEnabled}
              onChange={e => setLocal(prev => ({ ...prev, aiHumorEnabled: e.target.checked }))}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* Lite mode — track-only. Shown always; disabled while a salary cycle is
          active (stop the cycle to enable it). The info tooltip stays available
          in both states. */}
      <div className="settings-card">
        <div className="settings-lite-header" ref={liteInfoRef}>
          <h2 className="settings-card-title">{t('settings.lite_title')}</h2>
          <button
            className="settings-lite-info-btn"
            onClick={() => setShowLiteInfo(v => !v)}
            aria-label={t('settings.lite_title')}
            type="button"
          >
            <Info size={15} />
          </button>
          {showLiteInfo && (
            <div className="settings-lite-info-popover">
              <p>{t('settings.lite_info_short')}</p>
              <button
                type="button"
                className="settings-lite-more-btn"
                onClick={() => { setShowLiteInfo(false); setShowLiteModal(true); }}
              >
                {t('settings.lite_more')}
              </button>
            </div>
          )}
        </div>

        <div className={`settings-toggle-row${hasActiveCycle ? ' settings-toggle-row--disabled' : ''}`}>
          <div className="settings-toggle-text">
            <p className="toggle-label">{t('settings.lite_label')}</p>
            <p className="toggle-desc">{t('settings.lite_desc')}</p>
          </div>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={local.liteMode}
              disabled={hasActiveCycle}
              onChange={e => setLocal(prev => ({ ...prev, liteMode: e.target.checked }))}
            />
            <span className="toggle-slider" />
          </label>
        </div>

        {hasActiveCycle && (
          <p className="settings-lite-locked-hint">{t('settings.lite_locked_hint')}</p>
        )}
      </div>

      {/* Save */}
      <div className="settings-save-row">
        <button
          className={`btn-save-settings${saveStatus === 'saving' ? ' saving' : ''}`}
          onClick={handleSave}
          disabled={saveStatus === 'saving'}
        >
          {saveStatus === 'saved' ? (
            <><Check size={16} style={{ marginRight: '0.4rem' }} />{t('settings.saved')}</>
          ) : saveStatus === 'saving' ? (
            t('common.loading')
          ) : (
            t('settings.save')
          )}
        </button>
        {saveStatus === 'error' && (
          <span className="settings-save-error">{t('settings.save_error')}</span>
        )}
      </div>

      {/* Logout */}
      <div className="settings-logout-section">
        <button className="btn-logout-settings" onClick={logout}>
          <LogOut size={16} />
          {t('nav.logout')}
        </button>
      </div>

      {/* Delete Account */}
      <div className="settings-delete-section">
        <button className="btn-delete-account" onClick={() => setDeleteOpen(true)}>
          <Trash2 size={16} />
          {t('settings.delete_account')}
        </button>
      </div>

      {/* Lite mode — full explanation modal (opened from the tooltip's "More") */}
      {showLiteModal && (
        <div
          className="lite-modal-overlay"
          onClick={() => setShowLiteModal(false)}
          role="dialog"
          aria-modal
        >
          <div className="lite-modal" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="lite-modal-close"
              onClick={() => setShowLiteModal(false)}
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <h3 className="lite-modal-title">{t('settings.lite_title')}</h3>
            {(t('settings.lite_info_more', { returnObjects: true }) as string[]).map((line, i) => (
              <p key={i} className="lite-modal-line">{line}</p>
            ))}
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="delete-modal-overlay" onClick={closeDeleteModal}>
          <div className="delete-modal" onClick={e => e.stopPropagation()}>
            <h3 className="delete-modal-title">{t('settings.delete_modal_title')}</h3>
            <p className="delete-modal-body">{t('settings.delete_modal_body')}</p>
            <label className="delete-modal-label">{t('settings.delete_type_hint')}</label>
            <input
              className="delete-modal-input"
              type="text"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              autoFocus
            />
            {deleteError && <p className="delete-modal-error">{deleteError}</p>}
            <div className="delete-modal-actions">
              <button className="btn-cancel-delete" onClick={closeDeleteModal} disabled={isDeleting}>
                {t('settings.delete_cancel')}
              </button>
              <button
                className="btn-confirm-delete"
                onClick={handleDeleteAccount}
                disabled={deleteInput !== 'DELETE' || isDeleting}
              >
                {isDeleting ? t('common.loading') : t('settings.delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessToast && (
        <div className="delete-success-toast">
          {t('settings.delete_success')}
        </div>
      )}
    </div>
  );
};

export default Settings;
