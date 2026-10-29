import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { savingsMoveError } from '../utils/savingsMoveError';
import { inCurrentCycle, type TimedTransaction } from '../utils/categoryWindow';
import './ReturnToBudget.css';

// "Вернуть в бюджет" — moves money from a savings deposit back into the
// current cycle's spendable budget (POST /transactions/:id/budget). One
// component for every place a deposit is opened: its edit form (desktop row
// and mobile card) and its detail view. The server does the move — exact and
// net-zero — guarded against returning more than the deposit or savings hold.
//
// Offered on EVERY savings deposit (the automatic allocation, a carry-over
// move, manual deposits, re-filed expenses). A current-cycle deposit changes
// in place (whole → it becomes a "Переменный бюджет" row; part → it is split);
// a past cycle's deposit can't, so the return is a new transfer dated today —
// the hint says so before the user presses. Without a current cycle there is
// no budget to return into: the control stays visible but disabled, and says
// why — it is never silently hidden.

interface Props {
  depositId: number;
  depositAmount: number;
  /** The deposit's timing (date / created_at / effective_at). */
  depositTime: TimedTransaction;
  /** Unique per rendered instance (label ↔ input). */
  inputId: string;
  /** Called after a successful move (parent refreshes / closes). */
  onDone: () => void;
}

const ReturnToBudget: React.FC<Props> = ({ depositId, depositAmount, depositTime, inputId, onDone }) => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();
  const { formatAmount, hasActiveCycle, cycleWindow, refreshCycle } = useSettings();
  const fromPastCycle = hasActiveCycle && !inCurrentCycle(depositTime, cycleWindow);
  // Defaults to the whole deposit, editable down to the cent.
  const [amount, setAmount] = useState(String(depositAmount));
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setAmount(String(depositAmount));
    setError('');
  }, [depositId, depositAmount]);

  const value = parseFloat(amount);
  const valid = Number.isFinite(value) && value > 0;

  const returnToBudget = async () => {
    setMoving(true);
    setError('');
    try {
      await axiosInstance.post(`/transactions/${depositId}/budget`, { amount: value });
      await refreshCycle();
      onDone();
    } catch (err) {
      setError(savingsMoveError(err, t, formatAmount, 'toBudget') ?? t('transactions.return_to_budget_error'));
    } finally {
      setMoving(false);
    }
  };

  const hintId = `${inputId}-hint`;
  return (
    <div className="rtb">
      <label className="rtb-label" htmlFor={inputId}>
        {t('transactions.return_to_budget_amount')}
      </label>
      <div className="rtb-row">
        <input
          id={inputId}
          className="rtb-input"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={!hasActiveCycle}
          aria-describedby={hintId}
        />
        <button
          type="button"
          className="rtb-btn"
          onClick={returnToBudget}
          disabled={!hasActiveCycle || moving || !valid}
          aria-label={t('transactions.return_to_budget_aria', { amount: formatAmount(valid ? value : 0) })}
        >
          <Wallet size={16} aria-hidden="true" />
          {t('transactions.return_to_budget_btn')}
        </button>
      </div>
      <p id={hintId} className="rtb-hint">
        {!hasActiveCycle
          ? t('dashboard.savings_return_no_cycle')
          : fromPastCycle
            ? t('transactions.return_to_budget_closed_hint')
            : t('transactions.return_to_budget_hint')}
      </p>
      {error && <p className="rtb-error" role="alert">{error}</p>}
    </div>
  );
};

export default ReturnToBudget;
