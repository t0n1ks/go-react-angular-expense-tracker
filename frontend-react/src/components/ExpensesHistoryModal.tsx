import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, TrendingDown, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { type SalaryCycle } from '../context/SettingsContext';

interface Transaction {
  id: number;
  amount: number;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal';
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
  onCycleDeleted?: () => void;
}

interface CycleGroup {
  key: string;
  label: string;
  total: number;
  fixed: number;
  variable: number;
  isCurrentCycle: boolean;
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

const ExpensesHistoryModal: React.FC<Props> = ({
  transactions, currentCycle, fixedExpCatID, formatAmount, onClose, onCycleDeleted,
}) => {
  const { t, i18n } = useTranslation();
  const { axiosInstance } = useAuth();
  const [cycles, setCycles] = useState<SalaryCycle[]>(currentCycle ? [currentCycle] : []);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await axiosInstance.delete(`/salary-cycle/${pendingDeleteId}`);
      setCycles(prev => prev.filter(c => c.id !== pendingDeleteId));
      setPendingDeleteId(null);
      onCycleDeleted?.();
    } catch {
      setDeleteError(t('dashboard.delete_cycle_error'));
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    axiosInstance.get('/salary-cycle/history')
      .then((res: { data: { cycles: SalaryCycle[] } }) => {
        if (res.data.cycles?.length) setCycles(res.data.cycles);
      })
      .catch(() => { /* keep currentCycle fallback */ });
  }, [axiosInstance]);

  const groups = useMemo<CycleGroup[]>(() => {
    if (!cycles.length) {
      // Legacy path: calendar-month grouping
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
      return Array.from(totalMap.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, total]) => {
          const [y, m] = key.split('-').map(Number);
          const label = new Date(y, m - 1, 1).toLocaleDateString(i18n.language, {
            month: 'long', year: 'numeric',
          });
          const fixed = fixedMap.get(key) ?? 0;
          return { key, label, total, fixed, variable: Math.max(0, total - fixed), isCurrentCycle: false };
        });
    }

    // Cycle-aware path: group strictly by salary cycle window.
    const sorted = [...cycles].sort((a, b) => a.cycle_start_at.localeCompare(b.cycle_start_at));
    const result: CycleGroup[] = [];

    // Pre-cycle bucket — show actual date range instead of generic label.
    const firstStart = sorted[0]?.cycle_start_at.slice(0, 10) ?? '';
    if (firstStart) {
      const preTxs = transactions.filter(
        tx => tx.type === 'expense' && (tx.created_at ?? tx.date).slice(0, 10) < firstStart
      );
      if (preTxs.length > 0) {
        let preTotal = 0, preFixed = 0;
        const preDates: string[] = [];
        for (const tx of preTxs) {
          const amt = Number(tx.amount);
          preTotal += amt;
          if (fixedExpCatID > 0 && tx.category?.id === fixedExpCatID) preFixed += amt;
          preDates.push((tx.created_at ?? tx.date).slice(0, 10));
        }
        const minDate = [...preDates].sort()[0];
        const maxDate = new Date(firstStart + 'T12:00:00');
        maxDate.setDate(maxDate.getDate() - 1);
        const fromStr = new Date(minDate + 'T12:00:00').toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
        const toStr   = maxDate.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric', year: 'numeric' });

        result.push({
          key: '__pre_cycle__',
          label: `${fromStr} – ${toStr}`,
          total: preTotal,
          fixed: preFixed,
          variable: Math.max(0, preTotal - preFixed),
          isCurrentCycle: false,
        });
      }
    }

    sorted.forEach((cycle, idx) => {
      const startDate = cycle.cycle_start_at.slice(0, 10);
      const endDate = idx < sorted.length - 1
        ? sorted[idx + 1].cycle_start_at.slice(0, 10)
        : null;

      const isCurrentCycle = idx === sorted.length - 1;

      let total = 0, fixed = 0;
      for (const tx of transactions) {
        if (tx.type !== 'expense') continue;
        const d = (tx.created_at ?? tx.date).slice(0, 10);
        if (d < startDate || (endDate !== null && d >= endDate)) continue;
        const amt = Number(tx.amount);
        total += amt;
        if (fixedExpCatID > 0 && tx.category?.id === fixedExpCatID) fixed += amt;
      }

      if (total === 0 && !isCurrentCycle) return;

      result.push({
        key: String(cycle.id),
        label: cycleDateLabel(cycle.cycle_start_at, cycle.next_payday_at, i18n.language),
        total,
        fixed,
        variable: Math.max(0, total - fixed),
        isCurrentCycle,
      });
    });

    return result.reverse();
  }, [transactions, cycles, fixedExpCatID, i18n.language, t]);

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
          {/* Inline delete confirmation */}
          {pendingDeleteId !== null && (
            <div className="hist-delete-confirm">
              <span>{t('dashboard.delete_cycle_confirm')}</span>
              <button className="hist-delete-ok" onClick={handleDeleteConfirm} disabled={deleting} type="button">
                {deleting ? '…' : t('common.delete')}
              </button>
              <button className="hist-delete-cancel" onClick={() => { setPendingDeleteId(null); setDeleteError(''); }} type="button">
                {t('transactions.cancel_btn')}
              </button>
              {deleteError && <span className="hist-delete-error">{deleteError}</span>}
            </div>
          )}

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
                  {g.fixed > 0 && (
                    <span className="hist-row-breakdown">
                      {t('dashboard.expenses_fixed')}: {formatAmount(g.fixed)}
                      {g.variable > 0 && ` · ${t('dashboard.expenses_variable')}: ${formatAmount(g.variable)}`}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="hist-row-amount expense-amount">-{formatAmount(g.total)}</span>
                  {g.key !== '__pre_cycle__' && (
                    <button
                      className="hist-row-delete-btn"
                      onClick={e => { e.stopPropagation(); setPendingDeleteId(Number(g.key)); setDeleteError(''); }}
                      title={t('dashboard.delete_cycle_btn')}
                      type="button"
                      aria-label={t('dashboard.delete_cycle_btn')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ExpensesHistoryModal;
