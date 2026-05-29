import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, PiggyBank } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { type SalaryCycle } from '../context/SettingsContext';

interface SavingsTx {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  date: string;
  created_at?: string;
  description?: string;
}

interface Props {
  currentCycle: SalaryCycle | null;
  formatAmount: (n: number) => string;
  savedMoneyBalance: number;
  onClose: () => void;
}

function cycleDateLabel(
  cycleStartAt: string,
  nextPaydayAt: string | null,
  lang: string,
): string {
  const from = new Date(cycleStartAt);
  const fromStr = from.toLocaleDateString(lang, { month: 'short', day: 'numeric' });
  if (nextPaydayAt) {
    const to = new Date(nextPaydayAt);
    return `${fromStr} – ${to.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return `${fromStr} – …`;
}

const SavingsHistoryModal: React.FC<Props> = ({
  currentCycle, formatAmount, savedMoneyBalance, onClose,
}) => {
  const { t, i18n } = useTranslation();
  const { axiosInstance } = useAuth();
  const [txs, setTxs] = useState<SavingsTx[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axiosInstance.get('/salary-cycle/savings-history')
      .then((res: { data: { transactions: SavingsTx[] } }) => {
        setTxs(res.data.transactions ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [axiosInstance]);

  const cycleLabel = currentCycle
    ? cycleDateLabel(currentCycle.cycle_start_at, currentCycle.next_payday_at, i18n.language)
    : '';

  return (
    <div className="hist-modal-overlay" onClick={onClose}>
      <motion.div
        className="hist-modal"
        onClick={e => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18 }}
      >
        <div className="hist-modal-header">
          <div className="hist-modal-icon" style={{ color: '#10b981' }}><PiggyBank size={18} /></div>
          <h2 className="hist-modal-title">{t('dashboard.saved_money')} — {t('dashboard.history_label')}</h2>
          <button className="hist-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Pool balance summary */}
        <div style={{ padding: '0.5rem 1.25rem', background: 'rgba(16,185,129,0.07)', borderBottom: '1px solid var(--color-border-card)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {t('dashboard.savings_balance')}:&nbsp;
          </span>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#10b981' }}>
            {formatAmount(savedMoneyBalance)}
          </span>
        </div>

        <div className="hist-modal-body">
          {loading ? (
            <p className="hist-modal-empty">{t('common.loading')}</p>
          ) : txs.length === 0 ? (
            <p className="hist-modal-empty">{t('dashboard.savings_empty')}</p>
          ) : (
            txs.map(tx => {
              const isBonus = tx.type === 'income';
              return (
                <div key={tx.id} className={`hist-row${isBonus ? ' hist-row--active' : ''}`}>
                  <div className="hist-row-left">
                    <span className="hist-row-label">
                      {cycleLabel || (tx.created_at ?? tx.date).slice(0, 10)}
                    </span>
                    {tx.description && (
                      <span className="hist-row-breakdown">{tx.description}</span>
                    )}
                  </div>
                  <span
                    className="hist-row-amount"
                    style={{ color: isBonus ? '#10b981' : '#f87171' }}
                  >
                    {isBonus ? '+' : '-'}{formatAmount(tx.amount)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default SavingsHistoryModal;
