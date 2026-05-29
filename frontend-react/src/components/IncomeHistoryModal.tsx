import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
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

interface CycleGroup {
  key: string;
  label: string;
  total: number;
  isCurrentCycle: boolean;
  baseSalary?: number;
  bonuses?: number;
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
    const toStr = to.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${fromStr} – ${toStr}`;
  }
  return `${fromStr} – …`;
}

const IncomeHistoryModal: React.FC<Props> = ({ transactions, currentCycle, formatAmount, onClose }) => {
  const { t, i18n } = useTranslation();
  const { axiosInstance } = useAuth();
  const [cycles, setCycles] = useState<SalaryCycle[]>(currentCycle ? [currentCycle] : []);

  useEffect(() => {
    axiosInstance.get('/salary-cycle/history')
      .then((res: { data: { cycles: SalaryCycle[] } }) => {
        if (res.data.cycles?.length) setCycles(res.data.cycles);
      })
      .catch(() => { /* keep currentCycle fallback */ });
  }, [axiosInstance]);

  const groups = useMemo<CycleGroup[]>(() => {
    if (!cycles.length) {
      // Legacy path: calendar-month grouping when no cycles exist
      const map = new Map<string, number>();
      for (const tx of transactions) {
        if (tx.type !== 'income') continue;
        const key = (tx.created_at ?? tx.date).slice(0, 7);
        map.set(key, (map.get(key) ?? 0) + Number(tx.amount));
      }
      return Array.from(map.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, total]) => {
          const [y, m] = key.split('-').map(Number);
          const label = new Date(y, m - 1, 1).toLocaleDateString(i18n.language, {
            month: 'long', year: 'numeric',
          });
          return { key, label, total, isCurrentCycle: false };
        });
    }

    // Cycle-aware path: group transactions by salary cycle boundaries.
    // Sorted ascending so we can derive end = next cycle's start.
    const sorted = [...cycles].sort((a, b) => a.cycle_start_at.localeCompare(b.cycle_start_at));
    const result: CycleGroup[] = [];

    // Pre-cycle bucket: income before the very first cycle started
    const firstStart = sorted[0]?.cycle_start_at.slice(0, 10) ?? '';
    if (firstStart) {
      const preTotal = transactions
        .filter(tx => tx.type === 'income')
        .filter(tx => (tx.created_at ?? tx.date).slice(0, 10) < firstStart)
        .reduce((s, tx) => s + Number(tx.amount), 0);
      if (preTotal > 0) {
        result.push({
          key: '__pre_cycle__',
          label: t('dashboard.pre_cycle_label'),
          total: preTotal,
          isCurrentCycle: false,
        });
      }
    }

    sorted.forEach((cycle, idx) => {
      const startDate = cycle.cycle_start_at.slice(0, 10);
      const endDate = idx < sorted.length - 1
        ? sorted[idx + 1].cycle_start_at.slice(0, 10)
        : null; // last / active cycle: open-ended

      const isCurrentCycle = idx === sorted.length - 1;

      const total = transactions
        .filter(tx => tx.type === 'income')
        .filter(tx => {
          const d = (tx.created_at ?? tx.date).slice(0, 10);
          return d >= startDate && (endDate === null || d < endDate);
        })
        .reduce((s, tx) => s + Number(tx.amount), 0);

      // Skip empty historical cycles (active cycle always shown)
      if (total === 0 && !isCurrentCycle) return;

      result.push({
        key: String(cycle.id),
        label: cycleDateLabel(cycle.cycle_start_at, cycle.next_payday_at, i18n.language),
        total,
        isCurrentCycle,
        // Show cycle-snapshot breakdown only for the active cycle
        baseSalary: isCurrentCycle ? cycle.base_salary : undefined,
        bonuses: isCurrentCycle && cycle.bonuses > 0 ? cycle.bonuses : undefined,
      });
    });

    // Newest first
    return result.reverse();
  }, [transactions, cycles, i18n.language, t]);

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
                  {g.isCurrentCycle && (
                    <span className="hist-row-badge">{t('salary_cycle.active_cycle')}</span>
                  )}
                  {(g.baseSalary !== undefined || g.bonuses !== undefined) && (
                    <span className="hist-row-breakdown">
                      {g.baseSalary !== undefined && `${t('dashboard.income_salary')}: ${formatAmount(g.baseSalary)}`}
                      {g.bonuses !== undefined && ` · ${t('dashboard.income_bonuses')}: ${formatAmount(g.bonuses)}`}
                      {g.baseSalary !== undefined &&
                        g.total - (g.baseSalary + (g.bonuses ?? 0)) > 0.01 && (
                          ` · ${t('dashboard.income_other')}: ${formatAmount(g.total - g.baseSalary - (g.bonuses ?? 0))}`
                        )}
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
