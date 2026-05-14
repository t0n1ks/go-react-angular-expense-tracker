import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";
import { useTranslation } from "react-i18next";
import { useTheme } from "../context/ThemeContext";
import { PieChart as PieIcon, TrendingUp } from "lucide-react";
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
  date: string;
  category?: { name: string };
}

interface AnalysisResult {
  predicted_end_of_month_balance: number | null;
  financial_health_score: number | null;
  spending_tier: string;
}

const Statistics: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount } = useSettings();
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

  const dailySpendingRate = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysElapsed = Math.max(1, now.getDate());
    const total = transactions
      .filter((t) => t.type === "expense" && new Date(t.date) >= monthStart)
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    return total / daysElapsed;
  }, [transactions]);

  const daysRemaining = useMemo(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.max(0, lastDay - now.getDate());
  }, []);

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

      {analysis && (
        <div className="forecast-section">
          <ForecastCard
            predictedBalance={analysis.predicted_end_of_month_balance}
            healthScore={analysis.financial_health_score}
            spendingTier={analysis.spending_tier}
            dailyRate={dailySpendingRate}
            onClick={() => setForecastOpen(true)}
          />
        </div>
      )}

      <ForecastDetailModal
        open={forecastOpen}
        predictedBalance={analysis?.predicted_end_of_month_balance ?? null}
        healthScore={analysis?.financial_health_score ?? null}
        spendingTier={analysis?.spending_tier ?? "pacing_good"}
        dailyRate={dailySpendingRate}
        daysRemaining={daysRemaining}
        onClose={() => setForecastOpen(false)}
      />
    </div>
  );
};

export default Statistics;
