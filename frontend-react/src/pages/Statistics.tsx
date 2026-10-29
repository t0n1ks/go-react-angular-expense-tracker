import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import { useTranslation } from "react-i18next";
import { PieChart as PieIcon, PiggyBank } from "lucide-react";
import CategoryChart from "../components/CategoryChart";
import { resolveCategoryWindow, isInWindow, txEventTime } from "../utils/categoryWindow";
import { categoryLabel } from "../utils/categoryLabel";
import { type MoneyPoint, type SavingsForecast } from "../utils/balanceTimeline";
import BalanceChart from "../components/BalanceChart";
import ForecastCard from "../components/ForecastCard";
import ForecastDetailModal from "../components/ForecastDetailModal";
import "./Statistics.css";

interface Transaction {
  amount: number;
  type: "expense" | "income" | "savings_deposit" | "savings_withdrawal" | "budget_transfer";
  income_type?: string;
  date: string;
  created_at?: string;
  effective_at?: string;
  category?: { id?: number; name: string; translation_key?: string | null };
}

interface AnalysisResult {
  predicted_end_of_month_balance: number | null;
  predicted_savings_balance: number | null;
  financial_health_score: number | null;
  spending_tier: string;
}

const Statistics: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount, paydayMode, fixedPayday, manualNextPayday, monthlySpendingGoal, expectedSalary, currentCycle, cycleStats, hasActiveCycle, cycleWindow, liteMode } = useSettings();
  const { t, i18n } = useTranslation();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [forecastOpen, setForecastOpen] = useState(false);
  // Server real-money series (cycle users); empty → no-cycle cash-flow chart.
  const [moneySeries, setMoneySeries] = useState<MoneyPoint[]>([]);
  // Server savings forecast from the same real-money history (cycle users).
  const [savingsForecast, setSavingsForecast] = useState<SavingsForecast | null>(null);

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

  // Re-read the real-money series and forecast whenever the cycle figures
  // change, so the chart's latest point and the forecast's "now" always equal
  // the money on hand the cards show.
  useEffect(() => {
    if (liteMode) return;
    axiosInstance
      .get("/balance/timeline")
      .then((res: { data: { points?: MoneyPoint[] } }) =>
        setMoneySeries(Array.isArray(res.data.points) ? res.data.points : []),
      )
      .catch(() => setMoneySeries([]));
    axiosInstance
      .get("/balance/forecast")
      .then((res: { data: { forecast?: SavingsForecast | null } }) => setSavingsForecast(res.data.forecast ?? null))
      .catch(() => setSavingsForecast(null));
  }, [axiosInstance, liteMode, cycleStats]);

  // Donut is scoped to the EXACT window the server computed the cycle stats
  // over ([window_start, window_end), open while the cycle is current), and
  // each transaction is placed by its server effective_at — so the donut and
  // the dashboard cards always agree. resolveCategoryWindow validates that
  // window and, for cycle-less or mis-dated users, falls back to the current
  // calendar month (the same default the forecaster uses) — never to all-time.
  const categoryData = useMemo(() => {
    const catWindow = resolveCategoryWindow({
      hasActiveCycle,
      cycleStartAt: cycleWindow?.start,
      windowEndAt: cycleWindow?.end,
      now: new Date(),
    });

    const map: Record<string, number> = {};
    transactions
      .filter(
        (tx) =>
          tx.type === "expense" && isInWindow(txEventTime(tx), catWindow),
      )
      .forEach((tx) => {
        // Default categories localize via their key; user categories show as typed.
        const name = categoryLabel(tx.category, t, "—");
        map[name] = (map[name] || 0) + Math.abs(Number(tx.amount));
      });

    return Object.keys(map)
      .map((name) => ({ name, value: map[name] }))
      .sort((a, b) => b.value - a.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, hasActiveCycle, cycleWindow, i18n.language]);

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
  // Users with cycles: the server forecast from the real-money history (never
  // the planned allocation × 12) — "this cycle" is the projected real result,
  // "annual" the recency-weighted trend × 365, anchored on money on hand now.
  // Until it arrives the figures show "—" rather than a guess. Users who
  // never had a cycle keep the burn-rate projection.
  const sf = savingsForecast;
  const sfThisCycle: number | null = sf
    ? (hasActiveCycle ? sf.cycle_result : null)
    : (hasActiveCycle ? null : projectedMonthlySavings);
  const sfAnnual: number | null = sf ? sf.annual_change : (hasActiveCycle ? null : projectedMonthlySavings * 12);
  const sfInAYear: number | null = sf ? sf.in_a_year : null;
  const sfRough = !!sf?.rough;
  const sfAccumulated = hasActiveCycle && cycleStats ? cycleStats.saved_money_balance ?? 0 : accumulatedSavings;
  const sfPositive = (sfAnnual ?? sfThisCycle ?? 0) >= 0;
  const signColor = (v: number | null) =>
    v === null ? undefined : v >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)';
  const showSavingsForecast = hasActiveCycle || effectiveCycleIncome > 0 || monthlySpendingGoal > 0;

  if (loading)
    return <div className="statistics-wrapper">{t("statistics.loading")}</div>;

  return (
    <div className="statistics-wrapper">
      <h1 className="statistics-title">{t("statistics.title")}</h1>

      <div className={`charts-layout${liteMode ? " charts-layout--lite" : ""}`}>
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

        {!liteMode && <BalanceChart moneySeries={moneySeries} transactions={transactions} />}
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
                <span className="savings-forecast-stat-value" style={{ color: signColor(sfThisCycle) }}>
                  {sfThisCycle === null ? '—' : `${sfThisCycle >= 0 ? '+' : ''}${formatAmount(sfThisCycle)}`}
                </span>
              </div>
              <div className="savings-forecast-stat">
                <span className="savings-forecast-stat-label">{t('statistics.savings_forecast_annual')}</span>
                <span className="savings-forecast-stat-value" style={{ color: signColor(sfAnnual) }}>
                  {sfAnnual === null ? '—' : `${sfAnnual >= 0 ? '~+' : '~'}${formatAmount(sfAnnual)}`}
                </span>
              </div>
              {sfInAYear !== null && (
                <p
                  className="savings-forecast-anchor"
                  style={{ color: sfInAYear < 0 ? 'var(--color-expense-text)' : undefined }}
                >
                  {t('statistics.savings_forecast_in_a_year', { amount: formatAmount(sfInAYear) })}
                </p>
              )}
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
            {sfRough && (
              <p className="savings-forecast-rough">{t('statistics.savings_forecast_rough')}</p>
            )}
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
