import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';

// Inline end-date (next-payday) editor for the ACTIVE salary cycle. Moved here
// from the "Weekly budget" card. All Phase 3 validation runs server-side via a
// debounced preview: 7-day minimum, no-orphan bound, no-overlap, the single
// validation gate, green/red outline, inline hints, live preview, idempotency.
const CyclePaydayEditor: React.FC = () => {
  const { t } = useTranslation();
  const { currentCycle, refreshCycle, formatAmount } = useSettings();
  const { axiosInstance } = useAuth();

  const [editing, setEditing] = useState(false);
  const [pendingDate, setPendingDate] = useState('');
  const [payErr, setPayErr] = useState<{ code: string; message: string } | null>(null);
  const [payPreview, setPayPreview] = useState<
    { minDate: string; maxDate: string; txInWindow: number; daysTotal: number; canSpend: number } | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const nextPaydayStr = currentCycle?.next_payday_at ? currentCycle.next_payday_at.slice(0, 10) : '';
  const nextPaydayDisplay = currentCycle?.next_payday_at
    ? new Date(currentCycle.next_payday_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '—';

  const openEditor = () => {
    const def = new Date();
    def.setMonth(def.getMonth() + 1);
    setPendingDate(nextPaydayStr || def.toISOString().slice(0, 10));
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setPendingDate('');
    setPayErr(null);
    setPayPreview(null);
  };

  const save = async () => {
    if (!pendingDate || saving || payErr) return;
    setSaving(true);
    try {
      await axiosInstance.patch('/salary-cycle/current', { next_payday: pendingDate });
      await refreshCycle();
      setEditing(false);
      setPayPreview(null);
      setPayErr(null);
    } catch (err: unknown) {
      const d = (err as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
      setPayErr({ code: d?.code ?? 'INVALID', message: d?.error ?? 'Failed to update payday' });
    } finally {
      setSaving(false);
    }
  };

  const hint = (code: string): string => {
    switch (code) {
      case 'CYCLE_TOO_SHORT': return t('dashboard.cycle_err_too_short');
      case 'CYCLE_END_BEFORE_LAST_TX': return t('dashboard.cycle_err_before_last_tx');
      case 'CYCLE_END_TOO_LATE': return t('dashboard.cycle_err_too_late');
      default: return payErr?.message ?? '';
    }
  };

  // Debounced server preview — single source of truth for validity + projection.
  useEffect(() => {
    if (!editing || !pendingDate) {
      setPayErr(null);
      setPayPreview(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      setChecking(true);
      try {
        const { data } = await axiosInstance.patch('/salary-cycle/current', {
          next_payday: pendingDate,
          preview: true,
        });
        if (cancelled) return;
        setPayErr(null);
        setPayPreview({
          minDate: data.min_date,
          maxDate: data.max_date,
          txInWindow: data.tx_in_window ?? 0,
          daysTotal: data.days_total ?? 0,
          canSpend: data.cycle_stats?.current_week_allowance ?? 0,
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const d = (err as {
          response?: { data?: { code?: string; error?: string; min_date?: string; max_date?: string } };
        })?.response?.data;
        setPayPreview(
          d?.min_date
            ? { minDate: d.min_date, maxDate: d.max_date ?? '', txInWindow: 0, daysTotal: 0, canSpend: 0 }
            : null,
        );
        setPayErr({ code: d?.code ?? 'INVALID', message: d?.error ?? '' });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [editing, pendingDate, axiosInstance]);

  if (!currentCycle) return null;

  return (
    <div className="cpe">
      {!editing ? (
        <div className="cpe-display">
          <span className="cpe-label">{t('dashboard.weekly_next_payday_label')}:</span>
          <span className="cpe-date">{nextPaydayDisplay}</span>
          <button type="button" className="cpe-edit-btn" onClick={openEditor} title={t('dashboard.weekly_edit_payday')}>
            <Pencil size={13} />
          </button>
        </div>
      ) : (
        <div className="cpe-form">
          <div className="cpe-controls">
            <input
              type="date"
              className={`cpe-input${payErr ? ' cpe-input--invalid' : payPreview && !checking ? ' cpe-input--valid' : ''}`}
              value={pendingDate}
              min={payPreview?.minDate || undefined}
              max={payPreview?.maxDate || undefined}
              onChange={e => setPendingDate(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className={`cpe-save${payErr ? ' cpe-save--invalid' : payPreview && !checking ? ' cpe-save--valid' : ''}`}
              onClick={save}
              disabled={!!payErr || checking || saving}
            >
              {saving ? '…' : t('dashboard.weekly_save')}
            </button>
            <button type="button" className="cpe-cancel" onClick={cancel}>
              {t('dashboard.weekly_cancel')}
            </button>
          </div>

          {payPreview && !payErr && (
            <div className="cpe-preview">
              <span>{t('dashboard.weekly_preview_length', { days: payPreview.daysTotal })}</span>
              <span>{t('dashboard.weekly_preview_tx', { count: payPreview.txInWindow })}</span>
              <span>{t('dashboard.weekly_preview_allowance', { amount: formatAmount(payPreview.canSpend) })}</span>
            </div>
          )}
          {payErr && <span className="cpe-hint">{hint(payErr.code)}</span>}
        </div>
      )}
    </div>
  );
};

export default CyclePaydayEditor;
