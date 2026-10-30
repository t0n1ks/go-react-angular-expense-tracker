import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Wallet, TrendingDown, TrendingUp, PiggyBank, X, type LucideIcon } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { SummaryCard, SummaryModals } from './SummaryCards';
import { SUMMARY_KINDS, type SummaryKind, type SummaryModel } from './useSummaryModel';
import './SummaryTiles.css';

// Phone / tablet: the four summary cards as a 2×2 grid of tiles. Each tile
// shows the card's title and headline figure over a faint watermark of its
// icon; tapping it opens the very same card (SummaryCard) in a sheet, so
// every button and modal works exactly as on Home.

interface TileFace {
  title: string;
  value: string;
  tone: 'neutral' | 'positive' | 'negative';
  note: string;
  icon: LucideIcon;
}

function useTileFace(kind: SummaryKind, m: SummaryModel): TileFace {
  const { t } = useTranslation();
  const { formatAmount } = useSettings();
  switch (kind) {
    case 'allowance':
      return { title: t('dashboard.variable_allowance'), value: formatAmount(m.variableAllowance), tone: 'neutral', note: t('dashboard.since_payday'), icon: Wallet };
    case 'savings':
      return {
        title: t('dashboard.saved_money'),
        value: `${m.savedMoneyBalance < 0 ? '-' : ''}${formatAmount(m.savedMoneyBalance)}`,
        tone: m.savedMoneyBalance < 0 ? 'negative' : 'positive',
        note: t('dashboard.savings_remaining_hint'),
        icon: PiggyBank,
      };
    case 'income':
      return { title: t('dashboard.income'), value: `+${formatAmount(m.cycleIncome)}`, tone: 'positive', note: t('salary_cycle.income_this_cycle'), icon: TrendingUp };
    case 'expenses':
      return { title: t('dashboard.expenses'), value: `-${formatAmount(m.cycleExpenses)}`, tone: 'negative', note: t('salary_cycle.expenses_this_cycle'), icon: TrendingDown };
  }
}

const Tile: React.FC<{ kind: SummaryKind; model: SummaryModel; onOpen: (kind: SummaryKind, el: HTMLElement) => void }> = ({ kind, model, onOpen }) => {
  const face = useTileFace(kind, model);
  const Icon = face.icon;
  return (
    <button
      type="button"
      className={`summary-tile summary-tile--${kind}`}
      onClick={e => onOpen(kind, e.currentTarget)}
      aria-label={`${face.title}: ${face.value}`}
      aria-haspopup="dialog"
    >
      <Icon className="summary-tile-mark" aria-hidden="true" strokeWidth={1.6} />
      <span className="summary-tile-title">{face.title}</span>
      <span className={`summary-tile-value summary-tile-value--${face.tone}`}>{face.value}</span>
      <span className="summary-tile-note">{face.note}</span>
    </button>
  );
};

const SummaryTiles: React.FC<{ model: SummaryModel }> = ({ model }) => {
  const { t } = useTranslation();
  const [openKind, setOpenKind] = useState<SummaryKind | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const open = (kind: SummaryKind, el: HTMLElement) => { returnFocus.current = el; setOpenKind(kind); };
  const close = () => { setOpenKind(null); returnFocus.current?.focus(); };

  // While the sheet is open: Escape closes it (unless a card's own modal is
  // on top — that modal handles its own close), focus starts on ✕.
  useEffect(() => {
    if (!openKind) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !model.open) { setOpenKind(null); returnFocus.current?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openKind, model.open]);

  return (
    <>
      <section className="summary-tiles">
        {SUMMARY_KINDS.map(kind => <Tile key={kind} kind={kind} model={model} onOpen={open} />)}
      </section>

      {openKind && createPortal(
        <div className="summary-sheet-overlay" onClick={close}>
          <div
            className="summary-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheetTitle(openKind, t)}
            onClick={e => e.stopPropagation()}
          >
            <button ref={closeRef} type="button" className="summary-sheet-close" onClick={close} aria-label={t('companion.close')}>
              <X size={18} aria-hidden="true" />
            </button>
            <SummaryCard kind={openKind} model={model} />
          </div>
        </div>,
        document.body,
      )}

      {/* The cards' own modals stack above the sheet. */}
      {createPortal(<SummaryModals model={model} />, document.body)}
    </>
  );
};

function sheetTitle(kind: SummaryKind, t: (k: string) => string): string {
  return {
    allowance: t('dashboard.variable_allowance'),
    savings: t('dashboard.saved_money'),
    income: t('dashboard.income'),
    expenses: t('dashboard.expenses'),
  }[kind];
}

export default SummaryTiles;
