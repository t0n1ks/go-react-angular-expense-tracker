import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Check } from 'lucide-react';
import { useSettings, type Currency, type UserSettings } from '../context/SettingsContext';
import './Settings.css';

const CURRENCIES: { code: Currency; label: string; symbol: string }[] = [
  { code: 'USD', label: 'USD', symbol: '$' },
  { code: 'EUR', label: 'EUR', symbol: '€' },
  { code: 'UAH', label: 'UAH', symbol: '₴' },
];

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { currency, aiAdviceEnabled, aiHumorEnabled, monthlySpendingGoal, saveSettings } = useSettings();

  const [local, setLocal] = useState<UserSettings>({
    currency,
    aiAdviceEnabled,
    aiHumorEnabled,
    monthlySpendingGoal,
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Sync local state when context loads from backend
  useEffect(() => {
    setLocal({ currency, aiAdviceEnabled, aiHumorEnabled, monthlySpendingGoal });
  }, [currency, aiAdviceEnabled, aiHumorEnabled, monthlySpendingGoal]);

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

      {/* AI Assistant toggles */}
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

      {/* Financial Goal */}
      <div className="settings-card">
        <h2 className="settings-card-title">{t('settings.goals_title')}</h2>
        <div className="form-group">
          <label className="settings-label">{t('settings.monthly_goal')}</label>
          <input
            type="number"
            className="settings-input"
            value={local.monthlySpendingGoal || ''}
            onChange={e => setLocal(prev => ({ ...prev, monthlySpendingGoal: Number(e.target.value) }))}
            placeholder={t('settings.monthly_goal_ph')}
            min="0"
            step="1"
          />
        </div>
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
    </div>
  );
};

export default Settings;
