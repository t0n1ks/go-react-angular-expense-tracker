import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, Pencil } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { litePercent, liteTier } from '../utils/liteBudget';
import './LiteBudgetCard.css';

// The Lite-mode budget card (Home, Lite only — extended keeps WeeklyBudgetCard).
// Figures come from the server's Lite window (GET /budget/current): this
// calendar month's Lite spending against Lite's own OPTIONAL limit, which is
// saved via PUT /lite/limit and never touches extended mode.
const LiteBudgetCard: React.FC = () => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();
  const { budgetWindow, refreshBudget, formatAmount } = useSettings();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const hasLimit = !!budgetWindow?.has_goal;
  const limit = hasLimit ? budgetWindow!.monthly_budget : 0;
  const spent = budgetWindow?.spent_this_window ?? 0;
  const percent = litePercent(spent, limit);
  const tier = liteTier(percent);

  const saveLimit = async (value: number | null) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await axiosInstance.put('/lite/limit', { limit: value });
      await refreshBudget();
      setEditing(false);
      setInput('');
    } catch {
      setError(t('lite_budget.error_save'));
    } finally {
      setSaving(false);
    }
  };
  const submit = () => {
    const v = parseFloat(input.replace(',', '.'));
    if (v > 0) saveLimit(Math.round(v * 100) / 100);
  };
  const openEdit = () => {
    setInput(hasLimit ? String(limit) : '');
    setError('');
    setEditing(true);
  };

  return (
    <section className="weekly-budget-card lite-budget-card" aria-labelledby="lite-budget-title">
      <div className="weekly-budget-header">
        <div className="weekly-budget-icon"><Wallet size={22} aria-hidden="true" /></div>
        <h2 id="lite-budget-title" className="weekly-budget-title lite-budget-title">{t('lite_budget.title')}</h2>
      </div>

      <div className="weekly-budget-body lite-budget-body">
        {/* Spent this month — coloured by % of the limit when one is set,
            neutral without; the label carries the % so colour isn't the only
            signal. */}
        <div className="weekly-budget-stat">
          <span className="weekly-budget-stat-label" aria-hidden="true">{t('lite_budget.spent')}</span>
          <span className={`weekly-budget-stat-value${hasLimit ? ` lite-spent lite-tier--${tier}` : ''}`}>
            <span aria-hidden="true">{formatAmount(spent)}</span>
            <span className="sr-only">
              {hasLimit
                ? t('lite_budget.spent_aria_limit', { amount: formatAmount(spent), percent: Math.round(percent) })
                : t('lite_budget.spent_aria', { amount: formatAmount(spent) })}
            </span>
          </span>
        </div>

        {/* Limit (optional) */}
        <div className="weekly-budget-stat">
          <span className="weekly-budget-stat-label" id="lite-limit-label">{t('lite_budget.limit')}</span>
          {editing ? (
            <span className="weekly-budget-limit-edit lite-limit-edit">
              <input
                type="number"
                inputMode="decimal"
                min="1"
                className="weekly-budget-setup-input"
                aria-labelledby="lite-limit-label"
                placeholder={t('lite_budget.limit_placeholder')}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                disabled={saving}
                autoFocus
              />
              <button
                type="button"
                className="weekly-budget-action-btn weekly-budget-action-btn--save"
                onClick={submit}
                disabled={saving || !(parseFloat(input.replace(',', '.')) > 0)}
              >
                {t('lite_budget.save')}
              </button>
              {hasLimit && (
                <button
                  type="button"
                  className="weekly-budget-action-btn weekly-budget-action-btn--cancel"
                  onClick={() => saveLimit(null)}
                  disabled={saving}
                >
                  {t('lite_budget.remove')}
                </button>
              )}
              <button
                type="button"
                className="weekly-budget-action-btn weekly-budget-action-btn--cancel"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                {t('lite_budget.cancel')}
              </button>
            </span>
          ) : (
            <span className="weekly-budget-stat-value">
              {hasLimit
                ? formatAmount(limit)
                : <span className="lite-no-limit">{t('lite_budget.no_limit')}</span>}
              <button
                type="button"
                className="wbc-edit-payday-btn"
                onClick={openEdit}
                aria-label={t(hasLimit ? 'lite_budget.edit_limit' : 'lite_budget.set_limit')}
                title={t(hasLimit ? 'lite_budget.edit_limit' : 'lite_budget.set_limit')}
              >
                <Pencil size={12} aria-hidden="true" />
              </button>
            </span>
          )}
          {error && <span className="lite-budget-error" role="alert">{error}</span>}
        </div>

      </div>
    </section>
  );
};

export default LiteBudgetCard;
