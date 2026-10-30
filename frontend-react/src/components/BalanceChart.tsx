import React, { useMemo, useState, type CSSProperties } from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { cashFlowSeries, withinPeriod, type MoneyPoint } from '../utils/balanceTimeline';
import { BALANCE_CURVE } from '../utils/balanceView';
import {
  seriesFor, viewLabelKey, viewValue, loadBalanceView, saveBalanceView, balanceTabId,
  selectedIndex, formatDay, type BalanceView,
} from '../utils/balanceView';
import BalanceViewTabs from './BalanceViewTabs';
import './BalanceChart.css';

// "Динамика баланса" — one balance line at a time, switched with a segmented
// control: Общий (real money on hand), Бюджет (spendable remainder), Копилка
// (savings pool). All three come straight from the server's real-money
// timeline; "Общий" is the server's per-day sum of the other two — never an
// all-time income − expenses sum.
//
// Above the plot, two fixed readouts that never cover the line: on the left a
// HUD-style panel with the SELECTED day (date + amount), on the right today's
// figure for the active view (the dashboard's number). The day is picked by
// dragging on the chart or with the slider under it — both drive the same
// selection, kept by date (see selectedIndex): it survives a tab switch, and
// falls back to the latest day when it leaves the visible range.
//
// Users who never had a cycle have no cycle budget or savings yet: they keep
// the single cumulative cash-flow line, without the view switcher.

const TIMELINE_PERIODS = [
  { days: 30, labelKey: 'statistics.period_30' },
  { days: 90, labelKey: 'statistics.period_90' },
  { days: 180, labelKey: 'statistics.period_180' },
  { days: 0, labelKey: 'statistics.period_all' },
] as const;

// Line colours: budget = the budget bar's blue, savings = the savings card's
// green, total = the app's indigo accent (lighter in the dark theme).
// The line is a gradient (start → end) per view: Total in the signature blue,
// Budget a lighter sky blue, Savings (and the no-cycle cash flow) green.
const lineStops = (view: BalanceView | null, isDark: boolean): [string, string] =>
  view === 'budget' ? (isDark ? ['#7dd3fc', '#38bdf8'] : ['#38bdf8', '#0284c7'])
  : view === 'savings' || view === null ? (isDark ? ['#6ee7b7', '#34d399'] : ['#10b981', '#0f9d6b'])
  : isDark ? ['#22d3ee', '#3b82f6'] : ['#0ea5e9', '#2563eb'];

// The line's main hue (its end colour): markers, the guide, the readout frame.
const lineColor = (view: BalanceView | null, isDark: boolean): string => lineStops(view, isDark)[1];

// The same hues for TEXT and controls, darkened in the light theme so small
// text keeps ≥ 4.5:1 contrast on white.
const accentColor = (view: BalanceView | null, isDark: boolean): string =>
  isDark ? lineColor(view, true)
  : view === 'budget' ? '#0369a1'
  : view === 'savings' || view === null ? '#047857'
  : '#1d4ed8';

