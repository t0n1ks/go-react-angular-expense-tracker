import React, { useState } from 'react';
import { PiggyBank } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { savingsMoveError } from '../utils/savingsMoveError';
import './MoveToSavings.css';

// "Перевести в сбережения" — moves a current-cycle row into savings
// (POST /transactions/:id/savings), the reverse of ReturnToBudget:
//   - an expense is re-filed as a deposit (it stops counting as spent);
//   - a "Переменный бюджет" row (money returned from savings) becomes a
//     deposit again, merged into the deposit it was split from.
// Same amount, exact; the server applies the deposit guard. One component for
// the edit form and the detail view.

interface Props {
  txId: number;
  amount: number;
  kind: 'expense' | 'budgetRow';
  onDone: () => void;
}

const MoveToSavings: React.FC<Props> = ({ txId, amount, kind, onDone }) => {
  const { t } = useTranslation();
  const { axiosInstance } = useAuth();
  const { formatAmount, refreshCycle } = useSettings();
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState('');

  const move = async () => {
    setMoving(true);
    setError('');
    try {
      await axiosInstance.post(`/transactions/${txId}/savings`);
      await refreshCycle();
      onDone();
    } catch (err) {
      setError(savingsMoveError(err, t, formatAmount) ?? t('transactions.move_to_savings_error'));
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="mts">
      <button
        type="button"
        className="mts-btn"
        onClick={move}
        disabled={moving}
        aria-label={t('transactions.move_to_savings_aria', { amount: formatAmount(amount) })}
      >
        <PiggyBank size={16} aria-hidden="true" />
        {t('transactions.move_to_savings_btn')}
      </button>
      <p className="mts-hint">
        {t(kind === 'budgetRow' ? 'transactions.move_back_to_savings_hint' : 'transactions.move_to_savings_hint')}
      </p>
      {error && <p className="mts-error" role="alert">{error}</p>}
    </div>
  );
};

export default MoveToSavings;
