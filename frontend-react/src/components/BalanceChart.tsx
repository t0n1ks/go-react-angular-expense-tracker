import React, { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { cashFlowSeries, withinPeriod, type MoneyPoint } from '../utils/balanceTimeline';
import {
  seriesFor, viewLabelKey, viewValue, loadBalanceView, saveBalanceView, balanceTabId, type BalanceView,
} from '../utils/balanceView';
import BalanceViewTabs from './BalanceViewTabs';

// "Динамика баланса" — one balance line at a time, switched with a segmented
// control: Общий (real money on hand), Бюджет (spendable remainder), Копилка
// (savings pool). All three come straight from the server's real-money
// timeline; "Общий" is the server's per-day sum of the other two — never an
// all-time income − expenses sum. The headline shows today's figure for the
// active view, which is the same number the dashboard shows.
//
// Users who never had a cycle have no cycle budget or savings yet: they keep
// the single cumulative cash-flow line, without the switcher.

const TIMELINE_PERIODS = [
  { days: 30, labelKey: 'statistics.period_30' },
  { days: 90, labelKey: 'statistics.period_90' },
  { days: 180, labelKey: 'statistics.period_180' },
  { days: 0, labelKey: 'statistics.period_all' },
] as const;

// Line colours: budget = the budget bar's blue, savings = the savings card's
// green, total = the app's indigo accent (lighter in the dark theme).
const lineColor = (view: BalanceView | null, isDark: boolean): string =>
  view === 'budget' ? '#38bdf8'
  : view === 'savings' || view === null ? '#10b981'
  : isDark ? '#818cf8' : '#6366f1';

const PANEL_ID = 'balance-chart-panel';

interface CashFlowTx {
  type: string;
  amount: number;
  date: string;
  created_at?: string;
}

interface Props {
  /** Server real-money series; empty for users who never had a cycle. */
  moneySeries: MoneyPoint[];
  /** All transactions — only for the no-cycle cash-flow line. */
  transactions: CashFlowTx[];
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const BalanceChart: React.FC<Props> = ({ moneySeries, transactions }) => {
  const { t, i18n } = useTranslation();
  const { formatAmount, currencySymbol } = useSettings();
  const { isDark } = useTheme();
  const [period, setPeriod] = useState<number>(90); // days; 0 = all time
  const [view, setView] = useState<BalanceView>(loadBalanceView);
  const reduceMotion = useMemo(prefersReducedMotion, []);

  const hasViews = moneySeries.length > 0;
  const activeView = hasViews ? view : null;
  const color = lineColor(activeView, isDark);

  const data = useMemo(() => {
    const dayLabel = (date: string) => {
      const [y, m, d] = date.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' });
    };
    const points = hasViews
      ? seriesFor(moneySeries, view)
      : cashFlowSeries(transactions).map((p) => ({ date: p.date, value: p.balance }));
    return withinPeriod(points, period).map((p) => ({ date: dayLabel(p.date), value: p.value }));
  }, [hasViews, moneySeries, transactions, view, period, i18n.language]);

  const today = hasViews ? viewValue(moneySeries[moneySeries.length - 1], view) : null;
  const dipsBelowZero = data.some((p) => p.value < 0);
  const viewLabel = activeView ? t(viewLabelKey(activeView)) : t('statistics.balance_timeline');

  const changeView = (v: BalanceView) => {
    setView(v);
    saveBalanceView(v);
  };

  // Compact, signed axis labels (e.g. €1.2k) that stay short on narrow phones.
  const compact = (v: number): string => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1000) return `${sign}${currencySymbol}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    return `${sign}${currencySymbol}${Math.round(abs)}`;
  };
  const gridColor = isDark ? '#1e2a3a' : '#eef2f7';
  const axisColor = isDark ? '#2a3852' : '#e2e8f0';
  const gradientId = `balance-fill-${activeView ?? 'cashflow'}`;

  return (
    <div className="stat-chart-card">
      <div className="stat-chart-head">
        <h2>
          <TrendingUp size={22} color={color} aria-hidden="true" /> {t('statistics.balance_timeline')}
        </h2>
        <div className="stat-period-filter" role="group" aria-label={t('statistics.balance_period_label')}>
          {TIMELINE_PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={period === p.days}
              className={`stat-period-btn${period === p.days ? ' stat-period-btn--active' : ''}`}
              onClick={() => setPeriod(p.days)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {hasViews && <BalanceViewTabs value={view} onChange={changeView} panelId={PANEL_ID} />}

      <div
        id={PANEL_ID}
        role={hasViews ? 'tabpanel' : undefined}
        aria-labelledby={activeView ? balanceTabId(activeView) : undefined}
      >
        {today !== null && (
          <div className="balance-now" aria-live="polite">
            <span className="balance-now-label">{t('statistics.balance_now', { view: viewLabel })}</span>
            <span className="balance-now-value" style={{ color: today < 0 ? 'var(--color-expense-text)' : color }}>
              {formatAmount(today)}
            </span>
          </div>
        )}

        {data.length > 0 ? (
          <div
            className="balance-chart-plot"
            role="img"
            aria-label={
              today !== null
                ? t('statistics.balance_view_aria', { view: viewLabel, amount: formatAmount(today) })
                : t('statistics.balance_timeline')
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.24} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <YAxis
                  width={52}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={compact}
                  tickCount={5}
                />
                <XAxis
                  dataKey="date"
                  axisLine={{ stroke: axisColor }}
                  tickLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  dy={10}
                  padding={{ left: 12, right: 12 }}
                  minTickGap={44}
                />
                {dipsBelowZero && <ReferenceLine y={0} stroke={axisColor} strokeDasharray="4 4" />}
                <Tooltip
                  cursor={{ stroke: color, strokeOpacity: 0.35 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const v = typeof payload[0].value === 'number' ? payload[0].value : 0;
                    return (
                      <div className="balance-tooltip">
                        <span className="balance-tooltip-date">{String(label)}</span>
                        <span className="balance-tooltip-label">{viewLabel}</span>
                        <span className="balance-tooltip-amount" style={{ color: v < 0 ? '#f87171' : color }}>
                          {formatAmount(v)}
                        </span>
                      </div>
                    );
                  }}
                />
                {/* A step line: a balance changes at moments — payday is a
                    jump, not a slope. Keyed by view so switching animates. */}
                <Area
                  key={activeView ?? 'cashflow'}
                  type={hasViews ? 'stepAfter' : 'monotone'}
                  dataKey="value"
                  name={viewLabel}
                  stroke={color}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill={`url(#${gradientId})`}
                  activeDot={{ r: 4, strokeWidth: 0, fill: color }}
                  isAnimationActive={!reduceMotion}
                  animationDuration={450}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="no-data-msg">
            <p>{t('statistics.no_data')}</p>
            <span>{t('statistics.no_data_sub')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default BalanceChart;
