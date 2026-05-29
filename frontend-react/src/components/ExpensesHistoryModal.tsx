import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type SalaryCycle } from '../context/SettingsContext';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  date: string;
  created_at?: string;
  category?: { id: number; name: string };
}

interface Props {
  transactions: Transaction[];
  currentCycle: SalaryCycle | null;
  fixedExpCatID: number;
  formatAmount: (n: number) => string;
  onClose: () => void;
}

interface MonthGroup {
  key: string;
  label: string;
  total: number;
  fixed: number;
  variable: number;
  isCurrentCycle: boolean;
}

const ExpensesHistoryModal: React.FC<Props> = ({
  transactions, currentCycle, fixedExpCatID, formatAmount, onClose,
}) => {
  const { t, i18n } = useTranslation();

  const groups = useMemo<MonthGroup[]>(() => {
    const totalMap = new Map<string, number>();
    const fixedMap = new Map<string, number>();

    for (const tx of transactions) {
      if (tx.type !== 'expense') continue;
      const key = (tx.created_at ?? tx.date).slice(0, 7);
      const amt = Number(tx.amount);
      totalMap.set(key, (totalMap.get(key) ?? 0) + amt);
      if (fixedExpCatID > 0 && tx.category?.id === fixedExpCatID) {
        fixedMap.set(key, (fixedMap.get(key) ?? 0) + amt);
      }
    }

    const cycleKey = currentCycle?.cycle_start_at?.slice(0, 7) ?? '';

    return Array.from(totalMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, total]) => {
        const [y, m] = key.split('-').map(Number);
        const label = new Date(y, m - 1, 1).toLocaleDateString(i18n.language, {
          month: 'long', year: 'numeric',
        });
        const fixed = fixedMap.get(key) ?? 0;
        return {
          key, label, total,
          fixed,
          variable: Math.max(0, total - fixed),
          isCurrentCycle: key === cycleKey,
        };
      });
  }, [transactions, currentCycle, fixedExpCatID, i18n.language]);

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
          <div className="hist-modal-icon expense-icon"><TrendingDown size={18} /></div>
          <h2 className="hist-modal-title">{t('dashboard.expenses')} — {t('dashboard.history_label')}</h2>
          <button className="hist-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="hist-modal-body">
          {groups.length === 0 ? (
            <p className="hist-modal-empty">{t('transactions.no_transactions')}</p>
          ) : (
            groups.map(g => (
              <div key={g.key} className={`hist-row${g.isCurrentCycle ? ' hist-row--active' : ''}`}>
                <div className="hist-row-left">
                  <span className="hist-row-label">{g.label}</span>
                  {g.isCurrentCycle && <span className="hist-row-badge">{t('salary_cycle.active_cycle')}</span>}
                  {g.fixed > 0 && (
                    <span className="hist-row-breakdown">
                      {t('dashboard.expenses_fixed')}: {formatAmount(g.fixed)}
                      {g.variable > 0 && ` · ${t('dashboard.expenses_variable')}: ${formatAmount(g.variable)}`}
                    </span>
                  )}
                </div>
                <span className="hist-row-amount expense-amount">-{formatAmount(g.total)}</span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ExpensesHistoryModal;
