import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Banknote, ChevronDown, ChevronUp, Plus, Trash2, AlertTriangle, CheckCircle, Rocket } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings, type SalaryCycle } from '../context/SettingsContext';
import './SalaryCycleCard.css';

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

const SalaryCycleCard: React.FC<Props> = ({ onCycleStarted }) => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();
  const { currentCycle, refreshCycle, formatAmount } = useSettings();

  const [expanded, setExpanded] = useState(!currentCycle);
  const [baseSalary, setBaseSalary] = useState('');
  const [bonuses, setBonuses] = useState('');
  const [nextPayday, setNextPayday] = useState('');
  const [ratioProfile, setRatioProfile] = useState<RatioProfile>('50/30/20');
  const [customNeeds, setCustomNeeds] = useState('50');
  const [customWants, setCustomWants] = useState('30');
  const [customSavings, setCustomSavings] = useState('20');
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpenseRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const today = new Date().toISOString().slice(0, 10);

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
        next_payday_date: nextPayday || undefined,
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

  return (
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
          <div>
            <span className="sc-title">{t('salary_cycle.title')}</span>
            {currentCycle && !expanded && (
              <span className="sc-subtitle">
                {t('salary_cycle.cycle_since', { date: cycleStartDate })}
              </span>
            )}
          </div>
        </div>
        <div className="sc-header-right">
          {currentCycle && !expanded && (
            <span className="sc-active-badge">{t('salary_cycle.active_cycle')}</span>
          )}
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
              <label className="sc-section-label">{t('salary_cycle.ratio_title')}</label>
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
                <label className="sc-section-label">{t('salary_cycle.fixed_expenses')}</label>
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
