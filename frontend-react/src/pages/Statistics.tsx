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
  Brush,
} from "recharts";
import CategoryChart from "../components/CategoryChart";
import ForecastCard from "../components/ForecastCard";
import ForecastDetailModal from "../components/ForecastDetailModal";
import "./Statistics.css";

interface Transaction {
  amount: number;
  type: "expense" | "income";
  income_type?: string;
  date: string;
  category?: { name: string };
}

interface AnalysisResult {
  predicted_end_of_month_balance: number | null;
  predicted_savings_balance: number | null;
  financial_health_score: number | null;
  spending_tier: string;
}

const Statistics: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount, paydayMode, fixedPayday, manualNextPayday, monthlySpendingGoal, expectedSalary } = useSettings();
  const { t, i18n } = useTranslation();
  const { isDark } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [forecastOpen, setForecastOpen] = useState(false);

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
    fetchAnalysis();
  }, [fetchData, fetchAnalysis]);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    transactions
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        const name = t.category?.name || "—";
        map[name] = (map[name] || 0) + Math.abs(Number(t.amount));
      });

    return Object.keys(map)
      .map((name) => ({ name, value: map[name] }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const timelineData = useMemo(() => {
    if (transactions.length === 0) return [];

    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const dailyMap: Record<string, number> = {};
    let runningBalance = 0;

    sortedTransactions.forEach((t) => {
      const dateKey = new Date(t.date).toLocaleDateString(i18n.language, {
        day: "2-digit",
        month: "short",
      });
      const amount = t.type === "income" ? Number(t.amount) : -Number(t.amount);
      runningBalance += amount;
      dailyMap[dateKey] = runningBalance;
    });

    return Object.entries(dailyMap).map(([date, balance]) => ({ date, balance }));
  }, [transactions, i18n.language]);

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

  const periodLabel = nextPayday !== null ? 'payday' : 'month';

  const displayedPredictedBalance = useMemo(() => {
    if (nextPayday) {
      // Project current balance forward at the same daily rate used everywhere else.
      // Mixing Python's ML prediction with the frontend average rate produced values
      // that could exceed the actual current balance (incoherent).
      const currentBalance =
        transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0) -
        transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      return currentBalance - daysRemaining * dailySpendingRate;
    }
    return analysis?.predicted_end_of_month_balance ?? null;
  }, [analysis, nextPayday, transactions, daysRemaining, dailySpendingRate]);

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
  const projectedAnnualSavings = projectedMonthlySavings * 12;

  // Use AI-computed accumulated savings if available, else use current all-time balance
  const accumulatedSavings = useMemo(() => {
    if (analysis?.predicted_savings_balance !== null && analysis?.predicted_savings_balance !== undefined) {
      return analysis.predicted_savings_balance;
    }
    return transactions.reduce((acc, t) =>
      acc + (t.type === 'income' ? Number(t.amount) : -Number(t.amount)), 0);
  }, [analysis, transactions]);

  const BRUSH_WINDOW = 14;
  const needsBrush = timelineData.length > 7;
  const brushStart = Math.max(0, timelineData.length - BRUSH_WINDOW);

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

        <div className="stat-chart-card">
          <h2>
            <TrendingUp size={22} color="#10b981" /> {t("statistics.balance_timeline")}
          </h2>
          {timelineData.length > 0 ? (
            <div style={{ width: "100%", height: needsBrush ? 340 : 300, minWidth: 0 }}>
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
                  {needsBrush && (
                    <Brush
                      key={`brush-${timelineData.length}`}
                      dataKey="date"
                      height={28}
                      stroke={isDark ? "#334155" : "#e2e8f0"}
                      fill={isDark ? "#1e293b" : "#f8fafc"}
                      travellerWidth={6}
                      startIndex={brushStart}
                      endIndex={timelineData.length - 1}
                    />
                  )}
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
      </div>

      <div className="forecast-row">
        {analysis && (
          <ForecastCard
            predictedBalance={displayedPredictedBalance}
            healthScore={analysis.financial_health_score}
            spendingTier={analysis.spending_tier}
            dailyRate={dailySpendingRate}
            onClick={() => setForecastOpen(true)}
          />
        )}

        {(effectiveCycleIncome > 0 || monthlySpendingGoal > 0) && (
          <div className={`savings-forecast-card ${projectedMonthlySavings >= 0 ? 'savings-forecast-card--pos' : 'savings-forecast-card--neg'}`}>
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
                  style={{ color: projectedMonthlySavings >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)' }}
                >
                  {projectedMonthlySavings >= 0 ? '+' : ''}{formatAmount(projectedMonthlySavings)}
                </span>
              </div>
              <div className="savings-forecast-stat">
                <span className="savings-forecast-stat-label">{t('statistics.savings_forecast_annual')}</span>
                <span
                  className="savings-forecast-stat-value"
                  style={{ color: projectedAnnualSavings >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)' }}
                >
                  {projectedAnnualSavings >= 0 ? '~+' : '~'}{formatAmount(projectedAnnualSavings)}
                </span>
              </div>
              <div className="savings-forecast-stat">
                <span className="savings-forecast-stat-label">{t('statistics.savings_forecast_accumulated')}</span>
                <span
                  className="savings-forecast-stat-value"
                  style={{ color: accumulatedSavings >= 0 ? 'var(--color-income-text)' : 'var(--color-expense-text)' }}
                >
                  {formatAmount(accumulatedSavings)}
                </span>
              </div>
            </div>
            <p className="savings-forecast-tip">
              {projectedMonthlySavings >= 0
                ? t('statistics.savings_forecast_tip_pos')
                : t('statistics.savings_forecast_tip_neg')}
            </p>
          </div>
        )}
      </div>

      <ForecastDetailModal
        open={forecastOpen}
        predictedBalance={displayedPredictedBalance}
        healthScore={analysis?.financial_health_score ?? null}
        spendingTier={analysis?.spending_tier ?? "pacing_good"}
        dailyRate={dailySpendingRate}
        daysRemaining={daysRemaining}
        periodLabel={periodLabel}
        onClose={() => setForecastOpen(false)}
      />
    </div>
  );
};

export default Statistics;
