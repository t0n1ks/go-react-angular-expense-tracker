import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { type CycleStats } from '../context/SettingsContext';

interface Props {
  formatAmount: (n: number) => string;
  onClose: () => void;
  onSuccess: (updatedStats: CycleStats) => void;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const AddIncomeModal: React.FC<Props> = ({ formatAmount, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayStr());
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError(t('dashboard.add_income_amount_error'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await axiosInstance.post('/salary-cycle/income', {
        amount: amt,
        date: date || undefined,
        description: description.trim() || undefined,
      });
      onSuccess(res.data.cycle_stats as CycleStats);
      onClose();
    } catch {
      setError(t('dashboard.add_income_error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hist-modal-overlay" onClick={onClose}>
      <motion.div
        className="hist-modal"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18 }}
        style={{ maxWidth: 380 }}
      >
        <div className="hist-modal-header">
          <div className="hist-modal-icon income-icon"><Plus size={18} /></div>
          <h2 className="hist-modal-title">{t('dashboard.add_income_title')}</h2>
          <button className="hist-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="hist-modal-body" style={{ padding: '1rem 1.25rem 1.25rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                {t('dashboard.add_income_amount')} *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 50"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                style={{
                  background: 'var(--color-bg-input, rgba(255,255,255,0.06))',
                  border: '1px solid var(--color-border-card)',
                  borderRadius: '0.6rem',
                  padding: '0.5rem 0.75rem',
                  color: 'var(--color-text-heading)',
                  fontSize: '0.875rem',
                }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                {t('dashboard.add_income_date')}
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{
                  background: 'var(--color-bg-input, rgba(255,255,255,0.06))',
                  border: '1px solid var(--color-border-card)',
                  borderRadius: '0.6rem',
                  padding: '0.5rem 0.75rem',
                  color: 'var(--color-text-heading)',
                  fontSize: '0.875rem',
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                {t('dashboard.add_income_desc')}
              </label>
              <input
                type="text"
                placeholder={t('dashboard.add_income_desc_ph')}
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={120}
                style={{
                  background: 'var(--color-bg-input, rgba(255,255,255,0.06))',
                  border: '1px solid var(--color-border-card)',
                  borderRadius: '0.6rem',
                  padding: '0.5rem 0.75rem',
                  color: 'var(--color-text-heading)',
                  fontSize: '0.875rem',
                }}
              />
            </div>

            {error && (
              <p style={{ fontSize: '0.8rem', color: '#f87171', margin: 0 }}>{error}</p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || !amount || parseFloat(amount) <= 0}
              style={{
                marginTop: '0.25rem',
                padding: '0.7rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: 'linear-gradient(135deg, #10b981, #38bdf8)',
                color: '#fff',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving || !amount || parseFloat(amount) <= 0 ? 0.5 : 1,
              }}
            >
              {saving ? '…' : t('dashboard.add_income_btn')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default AddIncomeModal;
