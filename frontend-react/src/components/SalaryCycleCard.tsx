import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Banknote, ChevronDown, ChevronUp, Plus, Trash2, AlertTriangle, CheckCircle, Rocket, Info, X, Ban, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings, type SalaryCycle } from '../context/SettingsContext';
import CyclePaydayEditor from './CyclePaydayEditor';
import './SalaryCycleCard.css';

// Clickable info icon — opens a dismissible modal with the full explanation.
// This replaces CSS-only hover tooltips that overflow on mobile.
const InfoTip: React.FC<{ text: string; onOpen: (text: string) => void }> = ({ text, onOpen }) => (
  <button
    type="button"
    className="sc-infotip"
    onClick={e => { e.stopPropagation(); onOpen(text); }}
    aria-label="More information"
  >
    <Info size={13} />
  </button>
);

interface FixedExpenseRow {
  id: string;
  amount: string;
  description: string;
  category_type: 'need' | 'want';
}

type RatioProfile = '50/30/20' | '65/20/15' | '50/20/30' | 'custom';

const PROFILES: Record<RatioProfile, [number, number, number] | null> = {
  '50/30/20': [50, 30, 20],
  '65/20/15': [65, 20, 15],
  '50/20/30': [50, 20, 30],
  custom: null,
};

function uid(): string {
  return Math.random().toString(36).slice(2);
}

interface Props {
  onCycleStarted: (cycle: SalaryCycle) => void;
}

const todayDateStr = () => new Date().toISOString().slice(0, 10);

