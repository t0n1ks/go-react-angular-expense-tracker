import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, PiggyBank, Plus } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import IncomeHistoryModal from '../IncomeHistoryModal';
import ExpensesHistoryModal from '../ExpensesHistoryModal';
import SavingsHistoryModal from '../SavingsHistoryModal';
import AddIncomeModal from '../AddIncomeModal';
import type { SummaryKind, SummaryModel } from './useSummaryModel';
// The cards' and modals' styles live with the dashboard; import them here so
// the cards look the same wherever they are shown.
import '../../pages/Dashboard.css';

/** One of the four summary cards — the same card on Home and in a Statistics tile's sheet. */
export const SummaryCard: React.FC<{ kind: SummaryKind; model: SummaryModel }> = ({ kind, model: m }) => {
  const { t } = useTranslation();
  const { formatAmount } = useSettings();

  switch (kind) {
    // Card 1: Variable Allowance (formerly "Current Balance")
    case 'allowance':
      return (
        <div className="stat-card">
          <div className="stat-icon wallet"><Wallet size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.variable_allowance')}</p>
            <p className="value">{formatAmount(m.variableAllowance)}</p>
            {m.carryOver > 0 && (
              <p className="income-breakdown">
                {t('dashboard.carry_over_included', { amount: formatAmount(m.carryOver) })}
                {m.carryMoved > 0 && (
                  <span> · {t('dashboard.carry_over_moved', { amount: formatAmount(m.carryMoved) })}</span>
                )}
              </p>
            )}
            {m.carryMovable >= 1 && (
              <button
                type="button"
                className="carry-over-move-btn"
                onClick={m.moveCarryOverToSavings}
                disabled={m.movingCarry}
                aria-label={t('dashboard.carry_over_move_aria', { amount: formatAmount(m.carryMovable) })}
              >
                <PiggyBank size={13} aria-hidden="true" />
                {t('dashboard.carry_over_move_btn', { amount: formatAmount(m.carryMovable) })}
              </button>
            )}
            <p className="stat-sublabel">{t('dashboard.since_payday')}</p>
          </div>
        </div>
      );

    // Card 2: Saved money (click → SavingsHistoryModal)
    case 'savings':
      return (
        <div
          className={`stat-card${m.hasCycle ? ' stat-card--clickable' : ''}`}
          onClick={m.hasCycle ? () => { m.setOpen('savings'); m.refreshCycle(); } : undefined}
          role={m.hasCycle ? 'button' : undefined}
          tabIndex={m.hasCycle ? 0 : undefined}
          onKeyDown={m.hasCycle ? (e => e.key === 'Enter' && m.setOpen('savings')) : undefined}
          title={t('dashboard.saved_money')}
        >
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
            <PiggyBank size={24}/>
          </div>
          <div className="stat-content">
            <p className="label">{t('dashboard.saved_money')}</p>
            {/* Headline = LIVE remaining pool balance (allocated − withdrawn +
                additions), the same figure Statistics and the savings history
                show. The planned allocation is context, not the balance. */}
            <p className="value" style={{ color: m.savedMoneyBalance < 0 ? '#ef4444' : '#10b981' }}>
              {m.savedMoneyBalance < 0 ? '-' : ''}{formatAmount(m.savedMoneyBalance)}
            </p>
            {m.dynamicSavings > 0 && (
              <p className="income-breakdown">
                {t('dashboard.savings_planned_this_cycle')}: {formatAmount(m.dynamicSavings)}
              </p>
            )}
            <p className="stat-sublabel">{t('dashboard.savings_remaining_hint')}</p>
          </div>
        </div>
      );

    // Card 3: Income — click → IncomeHistoryModal; + Add Income button
    case 'income':
      return (
        <div
          className="stat-card stat-card--clickable"
          onClick={() => m.setOpen('income')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && m.setOpen('income')}
          title={t('dashboard.income')}
          style={{ position: 'relative' }}
        >
          <div className="stat-icon income"><TrendingUp size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.income')}</p>
            <p className="value-plus">+{formatAmount(m.cycleIncome)}</p>
            {m.currentCycle && m.cycleIncome > 0 && (
              <p className="income-breakdown">
                {t('dashboard.income_salary')}: {formatAmount(m.currentCycle.base_salary)}
                {m.currentCycle.bonuses > 0 && (
                  <span> · {t('dashboard.income_bonuses')}: {formatAmount(m.currentCycle.bonuses)}</span>
                )}
                {m.cycleIncome - (m.currentCycle.base_salary + m.currentCycle.bonuses) > 0.01 && (
                  <span> · {t('dashboard.income_other')}: {formatAmount(m.cycleIncome - m.currentCycle.base_salary - m.currentCycle.bonuses)}</span>
                )}
              </p>
            )}
            {m.salaryRef > 0 && !m.currentCycle && (
              <>
                <div className={`progress-track${m.incomeOver ? ' progress-track--glow' : ''}`}>
                  <div className="progress-fill" style={{ width: `${m.incomePercent}%`, background: m.incomeOver ? '#10b981' : '#38bdf8' }} />
                </div>
                <p className="progress-label">{t('dashboard.income_of_expected', { expected: formatAmount(m.salaryRef) })}</p>
              </>
            )}
            <p className="stat-sublabel">{t('salary_cycle.income_this_cycle')}</p>
          </div>
          {/* Add Income button — only when cycle is active */}
          {m.hasCycle && (
            <button
              className="stat-card-add-btn"
              onClick={e => { e.stopPropagation(); m.setOpen('addIncome'); }}
              title={t('dashboard.add_income_title')}
              type="button"
              aria-label={t('dashboard.add_income_title')}
            >
              <Plus size={13} />
            </button>
          )}
        </div>
      );

    // Card 4: Expenses — fixed + variable; click → history modal
    case 'expenses':
      return (
        <div
          className="stat-card stat-card--clickable"
          onClick={() => m.setOpen('expenses')}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && m.setOpen('expenses')}
          title={t('dashboard.expenses')}
        >
          <div className="stat-icon expense"><TrendingDown size={24}/></div>
          <div className="stat-content">
            <p className="label">{t('dashboard.expenses')}</p>
            <p className="value-minus">-{formatAmount(m.cycleExpenses)}</p>
            {m.currentCycle && m.cycleFixedExpenses > 0 && (
              <p className="income-breakdown">
                {t('dashboard.expenses_fixed')}: {formatAmount(m.cycleFixedExpenses)}
                {m.cycleVariableExpenses > 0 && (
                  <span> · {t('dashboard.expenses_variable')}: {formatAmount(m.cycleVariableExpenses)}</span>
                )}
              </p>
            )}
            <p className="stat-sublabel">{t('salary_cycle.expenses_this_cycle')}</p>
          </div>
        </div>
      );
  }
};

/** The cards' history / add-income modals (one open at a time). */
export const SummaryModals: React.FC<{ model: SummaryModel }> = ({ model: m }) => {
  const { formatAmount } = useSettings();
  const close = () => m.setOpen(null);
  switch (m.open) {
    case 'income':
      return (
        <IncomeHistoryModal
          transactions={m.transactions}
          currentCycle={m.currentCycle}
          formatAmount={formatAmount}
          onClose={close}
          onCycleDeleted={m.handleCycleDeleted}
        />
      );
    case 'expenses':
      return (
        <ExpensesHistoryModal
          transactions={m.transactions}
          currentCycle={m.currentCycle}
          fixedExpCatID={m.fixedExpCatID}
          formatAmount={formatAmount}
          onClose={close}
          onCycleDeleted={m.handleCycleDeleted}
        />
      );
    case 'savings':
      return (
        <SavingsHistoryModal
          currentCycle={m.currentCycle}
          formatAmount={formatAmount}
          savedMoneyBalance={m.savedMoneyBalance}
          onClose={close}
          onSaved={m.handleSavingsSaved}
        />
      );
    case 'addIncome':
      return <AddIncomeModal onClose={close} onSuccess={m.handleIncomeAdded} />;
    default:
      return null;
  }
};
