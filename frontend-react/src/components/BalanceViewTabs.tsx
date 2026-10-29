import React, { useRef } from 'react';
import { Landmark, Wallet, PiggyBank } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BALANCE_VIEWS, balanceTabId, viewLabelKey, type BalanceView } from '../utils/balanceView';
import './BalanceChart.css';

// Segmented control for the balance chart: Общий / Бюджет / Копилка.
// A WAI-ARIA tablist: one tab stop (roving tabindex), ←/→ move and select,
// Home/End jump to the ends; each tab controls the chart panel. Styled as a
// .balance-bar like the range bar above it, so the two read as one pair.

const ICONS: Record<BalanceView, typeof Wallet> = { total: Landmark, budget: Wallet, savings: PiggyBank };

interface Props {
  value: BalanceView;
  onChange: (view: BalanceView) => void;
  /** id of the chart panel the tabs control. */
  panelId: string;
}

const BalanceViewTabs: React.FC<Props> = ({ value, onChange, panelId }) => {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<BalanceView, HTMLButtonElement | null>>>({});

  const select = (view: BalanceView) => {
    onChange(view);
    refs.current[view]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = BALANCE_VIEWS.indexOf(value);
    const last = BALANCE_VIEWS.length - 1;
    const next =
      e.key === 'ArrowRight' ? BALANCE_VIEWS[i === last ? 0 : i + 1]
      : e.key === 'ArrowLeft' ? BALANCE_VIEWS[i === 0 ? last : i - 1]
      : e.key === 'Home' ? BALANCE_VIEWS[0]
      : e.key === 'End' ? BALANCE_VIEWS[last]
      : null;
    if (next) {
      e.preventDefault();
      select(next);
    }
  };

  return (
    <div className="balance-bar balance-bar--3" role="tablist" aria-label={t('statistics.balance_views_label')} onKeyDown={onKeyDown}>
      {BALANCE_VIEWS.map((view) => {
        const Icon = ICONS[view];
        const active = view === value;
        return (
          <button
            key={view}
            ref={(el) => { refs.current[view] = el; }}
            id={balanceTabId(view)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            className={`balance-seg${active ? ' balance-seg--active' : ''}`}
            onClick={() => onChange(view)}
          >
            <Icon size={15} aria-hidden="true" className="balance-seg-icon" />
            <span className="balance-seg-label">{t(viewLabelKey(view))}</span>
          </button>
        );
      })}
    </div>
  );
};

export default BalanceViewTabs;