// Plot geometry, shared by the chart and the slider so the slider's ends sit
// exactly under the first and last day: Y axis + X padding on the left,
// chart margin + X padding on the right.
const Y_AXIS_W = 52;
const X_PAD = 12;
const MARGIN_R = 14;
const PLOT_LEFT = Y_AXIS_W + X_PAD;
const PLOT_RIGHT = MARGIN_R + X_PAD;
// The slider thumb's centre (not its edge) marks the day: inset the track by
// the thumb's radius (BalanceChart.css: 22px WebKit thumb).
const THUMB_R = 11;

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
  const [selectedDate, setSelectedDate] = useState<string | null>(null); // null → latest day
  const reduceMotion = useMemo(prefersReducedMotion, []);

  const hasViews = moneySeries.length > 0;
  const activeView = hasViews ? view : null;
  const color = lineColor(activeView, isDark);
  const [lineA, lineB] = lineStops(activeView, isDark);
  const accent = accentColor(activeView, isDark);
  const locale = i18n.language;

  // { date: YYYY-MM-DD, value } per visible day. The x axis is keyed by the
  // full date (labels like "29 окт." repeat across years on "Все").
  const data = useMemo(() => {
    const points = hasViews
      ? seriesFor(moneySeries, view)
      : cashFlowSeries(transactions).map((p) => ({ date: p.date, value: p.balance }));
    return withinPeriod(points, period);
  }, [hasViews, moneySeries, transactions, view, period]);

  const dates = useMemo(() => data.map((p) => p.date), [data]);
  const sel = selectedIndex(dates, selectedDate);
  const selected = sel >= 0 ? data[sel] : null;
  const today = hasViews ? viewValue(moneySeries[moneySeries.length - 1], view) : null;
  const dipsBelowZero = data.some((p) => p.value < 0);
  const viewLabel = activeView ? t(viewLabelKey(activeView)) : t('statistics.balance_timeline');

  const changeView = (v: BalanceView) => {
    setView(v);
    saveBalanceView(v);
  };
  const pickIndex = (i: number | string | null | undefined) => {
    const n = typeof i === 'string' ? Number(i) : i;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < data.length) setSelectedDate(data[n].date);
  };

  const shortDay = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { day: '2-digit', month: 'short' });
  };
  // Compact, signed axis labels (e.g. €1.2k) that stay short on narrow phones.
  const compact = (v: number): string => {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1000) return `${sign}${currencySymbol}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
    return `${sign}${currencySymbol}${Math.round(abs)}`;
  };
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(11, 54, 112, 0.07)';
  const axisColor = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(11, 54, 112, 0.12)';
  const tickColor = isDark ? '#8a97ad' : '#5d6b82';
  const gradientId = `balance-fill-${activeView ?? 'cashflow'}`;
  const strokeId = `${gradientId}-stroke`;
  const glowId = `${gradientId}-glow`;
  const last = data.length > 0 ? data[data.length - 1] : null;
  const negative = 'var(--color-expense-text)';

  const cardStyle = { '--balance-accent': accent, '--balance-line': color, '--balance-glow': `url(#${glowId})` } as CSSProperties;
  const selectedText = selected ? `${formatDay(selected.date, locale)}: ${formatAmount(selected.value)}` : '';

  return (
    <div className="stat-chart-card balance-card" style={cardStyle}>
      <h2 className="balance-title">
        <TrendingUp size={22} color={color} aria-hidden="true" /> {t('statistics.balance_timeline')}
      </h2>

      {/* Two aligned bars: same width, padding and radius. */}
      <div className="balance-bars">
        <div className="balance-bar balance-bar--4" role="group" aria-label={t('statistics.balance_period_label')}>
          {TIMELINE_PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              aria-pressed={period === p.days}
              className={`balance-seg${period === p.days ? ' balance-seg--active' : ''}`}
              onClick={() => setPeriod(p.days)}
            >
              <span className="balance-seg-label">{t(p.labelKey)}</span>
            </button>
          ))}
        </div>
        {hasViews && <BalanceViewTabs value={view} onChange={changeView} panelId={PANEL_ID} />}
      </div>

      <div
        id={PANEL_ID}
        role={hasViews ? 'tabpanel' : undefined}
        aria-labelledby={activeView ? balanceTabId(activeView) : undefined}
      >
        {selected && (
          <div className="balance-readouts">
            {/* Left: the selected day — a fixed HUD panel, never over the line. */}
            <div className="balance-hud">
              <span className="balance-hud-date">{formatDay(selected.date, locale)}</span>
              <span className="balance-hud-value" style={selected.value < 0 ? { color: negative } : undefined}>
                {formatAmount(selected.value)}
              </span>
            </div>
            {/* Right: today's figure for the active view (= the dashboard). */}
            {today !== null && (
              <div className="balance-now">
                <span className="balance-now-label">{t('statistics.balance_now', { view: viewLabel })}</span>
                <span className="balance-now-value" style={{ color: today < 0 ? negative : color }}>
                  {formatAmount(today)}
                </span>
              </div>
            )}
          </div>
        )}

        {data.length > 0 ? (
          <>
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
                <AreaChart
                  data={data}
                  margin={{ top: 10, right: MARGIN_R, bottom: 0, left: 0 }}
                  onMouseMove={(s) => s.isTooltipActive && pickIndex(s.activeTooltipIndex)}
                  onTouchMove={(s) => pickIndex(s.activeTooltipIndex)}
                  onClick={(s) => pickIndex(s.activeTooltipIndex)}
                >
                  <defs>
                    {/* Area: the line's hue fading to transparent. */}
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineB} stopOpacity={0.30} />
                      <stop offset="95%" stopColor={lineB} stopOpacity={0} />
                    </linearGradient>
                    {/* Line: left → right gradient in user space (a flat line
                        has a zero-height box, which would hide a bbox gradient). */}
                    <linearGradient id={strokeId} gradientUnits="userSpaceOnUse" x1="0%" y1="0" x2="100%" y2="0">
                      <stop offset="0%" stopColor={lineA} />
                      <stop offset="100%" stopColor={lineB} />
                    </linearGradient>
                    {/* Soft glow: a blurred copy under the crisp line. */}
                    <filter id={glowId} x="-5%" y="-40%" width="110%" height="180%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <YAxis
                    width={Y_AXIS_W}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: tickColor, fontSize: 11 }}
                    tickFormatter={compact}
                    tickCount={5}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDay}
                    axisLine={{ stroke: axisColor }}
                    tickLine={false}
                    tick={{ fill: tickColor, fontSize: 11 }}
                    dy={10}
                    padding={{ left: X_PAD, right: X_PAD }}
                    minTickGap={44}
                  />
                  {dipsBelowZero && <ReferenceLine y={0} stroke={axisColor} strokeDasharray="4 4" />}
                  {/* Drives drag/tap selection; renders nothing — the HUD shows the value. */}
                  <Tooltip content={() => null} cursor={false} isAnimationActive={false} />
                  <Area
                    key={activeView ?? 'cashflow'}
                    type={BALANCE_CURVE}
                    dataKey="value"
                    name={viewLabel}
                    stroke={`url(#${strokeId})`}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    fillOpacity={1}
                    fill={`url(#${gradientId})`}
                    activeDot={false}
                    isAnimationActive={!reduceMotion}
                    animationDuration={450}
                  />
                  {/* Today: a glowing endpoint dot. */}
                  {last && (
                    <ReferenceDot
                      x={last.date}
                      y={last.value}
                      r={4.5}
                      shape={(p: { cx?: number; cy?: number }) => (
                        <g>
                          <circle cx={p.cx} cy={p.cy} r={10} fill={lineB} opacity={0.22} />
                          <circle cx={p.cx} cy={p.cy} r={4.5} fill={lineB} stroke="#ffffff" strokeWidth={2} />
                        </g>
                      )}
                    />
                  )}
                  {selected && (
                    <>
                      <ReferenceLine x={selected.date} stroke={color} strokeOpacity={0.6} strokeDasharray="4 4" />
                      {/* The picked day: a white dot with a ring in the line's hue. */}
                      <ReferenceDot
                        x={selected.date}
                        y={selected.value}
                        r={5.5}
                        fill="#ffffff"
                        stroke={color}
                        strokeWidth={3}
                      />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* The slider spans the plot: its ends sit under the first and last day. */}
            <div className="balance-scrubber" style={{ paddingLeft: PLOT_LEFT - THUMB_R, paddingRight: PLOT_RIGHT - THUMB_R }}>
              <input
                type="range"
                className="balance-scrubber-input"
                min={0}
                max={Math.max(0, data.length - 1)}
                step={1}
                value={Math.max(0, sel)}
                onChange={(e) => pickIndex(Number(e.target.value))}
                disabled={data.length < 2}
                aria-label={t('statistics.balance_scrub_label')}
                aria-valuetext={selectedText}
              />
            </div>
          </>
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
