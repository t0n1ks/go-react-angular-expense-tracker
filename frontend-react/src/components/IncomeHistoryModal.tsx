import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { type SalaryCycle } from '../context/SettingsContext';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
  created_at?: string;
  category?: { id: number; name: string };
}

interface Props {
  transactions: Transaction[];
  currentCycle: SalaryCycle | null;
  formatAmount: (n: number) => string;
  onClose: () => void;
}

interface MonthGroup {
  key: string;         // "YYYY-MM"
  label: string;
  total: number;
  isCurrentCycle: boolean;
  baseSalary?: number;
  bonuses?: number;
}

const IncomeHistoryModal: React.FC<Props> = ({ transactions, currentCycle, formatAmount, onClose }) => {
  const { t, i18n } = useTranslation();

  const groups = useMemo<MonthGroup[]>(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.type !== 'income') continue;
      const key = (tx.created_at ?? tx.date).slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(tx.amount));
    }

    const cycleKey = currentCycle?.cycle_start_at?.slice(0, 7) ?? '';

    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, total]) => {
        const [y, m] = key.split('-').map(Number);
        const label = new Date(y, m - 1, 1).toLocaleDateString(i18n.language, {
          month: 'long', year: 'numeric',
        });
        const isCurrentCycle = key === cycleKey;
        return {
          key, label, total, isCurrentCycle,
          baseSalary: isCurrentCycle ? currentCycle?.base_salary : undefined,
          bonuses:    isCurrentCycle && (currentCycle?.bonuses ?? 0) > 0
            ? currentCycle?.bonuses
            : undefined,
        };
      });
  }, [transactions, currentCycle, i18n.language]);

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
          <div className="hist-modal-icon income-icon"><TrendingUp size={18} /></div>
          <h2 className="hist-modal-title">{t('dashboard.income')} — {t('dashboard.history_label')}</h2>
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
                  {(g.baseSalary !== undefined || g.bonuses !== undefined) && (
                    <span className="hist-row-breakdown">
                      {g.baseSalary !== undefined && `${t('dashboard.income_salary')}: ${formatAmount(g.baseSalary)}`}
                      {g.bonuses !== undefined && ` · ${t('dashboard.income_bonuses')}: ${formatAmount(g.bonuses)}`}
                    </span>
                  )}
                </div>
                <span className="hist-row-amount income-amount">+{formatAmount(g.total)}</span>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default IncomeHistoryModal;
