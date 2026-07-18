import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import { useTranslation } from "react-i18next";
import { useTheme } from "../context/ThemeContext";
import { PieChart as PieIcon, TrendingUp, PiggyBank } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import CategoryChart from "../components/CategoryChart";
import { resolveCategoryWindow, isInWindow } from "../utils/categoryWindow";
import ForecastCard from "../components/ForecastCard";
import ForecastDetailModal from "../components/ForecastDetailModal";
import "./Statistics.css";

interface Transaction {
  amount: number;
  type: "expense" | "income" | "savings_deposit" | "savings_withdrawal";
  income_type?: string;
  date: string;
  created_at?: string;
  category?: { id?: number; name: string };
}

interface AnalysisResult {
  predicted_end_of_month_balance: number | null;
  predicted_savings_balance: number | null;
  financial_health_score: number | null;
  spending_tier: string;
}

// Balance-timeline period filter options. `days: 0` means all-time.
const TIMELINE_PERIODS = [
  { days: 30, labelKey: "statistics.period_30" },
  { days: 90, labelKey: "statistics.period_90" },
  { days: 180, labelKey: "statistics.period_180" },
  { days: 0, labelKey: "statistics.period_all" },
] as const;

const Statistics: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount, paydayMode, fixedPayday, manualNextPayday, monthlySpendingGoal, expectedSalary, currentCycle, cycleStats, hasActiveCycle, liteMode } = useSettings();
  const { t, i18n } = useTranslation();
  const { isDark } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [forecastOpen, setForecastOpen] = useState(false);
  const [timelinePeriod, setTimelinePeriod] = useState<number>(90); // days; 0 = all time

  const fetchData = useCallback(async () => {
    try {
      const response = await axiosInstance.get("/transactions");
      const data = response.data.transactions || response.data;
      setTransactions(Array.isArray(data) ? data : []);
    } catch {
      // silent — loading state is already reset in finally
    } finally {
      setLoading(false);
    }
  }, [axiosInstance]);

  const fetchAnalysis = useCallback(async () => {
    try {
      const lang = i18n.language.split("-")[0];
      const { data } = await axiosInstance.post(`/ai/analyze?language=${lang}`);
      if (data && typeof data === "object") {
        setAnalysis({
          predicted_end_of_month_balance:
            typeof data.predicted_end_of_month_balance === "number"
              ? data.predicted_end_of_month_balance
              : null,
          predicted_savings_balance:
            typeof data.predicted_savings_balance === "number"
              ? data.predicted_savings_balance
              : null,
          financial_health_score:
            typeof data.financial_health_score === "number"
              ? data.financial_health_score
              : null,
          spending_tier: data.spending_tier || "pacing_good",
        });
      }
    } catch {
      // AI service may be offline — degrade gracefully
    }
  }, [axiosInstance, i18n.language]);

  useEffect(() => {
    fetchData();
    // Lite mode hides all analytics below the donut and must not request them.
    if (!liteMode) fetchAnalysis();
  }, [fetchData, fetchAnalysis, liteMode]);

  // Donut is scoped to the active salary-cycle window [cycle_start_at,
  // next_payday_at]. resolveCategoryWindow validates that window and, for
  // cycle-less or mis-dated users, falls back to the current calendar month
  // (the same default the forecaster uses) — never to all-time.
  const categoryData = useMemo(() => {
    const catWindow = resolveCategoryWindow({
      hasActiveCycle,
      cycleStartAt: currentCycle?.cycle_start_at,
      nextPaydayAt: currentCycle?.next_payday_at,
      now: new Date(),
    });

    const map: Record<string, number> = {};
    transactions
      .filter(
        (t) =>
          t.type === "expense" && isInWindow(new Date(t.created_at ?? t.date), catWindow),
      )
      .forEach((t) => {
        const name = t.category?.name || "—";
        map[name] = (map[name] || 0) + Math.abs(Number(t.amount));
      });

    return Object.keys(map)
      .map((name) => ({ name, value: map[name] }))
      .sort((a, b) => b.value - a.value);
  }, [transactions, hasActiveCycle, currentCycle]);

  // ── Balance Dynamics ──────────────────────────────────────────────────────
  // True cumulative cash flow over time: income adds, expense subtracts. Savings
  // pool transfers (savings_deposit / savings_withdrawal) are INTERNAL movements
  // between cash and the savings pool — not earning or spending — so they are
  // excluded. Including them previously injected large budget-derived amounts
  // (e.g. the auto "Planned savings allocation" = income × savings %) into the
  // series, producing the anomalous vertical drops to budget-shaped figures.
  //
  // The full cumulative series is built across ALL history first so every point
  // reflects the real running balance, and is only THEN sliced to the selected
  // period — keeping the first visible point anchored to the true balance.
  const timelineData = useMemo(() => {
    const events = transactions.filter(
      (t) => t.type === "income" || t.type === "expense",
    );
    if (events.length === 0) return [];

    // Bucket by a stable YYYY-MM-DD key derived from created_at (the authoritative
    // event time) falling back to date. Slicing the first 10 chars avoids
    // timezone-dependent Date parsing, so bundled "Salary" + fixed-expense rows
    // created the same instant land on the correct, single day.
    const keyOf = (t: { created_at?: string; date: string }) =>
      (t.created_at ?? t.date).slice(0, 10);

    const sorted = [...events].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

    const dailyMap = new Map<string, number>();
    let runningBalance = 0;
    sorted.forEach((tx) => {
      runningBalance += tx.type === "income" ? Number(tx.amount) : -Number(tx.amount);
      dailyMap.set(keyOf(tx), runningBalance); // last write wins → end-of-day balance
    });

    let entries = Array.from(dailyMap.entries());

    // Period filter (0 = all time). Slice AFTER the cumulative sum so the first
    // visible point keeps its true running balance instead of resetting to zero.
    if (timelinePeriod > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - timelinePeriod);
      const cutoffKey = cutoff.toISOString().slice(0, 10);
      entries = entries.filter(([key]) => key >= cutoffKey);
    }

    return entries.map(([key, balance]) => {
      const [y, m, d] = key.split("-").map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(i18n.language, {
        day: "2-digit",
        month: "short",
      });
      return { date: label, balance };
    });
  }, [transactions, i18n.language, timelinePeriod]);

  const nextPayday = useMemo((): Date | null => {
    if (paydayMode === 'fixed' && fixedPayday > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const d = today.getDate(), m = today.getMonth(), y = today.getFullYear();
      return d < fixedPayday ? new Date(y, m, fixedPayday) : new Date(y, m + 1, fixedPayday);
    }
    if (manualNextPayday) {
      const raw = manualNextPayday.includes('T') ? manualNextPayday : manualNextPayday + 'T12:00:00';
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime()) && parsed > new Date()) return parsed;
    }
    return null;
  }, [paydayMode, fixedPayday, manualNextPayday]);

  const lastPayday = useMemo((): Date => {
    if (paydayMode === 'fixed' && fixedPayday > 0) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const d = today.getDate(), m = today.getMonth(), y = today.getFullYear();
      return d >= fixedPayday ? new Date(y, m, fixedPayday) : new Date(y, m - 1, fixedPayday);
    }
    const lastIncome = transactions
      .filter(t => t.type === 'income' && (t.income_type === 'one_time' || !t.income_type))
      .map(t => { const raw = t.date.includes('T') ? t.date : t.date + 'T12:00:00'; return new Date(raw); })
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (lastIncome) return lastIncome;
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, [paydayMode, fixedPayday, transactions]);

  const dailySpendingRate = useMemo(() => {
    const daysElapsed = Math.max(1, Math.ceil((Date.now() - lastPayday.getTime()) / 86_400_000) + 1);
    const total = transactions
      .filter(t => t.type === "expense" && new Date(t.date) >= lastPayday)
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return total / daysElapsed;
  }, [transactions, lastPayday]);

  const daysRemaining = useMemo(() => {
    if (nextPayday) {
      return Math.max(0, Math.ceil((nextPayday.getTime() - Date.now()) / 86_400_000));
    }
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(0, lastDay - now.getDate());
  }, [nextPayday]);

  // ── Cycle-aware blended burn-rate forecast ───────────────────────────────
  // When a salary cycle is active we forecast end-of-cycle solvency from the
  // server-authoritative cycle stats instead of naive `balance − days × rate`
  // division (which produced alarming, alienating deficits). The burn rate is a
  // BLEND of the real rolling 7-day spending velocity and the even-pace budget
  // ceiling, capped so a single heavy week cannot project an unhinged shortfall.
  const cycleForecast = useMemo(() => {
    if (!hasActiveCycle || !cycleStats || !currentCycle) return null;

    const variableAllowance = cycleStats.variable_allowance ?? 0;
    const variableSpent = cycleStats.cycle_variable_expenses ?? 0;
    const fixedExpenses = cycleStats.cycle_fixed_expenses ?? 0;
    const totalIncome = cycleStats.cycle_income || currentCycle.total_income || 0;
    const remainingAllowance = Math.max(0, variableAllowance - variableSpent);
    const daysLeft = Math.max(0, cycleStats.days_remaining ?? 0);

    // Even-pace ceiling rate: spread whatever allowance remains evenly.
    const evenPace = daysLeft > 0 ? remainingAllowance / daysLeft : 0;

    // Real rolling 7-day variable spending velocity (fixed expenses excluded —
    // they're committed and already in the cycle budget).
    const fixedCatId = Number(currentCycle.fixed_exp_category_id ?? 0);
    const cutoff = Date.now() - 7 * 86_400_000;
    const last7Variable = transactions
      .filter(t =>
        t.type === 'expense' &&
        new Date(t.date).getTime() >= cutoff &&
        !(fixedCatId > 0 && Number(t.category?.id) === fixedCatId))
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const rolling7 = last7Variable / 7;

    // Blend: weight recent behaviour but anchor to the budget ceiling.
    const blendedDaily = rolling7 > 0 ? 0.6 * rolling7 + 0.4 * evenPace : evenPace;

    // Project remaining variable spend, capped at +15% of what's actually left.
    const projectedRemaining = Math.min(blendedDaily * daysLeft, remainingAllowance * 1.15);
    const projectedTotalVariable = variableSpent + projectedRemaining;
    const projectedEndState = remainingAllowance - projectedRemaining;

    // HARD deficit only when unavoidable fixed costs + the real projected
    // variable trend mathematically exceed total aggregate cycle income.
    const isHardDeficit = fixedExpenses + projectedTotalVariable > totalIncome + 0.01;

    // Present cleanly: surface a negative only for a true hard deficit; otherwise
    // show the projected leftover (≥ 0) so a tight-but-solvent cycle reads calmly.
    const displayBalance = isHardDeficit
      ? totalIncome - (fixedExpenses + projectedTotalVariable)
      : Math.max(0, projectedEndState);

    return { displayBalance, blendedDaily, daysLeft };
  }, [hasActiveCycle, cycleStats, currentCycle, transactions]);

  const periodLabel = cycleForecast || nextPayday !== null ? 'payday' : 'month';

  // Prefer the cycle-aware blended forecast; otherwise fall back to Python's
  // already-stabilized end-of-month prediction (never the naive client calc).
  const displayedPredictedBalance = cycleForecast
    ? cycleForecast.displayBalance
    : analysis?.predicted_end_of_month_balance ?? null;

  const displayDailyRate = cycleForecast ? cycleForecast.blendedDaily : dailySpendingRate;
  const displayDaysRemaining = cycleForecast ? cycleForecast.daysLeft : daysRemaining;

  // Savings forecast: cycle income vs projected expenses → monthly & annual rate
  const cycleIncome = useMemo(() => {
    return transactions
      .filter(t => t.type === 'income' && new Date(t.date) >= lastPayday)
      .reduce((s, t) => s + Number(t.amount), 0);
  }, [transactions, lastPayday]);

  const cycleExpensesActual = useMemo(() => {
    return transactions
      .filter(t => t.type === 'expense' && new Date(t.date) >= lastPayday)
      .reduce((s, t) => s + Number(t.amount), 0);
  }, [transactions, lastPayday]);

  const projectedCycleExpenses = cycleExpensesActual + daysRemaining * dailySpendingRate;
  const effectiveCycleIncome = cycleIncome > 0 ? cycleIncome : expectedSalary;
  const projectedMonthlySavings = effectiveCycleIncome - projectedCycleExpenses;

  // Use AI-computed accumulated savings if available, else use current all-time balance
  const accumulatedSavings = useMemo(() => {
    if (analysis?.predicted_savings_balance !== null && analysis?.predicted_savings_balance !== undefined) {
      return analysis.predicted_savings_balance;
    }
    return transactions.reduce((acc, t) =>
      acc + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);
  }, [analysis, transactions]);

  // ── Unified savings forecast (single source) ─────────────────────────────
  // When a cycle is active, surface the authoritative planned allocation and
  // real accumulated pool balance (the figures the dashboard card used to show);
  // otherwise fall back to the burn-rate projection for cycle-less users.
  const sfThisCycle = hasActiveCycle && cycleStats ? cycleStats.dynamic_savings ?? 0 : projectedMonthlySavings;
  const sfAnnual = sfThisCycle * 12;
  const sfAccumulated = hasActiveCycle && cycleStats ? cycleStats.saved_money_balance ?? 0 : accumulatedSavings;
  const sfPositive = sfThisCycle >= 0;
  const showSavingsForecast = hasActiveCycle || effectiveCycleIncome > 0 || monthlySpendingGoal > 0;

  if (loading)
    return <div className="statistics-wrapper">{t("statistics.loading")}</div>;

  return (
    <div className="statistics-wrapper">
      <h1 className="statistics-title">{t("statistics.title")}</h1>

      <div className="charts-layout">
        <div className="stat-chart-card">
          <h2>
            <PieIcon size={22} color="#6366f1" /> {t("statistics.expenses_by_cat")}
          </h2>
          {categoryData.length > 0 ? (
            <CategoryChart data={categoryData} formatAmount={formatAmount} />
          ) : (
            <div className="no-data-msg">{t("statistics.no_expenses")}</div>
          )}
        </div>

        {!liteMode && (
        <div className="stat-chart-card">
          <div className="stat-chart-head">
            <h2>
              <TrendingUp size={22} color="#10b981" /> {t("statistics.balance_timeline")}
            </h2>
            <div
              className="stat-period-filter"
              role="group"
              aria-label={t("statistics.balance_timeline")}
            >
              {TIMELINE_PERIODS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  className={`stat-period-btn${timelinePeriod === p.days ? " stat-period-btn--active" : ""}`}
                  onClick={() => setTimelinePeriod(p.days)}
                >
                  {t(p.labelKey)}
                </button>
              ))}
            </div>
          </div>
          {timelineData.length > 0 ? (
            <div style={{ width: "100%", height: 300, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData}>
                  <defs>
                    <linearGradient
                      id="colorBalance"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={isDark ? "#1e2a3a" : "#f1f5f9"}
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    dy={10}
                    padding={{ left: 20, right: 20 }}
                    minTickGap={44}
                  />
                  <YAxis hide={true} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const val =
                        typeof payload[0].value === "number" ? payload[0].value : 0;
                      return (
                        <div className="balance-tooltip">
                          <span className="balance-tooltip-date">{String(label)}</span>
                          <span
                            className="balance-tooltip-amount"
                            style={{ color: val >= 0 ? "#10b981" : "#f87171" }}
                          >
                            {formatAmount(val)}
                          </span>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="#10b981"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorBalance)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="no-data-msg">
              <p>{t("statistics.no_data")}</p>
              <span>{t("statistics.no_data_sub")}</span>
            </div>
          )}
        </div>
        )}
      </div>

      {!liteMode && (
      <div className="forecast-row">
        {analysis && (
          <ForecastCard
            predictedBalance={displayedPredictedBalance}
            healthScore={analysis.financial_health_score}
            spendingTier={analysis.spending_tier}
            dailyRate={displayDailyRate}
            onClick={() => setForecastOpen(true)}
          />
        )}

        {showSavingsForecast && (
          <div className={`savings-forecast-card ${sfPositive ? 'savings-forecast-card--pos' : 'savings-forecast-card--neg'}`}>
            <div className="savings-forecast-header">
              <div className="savings-forecast-icon">
                <PiggyBank size={20} />
              </div>
              <span className="savings-forecast-title">{t('statistics.savings_forecast_title')}</span>
            </div>
            <div className="savings-forecast-body">
              <div className="savings-forecast-stat">
                <span className="savings-forecast-stat-label">{t('statistics.savings_forecast_this_cycle')}</span>
                <span
                  className="savings-forecast-stat-value"
                  style={{ color: sfThisCycle >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)' }}
                >
                  {sfThisCycle >= 0 ? '+' : ''}{formatAmount(sfThisCycle)}
                </span>
              </div>
              <div className="savings-forecast-stat">
                <span className="savings-forecast-stat-label">{t('statistics.savings_forecast_annual')}</span>
                <span
                  className="savings-forecast-stat-value"
                  style={{ color: sfAnnual >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)' }}
                >
                  {sfAnnual >= 0 ? '~+' : '~'}{formatAmount(sfAnnual)}
                </span>
              </div>
              <div className="savings-forecast-stat">
                <span className="savings-forecast-stat-label">{t('statistics.savings_forecast_accumulated')}</span>
                <span
                  className="savings-forecast-stat-value"
                  style={{ color: sfAccumulated >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)' }}
                >
                  {formatAmount(sfAccumulated)}
                </span>
              </div>
            </div>
            <p className="savings-forecast-tip">
              {sfPositive
                ? t('statistics.savings_forecast_tip_pos')
                : t('statistics.savings_forecast_tip_neg')}
            </p>
          </div>
        )}
      </div>
      )}

      {!liteMode && (
      <ForecastDetailModal
        open={forecastOpen}
        predictedBalance={displayedPredictedBalance}
        healthScore={analysis?.financial_health_score ?? null}
        spendingTier={analysis?.spending_tier ?? "pacing_good"}
        dailyRate={displayDailyRate}
        daysRemaining={displayDaysRemaining}
        periodLabel={periodLabel}
        onClose={() => setForecastOpen(false)}
      />
      )}
    </div>
  );
};

export default Statistics;
