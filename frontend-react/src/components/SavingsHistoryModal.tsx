import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, PiggyBank, Plus, Minus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { type SalaryCycle, type CycleStats } from '../context/SettingsContext';

interface SavingsTx {
  id: number;
  amount: number;
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal';
  date: string;
  created_at?: string;
  description?: string;
}

interface Props {
  currentCycle: SalaryCycle | null;
  formatAmount: (n: number) => string;
  savedMoneyBalance: number;
  onClose: () => void;
  /** Called after a manual savings entry is saved so the parent can refresh stats. */
  onSaved?: (updatedStats: CycleStats) => void;
}


const SavingsHistoryModal: React.FC<Props> = ({
  currentCycle: _currentCycle, formatAmount, savedMoneyBalance, onClose, onSaved,
}) => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();

  const [txs, setTxs] = useState<SavingsTx[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Delete state ─────────────────────────────────────────────────────────
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // ── Manual savings entry form ────────────────────────────────────────────
  const [entryMode, setEntryMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryNote, setEntryNote] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const [entryError, setEntryError] = useState('');

  const fetchTxs = () =>
    axiosInstance.get('/salary-cycle/savings-history')
      .then((res: { data: { transactions: SavingsTx[] } }) => setTxs(res.data.transactions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { fetchTxs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const raw = parseFloat(entryAmount);
    if (!raw || raw <= 0) { setEntryError(t('dashboard.savings_amount_error')); return; }
    setEntrySaving(true);
    setEntryError('');
    try {
      const amount = entryMode === 'withdraw' ? -raw : raw;
      const res = await axiosInstance.post('/salary-cycle/savings', {
        amount,
        description: entryNote.trim() || undefined,
      });
      setEntryAmount('');
      setEntryNote('');
      setLoading(true);
      await fetchTxs();
      if (onSaved && res.data.cycle_stats) {
        onSaved(res.data.cycle_stats as CycleStats);
      }
    } catch (err: unknown) {
      const apiMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setEntryError(apiMsg || t('dashboard.savings_add_error'));
      console.error('[SavingsModal] save failed:', err);
    } finally {
      setEntrySaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await axiosInstance.delete(`/transactions/${pendingDeleteId}`);
      setTxs(prev => prev.filter(t => t.id !== pendingDeleteId));
      setPendingDeleteId(null);
      const statsRes = await axiosInstance.get('/salary-cycle/current');
      if (onSaved && statsRes.data.cycle_stats) {
        onSaved(statsRes.data.cycle_stats as CycleStats);
      }
    } catch {
      setDeleteError(t('dashboard.savings_delete_error'));
    } finally {
      setDeleting(false);
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
      >
        {/* Header */}
        <div className="hist-modal-header">
          <div className="hist-modal-icon" style={{ color: '#10b981' }}><PiggyBank size={18} /></div>
          <h2 className="hist-modal-title">{t('dashboard.saved_money')} — {t('dashboard.history_label')}</h2>
          <button className="hist-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Pool balance */}
        <div style={{ padding: '0.5rem 1.25rem', background: 'rgba(16,185,129,0.07)', borderBottom: '1px solid var(--color-border-card)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {t('dashboard.savings_balance')}:&nbsp;
          </span>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#10b981' }}>
            {formatAmount(savedMoneyBalance)}
          </span>
        </div>

        {/* Transaction list */}
        <div className="hist-modal-body">
          {/* Inline delete confirmation */}
          {pendingDeleteId !== null && (
            <div className="hist-delete-confirm">
              <span>{t('dashboard.savings_delete_confirm')}</span>
              <button className="hist-delete-ok" onClick={handleDeleteConfirm} disabled={deleting} type="button">
                {deleting ? '…' : t('common.delete')}
              </button>
              <button className="hist-delete-cancel" onClick={() => { setPendingDeleteId(null); setDeleteError(''); }} type="button">
                {t('transactions.cancel_btn')}
              </button>
              {deleteError && <span className="hist-delete-error">{deleteError}</span>}
            </div>
          )}

          {loading ? (
            <p className="hist-modal-empty">{t('common.loading')}</p>
          ) : txs.length === 0 ? (
            <p className="hist-modal-empty">{t('dashboard.savings_empty')}</p>
          ) : (
            txs.map(tx => {
              const isDeposit = tx.type === 'income' || tx.type === 'savings_deposit';
              const dateLabel = (tx.created_at ?? tx.date).slice(0, 10);
              return (
                <div key={tx.id} className={`hist-row${isDeposit ? ' hist-row--active' : ''}`}>
                  <div className="hist-row-left">
                    <span className="hist-row-label">{dateLabel}</span>
                    {tx.description && (
                      <span className="hist-row-breakdown">{tx.description}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="hist-row-amount" style={{ color: isDeposit ? '#10b981' : '#f87171' }}>
                      {isDeposit ? '+' : '-'}{formatAmount(tx.amount)}
                    </span>
                    <button
                      className="hist-row-delete-btn"
                      onClick={e => { e.stopPropagation(); setPendingDeleteId(tx.id); setDeleteError(''); }}
                      title={t('common.delete')}
                      type="button"
                      aria-label={t('common.delete')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ── Manual savings entry form ──────────────────────────────────── */}
        <div style={{
          borderTop: '1px solid var(--color-border-card)',
          padding: '0.9rem 1.25rem',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 0.6rem' }}>
            {t('dashboard.savings_add_label')}
          </p>

          {/* Deposit / Withdraw toggle */}
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem' }}>
            {(['deposit', 'withdraw'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => setEntryMode(mode)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.3rem 0.65rem',
                  borderRadius: '20px',
                  border: '1px solid',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  background: entryMode === mode
                    ? (mode === 'deposit' ? 'rgba(16,185,129,0.15)' : 'rgba(248,113,113,0.15)')
                    : 'transparent',
                  borderColor: entryMode === mode
                    ? (mode === 'deposit' ? '#10b981' : '#f87171')
                    : 'var(--color-border-card)',
                  color: entryMode === mode
                    ? (mode === 'deposit' ? '#10b981' : '#f87171')
                    : 'var(--color-text-muted)',
                }}
              >
                {mode === 'deposit' ? <Plus size={12} /> : <Minus size={12} />}
                {t(mode === 'deposit' ? 'dashboard.savings_deposit' : 'dashboard.savings_withdraw')}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="number"
              min="0.01"
              step="any"
              placeholder={t('dashboard.savings_amount_ph')}
              value={entryAmount}
              onChange={e => setEntryAmount(e.target.value)}
              style={{
                flex: '0 0 100px',
                background: 'var(--color-bg-input, rgba(255,255,255,0.06))',
                border: '1px solid var(--color-border-card)',
                borderRadius: '0.6rem', padding: '0.45rem 0.65rem',
                color: 'var(--color-text-heading)', fontSize: '0.875rem',
              }}
            />
            <input
              type="text"
              placeholder={t('dashboard.savings_note_ph')}
              value={entryNote}
              onChange={e => setEntryNote(e.target.value)}
              maxLength={100}
              style={{
                flex: 1, minWidth: 100,
                background: 'var(--color-bg-input, rgba(255,255,255,0.06))',
                border: '1px solid var(--color-border-card)',
                borderRadius: '0.6rem', padding: '0.45rem 0.65rem',
                color: 'var(--color-text-heading)', fontSize: '0.875rem',
              }}
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={entrySaving || !entryAmount || parseFloat(entryAmount) <= 0}
              style={{
                padding: '0.45rem 1rem',
                borderRadius: '0.6rem', border: 'none',
                background: entryMode === 'deposit'
                  ? 'linear-gradient(135deg,#10b981,#38bdf8)'
                  : 'linear-gradient(135deg,#f87171,#f59e0b)',
                color: '#fff', fontSize: '0.82rem', fontWeight: 700,
                cursor: entrySaving ? 'not-allowed' : 'pointer',
                opacity: (entrySaving || !entryAmount || parseFloat(entryAmount) <= 0) ? 0.5 : 1,
              }}
            >
              {entrySaving ? '…' : t('dashboard.savings_save_btn')}
            </button>
          </div>

          {entryError && (
            <p style={{ fontSize: '0.78rem', color: '#f87171', marginTop: '0.4rem' }}>{entryError}</p>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default SavingsHistoryModal;