const SalaryCycleCard: React.FC<Props> = ({ onCycleStarted }) => {
  const { t, i18n } = useTranslation();
  const { axiosInstance } = useAuth();
  const { currentCycle, hasActiveCycle, resumableCycle, refreshCycle, formatAmount } = useSettings();

  const today = todayDateStr();

  const [expanded, setExpanded] = useState(!hasActiveCycle);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const [resuming, setResuming] = useState(false);

  // Soft-stop the active cycle (job loss). History is preserved; the user falls
  // back to the no-salary monthly budget and can start a new cycle later.
  const handleStop = async () => {
    setStopping(true);
    try {
      await axiosInstance.post('/salary-cycle/stop');
      await refreshCycle();
      setConfirmStop(false);
    } catch {
      // leave the dialog open on failure
    } finally {
      setStopping(false);
    }
  };

  // Resume a stopped-but-resumable cycle — non-destructive, just clears the
  // stopped flag server-side; all data is already intact.
  const handleResume = async () => {
    setResuming(true);
    try {
      await axiosInstance.post('/salary-cycle/resume');
      await refreshCycle();
      setConfirmResume(false);
    } catch {
      // leave the dialog open on failure
    } finally {
      setResuming(false);
    }
  };

  // Collapse to the summary when a cycle is active; auto-expand when there's no
  // active cycle so the Resume / create actions are immediately visible.
  useEffect(() => {
    setExpanded(!hasActiveCycle);
  }, [hasActiveCycle]);

  const [baseSalary, setBaseSalary] = useState('');
  const [bonuses, setBonuses] = useState('');
  const [receivedAtDate, setReceivedAtDate] = useState(today);
  const [nextPayday, setNextPayday] = useState('');
  const [ratioProfile, setRatioProfile] = useState<RatioProfile>('50/30/20');
  const [customNeeds, setCustomNeeds] = useState('50');
  const [customWants, setCustomWants] = useState('30');
  const [customSavings, setCustomSavings] = useState('20');
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpenseRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [tipContent, setTipContent] = useState<string | null>(null);

  const getRatioValues = (): [number, number, number] => {
    const preset = PROFILES[ratioProfile];
    if (preset) return preset;
    return [
      parseFloat(customNeeds) || 50,
      parseFloat(customWants) || 30,
      parseFloat(customSavings) || 20,
    ];
  };

  const totalIncome = (parseFloat(baseSalary) || 0) + (parseFloat(bonuses) || 0);
  const [needsPct, wantsPct, savingsPct] = getRatioValues();
  const needsLimit = totalIncome * needsPct / 100;
  const wantsLimit = totalIncome * wantsPct / 100;
  const savingsLimit = totalIncome * savingsPct / 100;

  const fixedNeedsTotal = fixedExpenses
    .filter(fe => fe.category_type === 'need')
    .reduce((s, fe) => s + (parseFloat(fe.amount) || 0), 0);
  const fixedWantsTotal = fixedExpenses
    .filter(fe => fe.category_type === 'want')
    .reduce((s, fe) => s + (parseFloat(fe.amount) || 0), 0);

  const varNeedsBudget = needsLimit - fixedNeedsTotal;
  const varWantsBudget = wantsLimit - fixedWantsTotal;
  const deficitWarning = varNeedsBudget < 0;

  const ratioSum = needsPct + wantsPct + savingsPct;
  const ratioValid = Math.abs(ratioSum - 100) < 0.1;

  const addFixedExpense = useCallback(() => {
    setFixedExpenses(prev => [...prev, { id: uid(), amount: '', description: '', category_type: 'need' }]);
  }, []);

  const removeFixedExpense = useCallback((id: string) => {
    setFixedExpenses(prev => prev.filter(fe => fe.id !== id));
  }, []);

  const updateFixedExpense = useCallback((id: string, field: keyof FixedExpenseRow, value: string) => {
    setFixedExpenses(prev => prev.map(fe => fe.id === id ? { ...fe, [field]: value } : fe));
  }, []);

  const handleSubmit = async () => {
    if (!baseSalary || parseFloat(baseSalary) <= 0) {
      setErrorMsg(t('salary_cycle.error'));
      return;
    }
    if (!ratioValid) {
      setErrorMsg('needs_pct + wants_pct + savings_pct must equal 100');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const payload = {
        base_salary: parseFloat(baseSalary),
        bonuses: parseFloat(bonuses) || 0,
        received_at_date: receivedAtDate || undefined,
        next_payday_date: nextPayday || undefined,
        language: i18n.resolvedLanguage ?? 'en',
        needs_pct: needsPct,
        wants_pct: wantsPct,
        savings_pct: savingsPct,
        fixed_expenses: fixedExpenses
          .filter(fe => parseFloat(fe.amount) > 0)
          .map(fe => ({
            amount: parseFloat(fe.amount),
            description: fe.description.trim(),
            category_type: fe.category_type,
          })),
      };

      const res = await axiosInstance.post('/salary-cycle', payload);
      const cycle: SalaryCycle = res.data.cycle;

      await refreshCycle();
      onCycleStarted(cycle);

      setSuccessMsg(t('salary_cycle.success'));
      setExpanded(false);
      // Reset form
      setBaseSalary('');
      setBonuses('');
      setReceivedAtDate(today);
      setNextPayday('');
      setFixedExpenses([]);
      setRatioProfile('50/30/20');
    } catch {
      setErrorMsg(t('salary_cycle.error'));
    } finally {
      setSaving(false);
    }
  };

  const cycleStartDate = currentCycle
    ? new Date(currentCycle.cycle_start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
  const activeWindowLabel = currentCycle
    ? `${fmtShort(currentCycle.cycle_start_at)} – ${currentCycle.next_payday_at ? fmtShort(currentCycle.next_payday_at) : '…'}`
    : '';
  const resumeRange = resumableCycle
    ? `${fmtShort(resumableCycle.cycle_start_at)}–${resumableCycle.next_payday_at ? fmtShort(resumableCycle.next_payday_at) : '…'}`
    : '';

  return (
    <>
    <div className="sc-card">
      <button
        className="sc-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        type="button"
      >
        <div className="sc-header-left">
          <div className="sc-icon">
            <Banknote size={20} />
          </div>
          {/* Left-aligned text block: status is STACKED above the title (not
              beside it) so a long title — German is the stress case — never
              competes with the status for width. */}
          <div className="sc-header-text">
            {currentCycle && !expanded && (
              <span className={`sc-status${hasActiveCycle ? ' sc-status--active' : ' sc-status--inactive'}`}>
                <span className="sc-status-dot" />
                {hasActiveCycle ? t('salary_cycle.status_active') : t('salary_cycle.status_inactive')}
              </span>
            )}
            <span className="sc-title">{t('salary_cycle.title')}</span>
            {currentCycle && !expanded && (
              <span className="sc-subtitle">
                {t('salary_cycle.cycle_since', { date: cycleStartDate })}
              </span>
            )}
          </div>
        </div>
        <div className="sc-header-right">
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="sc-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            {hasActiveCycle ? (
              /* ── Active-cycle panel: info + end-date editing (commit 3) + stop.
                 The stop action lives ONLY here, never on the collapsed card. */
              <div className="sc-active-panel">
                <div className="sc-active-info">
                  <div className="sc-active-info-row">
                    <span className="sc-active-info-label">{t('salary_cycle.window_label')}</span>
                    <span className="sc-active-info-value">{activeWindowLabel}</span>
                  </div>
                  {currentCycle && (
                    <div className="sc-active-info-row">
                      <span className="sc-active-info-label">{t('salary_cycle.income_label')}</span>
                      <span className="sc-active-info-value">{formatAmount(currentCycle.total_income)}</span>
                    </div>
                  )}
                </div>

                {/* A stopped cycle is resumable but this one is active → the one-
                    active-cycle rule blocks it; explain how to enable Resume. */}
                {resumableCycle && (
                  <p className="sc-resume-blocked-hint">{t('salary_cycle.resume_blocked_hint')}</p>
                )}

                {/* End-date (next payday) editing — moved here from the budget
                    card, with all its Phase 3 validation. */}
                <CyclePaydayEditor />

                <div className="sc-panel-actions">
                  <button type="button" className="sc-stop-btn" onClick={() => setConfirmStop(true)}>
                    <Ban size={14} /> {t('salary_cycle.stop_btn')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {resumableCycle && (
                  <div className="sc-resume-block">
                    <p className="sc-resume-caption">
                      {t('salary_cycle.resume_caption', { range: resumeRange })}
                    </p>
                    <button
                      type="button"
                      className="sc-resume-btn"
                      onClick={() => setConfirmResume(true)}
                    >
                      <RotateCcw size={15} /> {t('salary_cycle.resume_btn')}
                    </button>
                    <div className="sc-divider" />
                    <h3 className="sc-or-heading">{t('salary_cycle.or_create_new')}</h3>
                  </div>
                )}
                <p className="sc-hint">{t('salary_cycle.subtitle')}</p>

            {/* ── Salary inputs ── */}
            <div className="sc-row">
              <div className="sc-field">
                <label className="sc-label">{t('salary_cycle.base_salary')}</label>
                <input
                  className="sc-input"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 2000"
                  value={baseSalary}
                  onChange={e => setBaseSalary(e.target.value)}
                />
              </div>
              <div className="sc-field">
                <label className="sc-label">{t('salary_cycle.bonuses')}</label>
                <input
                  className="sc-input"
                  type="number"
                  min="0"
                  step="any"
                  placeholder={t('salary_cycle.bonuses_ph')}
                  value={bonuses}
                  onChange={e => setBonuses(e.target.value)}
                />
              </div>
              <div className="sc-field">
                <label className="sc-label">{t('salary_cycle.received_date')}</label>
                <input
                  className="sc-input"
                  type="date"
                  max={today}
                  value={receivedAtDate}
                  onChange={e => setReceivedAtDate(e.target.value)}
                />
              </div>
              <div className="sc-field">
                <label className="sc-label">{t('salary_cycle.next_payday')}</label>
                <input
                  className="sc-input"
                  type="date"
                  min={today}
                  value={nextPayday}
                  onChange={e => setNextPayday(e.target.value)}
                />
              </div>
            </div>

            {/* ── Budget ratio ── */}
            <div className="sc-section">
              <label className="sc-section-label">
                {t('salary_cycle.ratio_title')}
                <InfoTip text={t('salary_cycle.ratio_tooltip')} onOpen={setTipContent} />
              </label>
              <div className="sc-ratio-tabs">
                {(['50/30/20', '65/20/15', '50/20/30', 'custom'] as RatioProfile[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    className={`sc-ratio-tab${ratioProfile === p ? ' sc-ratio-tab--active' : ''}`}
                    onClick={() => setRatioProfile(p)}
                  >
                    {t(`salary_cycle.ratio_${p === '50/30/20' ? 'default' : p === '65/20/15' ? 'tight' : p === '50/20/30' ? 'saver' : 'custom'}`)}
                  </button>
                ))}
              </div>
              {ratioProfile === 'custom' && (
                <div className="sc-row sc-custom-ratio">
                  {[
                    { label: t('salary_cycle.needs_label'), val: customNeeds, set: setCustomNeeds },
                    { label: t('salary_cycle.wants_label'), val: customWants, set: setCustomWants },
                    { label: t('salary_cycle.savings_label'), val: customSavings, set: setCustomSavings },
                  ].map(({ label, val, set }) => (
                    <div className="sc-field" key={label}>
                      <label className="sc-label">{label} %</label>
                      <input
                        className={`sc-input${!ratioValid ? ' sc-input--error' : ''}`}
                        type="number"
                        min="0"
                        max="100"
                        value={val}
                        onChange={e => set(e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
              {!ratioValid && (
                <p className="sc-error-text">⚠ {needsPct + wantsPct + savingsPct}% — must equal 100%</p>
              )}
            </div>

            {/* ── Fixed expenses ── */}
            <div className="sc-section">
              <div className="sc-section-header">
                <label className="sc-section-label">
                  {t('salary_cycle.fixed_expenses')}
                  <InfoTip text={t('salary_cycle.fixed_tooltip')} onOpen={setTipContent} />
                </label>
                <span className="sc-section-hint">{t('salary_cycle.fixed_expenses_hint')}</span>
              </div>
              {fixedExpenses.map(fe => (
                <div key={fe.id} className="sc-fixed-row">
                  <input
                    className="sc-input sc-input--sm"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={t('salary_cycle.amount_ph')}
                    value={fe.amount}
                    onChange={e => updateFixedExpense(fe.id, 'amount', e.target.value)}
                  />
                  <input
                    className="sc-input sc-input--grow"
                    type="text"
                    placeholder={t('salary_cycle.desc_ph')}
                    value={fe.description}
                    onChange={e => updateFixedExpense(fe.id, 'description', e.target.value)}
                    maxLength={80}
                  />
                  <div className="sc-toggle-group">
                    <button
                      type="button"
                      className={`sc-toggle-btn${fe.category_type === 'need' ? ' sc-toggle-btn--active' : ''}`}
                      onClick={() => updateFixedExpense(fe.id, 'category_type', 'need')}
                    >
                      {t('salary_cycle.category_need')}
                    </button>
                    <button
                      type="button"
                      className={`sc-toggle-btn sc-toggle-btn--want${fe.category_type === 'want' ? ' sc-toggle-btn--active sc-toggle-btn--want-active' : ''}`}
                      onClick={() => updateFixedExpense(fe.id, 'category_type', 'want')}
                    >
                      {t('salary_cycle.category_want')}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="sc-remove-btn"
                    onClick={() => removeFixedExpense(fe.id)}
                    aria-label={t('salary_cycle.remove')}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button type="button" className="sc-add-btn" onClick={addFixedExpense}>
                <Plus size={14} /> {t('salary_cycle.add_fixed')}
              </button>
            </div>

            {/* ── Live preview ── */}
            {totalIncome > 0 && (
              <div className="sc-preview">
                <p className="sc-preview-title">{t('salary_cycle.preview_title')}</p>
                {deficitWarning && (
                  <div className="sc-deficit-banner">
                    <AlertTriangle size={15} />
                    <span>{t('salary_cycle.deficit_warning')}</span>
                  </div>
                )}
                <div className="sc-preview-grid">
                  <PreviewRow
                    label={t('salary_cycle.var_needs')}
                    value={formatAmount(Math.max(varNeedsBudget, 0))}
                    sub={fixedNeedsTotal > 0 ? `– ${formatAmount(fixedNeedsTotal)} fixed` : undefined}
                    warn={deficitWarning}
                  />
                  <PreviewRow
                    label={t('salary_cycle.var_wants')}
                    value={formatAmount(Math.max(varWantsBudget, 0))}
                    sub={fixedWantsTotal > 0 ? `– ${formatAmount(fixedWantsTotal)} fixed` : undefined}
                  />
                  <PreviewRow
                    label={t('salary_cycle.savings_pool')}
                    value={formatAmount(savingsLimit)}
                    accent
                  />
                </div>
              </div>
            )}

            {/* ── Messages ── */}
            <AnimatePresence>
              {successMsg && (
                <motion.div className="sc-success-msg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <CheckCircle size={14} /> {successMsg}
                </motion.div>
              )}
              {errorMsg && (
                <motion.div className="sc-error-msg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <AlertTriangle size={14} /> {errorMsg}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              className="sc-submit-btn"
              onClick={handleSubmit}
              disabled={saving || !baseSalary || parseFloat(baseSalary) <= 0 || !ratioValid}
            >
              <Rocket size={16} />
              {saving ? '…' : t('salary_cycle.start_btn')}
            </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>

    {/* ── Info tooltip modal ───────────────────────────────────────────── */}
    {tipContent !== null && (
      <div
        className="sc-tip-overlay"
        onClick={() => setTipContent(null)}
        role="dialog"
        aria-modal
      >
        <div className="sc-tip-modal" onClick={e => e.stopPropagation()}>
          <div className="sc-tip-modal-header">
            <Info size={16} className="sc-tip-modal-icon" />
            <span className="sc-tip-modal-title">{t('salary_cycle.info_label')}</span>
            <button
              type="button"
              className="sc-tip-modal-close"
              onClick={() => setTipContent(null)}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <p className="sc-tip-modal-body">{tipContent}</p>
        </div>
      </div>
    )}

    {/* ── Stop-cycle confirm (reversible, non-destructive) ──────────────── */}
    {confirmStop && (
      <div
        className="sc-tip-overlay"
        onClick={() => !stopping && setConfirmStop(false)}
        role="dialog"
        aria-modal
      >
        <div className="sc-tip-modal" onClick={e => e.stopPropagation()}>
          <div className="sc-tip-modal-header">
            <Ban size={16} className="sc-tip-modal-icon" />
            <span className="sc-tip-modal-title">{t('salary_cycle.stop_confirm_title')}</span>
            <button
              type="button"
              className="sc-tip-modal-close"
              onClick={() => setConfirmStop(false)}
              disabled={stopping}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <p className="sc-tip-modal-body">{t('salary_cycle.stop_confirm_body')}</p>
          <div className="sc-stop-confirm-actions">
            <button
              type="button"
              className="sc-stop-cancel"
              onClick={() => setConfirmStop(false)}
              disabled={stopping}
            >
              {t('salary_cycle.stop_cancel')}
            </button>
            <button
              type="button"
              className="sc-stop-confirm"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? '…' : t('salary_cycle.stop_confirm_btn')}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Resume-cycle confirm (non-destructive) ────────────────────────── */}
    {confirmResume && (
      <div
        className="sc-tip-overlay"
        onClick={() => !resuming && setConfirmResume(false)}
        role="dialog"
        aria-modal
      >
        <div className="sc-tip-modal" onClick={e => e.stopPropagation()}>
          <div className="sc-tip-modal-header">
            <RotateCcw size={16} className="sc-tip-modal-icon" />
            <span className="sc-tip-modal-title">{t('salary_cycle.resume_confirm_title')}</span>
            <button
              type="button"
              className="sc-tip-modal-close"
              onClick={() => setConfirmResume(false)}
              disabled={resuming}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <p className="sc-tip-modal-body">{t('salary_cycle.resume_confirm_body')}</p>
          <div className="sc-stop-confirm-actions">
            <button
              type="button"
              className="sc-stop-cancel"
              onClick={() => setConfirmResume(false)}
              disabled={resuming}
            >
              {t('salary_cycle.stop_cancel')}
            </button>
            <button
              type="button"
              className="sc-resume-confirm"
              onClick={handleResume}
              disabled={resuming}
            >
              {resuming ? '…' : t('salary_cycle.resume_confirm_btn')}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

interface PreviewRowProps {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
  accent?: boolean;
}

const PreviewRow: React.FC<PreviewRowProps> = ({ label, value, sub, warn, accent }) => (
  <div className={`sc-preview-row${warn ? ' sc-preview-row--warn' : accent ? ' sc-preview-row--accent' : ''}`}>
    <span className="sc-preview-label">{label}</span>
    <span className="sc-preview-value">
      {value}
      {sub && <span className="sc-preview-sub">{sub}</span>}
    </span>
  </div>
);

export default SalaryCycleCard;
