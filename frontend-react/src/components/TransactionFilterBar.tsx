import React, { memo, useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, SlidersHorizontal, X, RotateCcw } from 'lucide-react';
import { categoryLabel, type CategoryLike } from '../utils/categoryLabel';
import {
  activeFilterCount,
  type DateMode,
  type TransactionFilters,
} from '../utils/filterTransactions';
import './TransactionFilterBar.css';

interface FilterCategory extends CategoryLike {
  id: number;
}

interface Props {
  filters: TransactionFilters;
  onChange: (next: TransactionFilters) => void;
  onReset: () => void;
  categories: FilterCategory[];
  /** Number of transactions currently matching — hidden when no filter is on. */
  resultCount: number;
  isFiltering: boolean;
}

/**
 * Search / category / date filter bar for the transaction history.
 *
 * Layout: the search field and (on narrow screens) a "Filters" disclosure sit
 * on the first row and are always reachable. The category and date controls
 * live in a panel that is inline from 900px up and collapsible below it, so
 * three controls never have to share a 344px-wide row.
 *
 * Purely controlled — all state lives in the page so the filtered list and the
 * bar can never disagree.
 */
const TransactionFilterBar: React.FC<Props> = ({
  filters,
  onChange,
  onReset,
  categories,
  resultCount,
  isFiltering,
}) => {
  const { t } = useTranslation();
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();

  const activeCount = activeFilterCount(filters);

  // Each handler patches one field so the others survive untouched — this is
  // what makes the three filters combine instead of replacing one another.
  const patch = useCallback(
    (part: Partial<TransactionFilters>) => onChange({ ...filters, ...part }),
    [filters, onChange],
  );

  const setMode = useCallback(
    (dateMode: DateMode) => {
      // Leaving range mode drops the end date so a stale "to" can't keep
      // narrowing the list invisibly once the control is gone.
      patch(dateMode === 'day' ? { dateMode, dateTo: '' } : { dateMode });
    },
    [patch],
  );

  return (
    <div className="tx-filters">
      <div className="tx-filters-top">
        <div className="tx-search">
          <Search size={16} className="tx-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="tx-search-input"
            value={filters.query}
            onChange={e => patch({ query: e.target.value })}
            placeholder={t('transactions.filter_search_ph')}
            aria-label={t('transactions.filter_search_aria')}
          />
          {filters.query !== '' && (
            <button
              type="button"
              className="tx-search-clear"
              onClick={() => patch({ query: '' })}
              aria-label={t('transactions.filter_clear_search')}
              title={t('transactions.filter_clear_search')}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Disclosure for the remaining controls — CSS hides it from 900px up,
            where the panel is always inline. */}
        <button
          type="button"
          className={`tx-filters-toggle${panelOpen ? ' tx-filters-toggle--open' : ''}`}
          onClick={() => setPanelOpen(o => !o)}
          aria-expanded={panelOpen}
          aria-controls={panelId}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>{t('transactions.filter_toggle')}</span>
          {activeCount > 0 && <span className="tx-filters-badge">{activeCount}</span>}
        </button>
      </div>

      <div
        id={panelId}
        className={`tx-filters-panel${panelOpen ? ' tx-filters-panel--open' : ''}`}
      >
        <div className="tx-filter-field">
          <label className="tx-filter-label" htmlFor={`${panelId}-cat`}>
            {t('transactions.col_category')}
          </label>
          <select
            id={`${panelId}-cat`}
            className="tx-filter-control"
            value={filters.categoryId}
            onChange={e => patch({ categoryId: e.target.value })}
            aria-label={t('transactions.filter_category_aria')}
          >
            <option value="">{t('transactions.filter_all_categories')}</option>
            {categories.map(c => (
              <option key={c.id} value={String(c.id)}>
                {categoryLabel(c, t)}
              </option>
            ))}
          </select>
        </div>

        <div className="tx-filter-field tx-filter-field--date">
          <div className="tx-filter-label-row">
            <span className="tx-filter-label">{t('transactions.col_date')}</span>
            <div
              className="tx-date-mode"
              role="group"
              aria-label={t('transactions.filter_date_mode_aria')}
            >
              <button
                type="button"
                className={`tx-date-mode-btn${filters.dateMode === 'day' ? ' tx-date-mode-btn--active' : ''}`}
                onClick={() => setMode('day')}
                aria-pressed={filters.dateMode === 'day'}
              >
                {t('transactions.filter_date_mode_day')}
              </button>
              <button
                type="button"
                className={`tx-date-mode-btn${filters.dateMode === 'range' ? ' tx-date-mode-btn--active' : ''}`}
                onClick={() => setMode('range')}
                aria-pressed={filters.dateMode === 'range'}
              >
                {t('transactions.filter_date_mode_range')}
              </button>
            </div>
          </div>

          {filters.dateMode === 'day' ? (
            <input
              type="date"
              className="tx-filter-control"
              value={filters.dateFrom}
              onChange={e => patch({ dateFrom: e.target.value })}
              aria-label={t('transactions.filter_date_day_aria')}
            />
          ) : (
            <div className="tx-date-range">
              <input
                type="date"
                className="tx-filter-control"
                value={filters.dateFrom}
                // An end date earlier than the start would silently match
                // nothing, so the pickers constrain each other.
                max={filters.dateTo || undefined}
                onChange={e => patch({ dateFrom: e.target.value })}
                aria-label={t('transactions.filter_date_from_aria')}
                title={t('transactions.filter_date_from')}
              />
              <span className="tx-date-range-sep" aria-hidden="true">–</span>
              <input
                type="date"
                className="tx-filter-control"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={e => patch({ dateTo: e.target.value })}
                aria-label={t('transactions.filter_date_to_aria')}
                title={t('transactions.filter_date_to')}
              />
            </div>
          )}
        </div>

        <div className="tx-filter-field tx-filter-field--reset">
          <button
            type="button"
            className="tx-filter-reset"
            onClick={onReset}
            disabled={!isFiltering}
            aria-label={t('transactions.filter_reset_aria')}
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>{t('transactions.filter_reset')}</span>
          </button>
        </div>
      </div>

      {/* Announced politely so screen-reader users hear the count change as
          they type, without the update stealing focus from the input. */}
      {isFiltering && (
        <div className="tx-filters-summary" role="status" aria-live="polite">
          {t('transactions.filter_results', { count: resultCount })}
        </div>
      )}
    </div>
  );
};

export default memo(TransactionFilterBar);
