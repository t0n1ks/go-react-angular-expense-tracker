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
} from "recharts";
import CategoryChart from "../components/CategoryChart";
import "./Statistics.css";

interface Transaction {
  amount: number;
  type: "expense" | "income";
  date: string;
  category?: { name: string };
}

const Statistics: React.FC = () => {
  const { axiosInstance } = useAuth();
  const { formatAmount } = useSettings();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
      const dateKey = new Date(t.date).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "short",
      });
      const amount = t.type === "income" ? Number(t.amount) : -Number(t.amount);
      runningBalance += amount;
      dailyMap[dateKey] = runningBalance;
    });

    return Object.keys(dailyMap).map((date) => ({
      date,
      balance: dailyMap[date],
    }));
  }, [transactions]);

  if (loading)
    return <div className="statistics-wrapper">{t('statistics.loading')}</div>;

  return (
    <div className="statistics-wrapper">
      <h1 className="statistics-title">{t('statistics.title')}</h1>

      <div className="charts-layout">
        <div className="stat-chart-card">
          <h2>
            <PieIcon size={22} color="#6366f1" /> {t('statistics.expenses_by_cat')}
          </h2>
          {categoryData.length > 0 ? (
            <CategoryChart data={categoryData} formatAmount={formatAmount} />
          ) : (
            <div className="no-data-msg">{t('statistics.no_expenses')}</div>
          )}
        </div>

        <div className="stat-chart-card">
          <h2>
            <TrendingUp size={22} color="#10b981" /> {t('statistics.balance_timeline')}
          </h2>
          {timelineData.length > 0 ? (
            <div style={{ width: "100%", height: 300 }}>
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
                    stroke={isDark ? '#1e2a3a' : '#f1f5f9'}
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: isDark ? '#94a3b8' : '#94a3b8', fontSize: 12 }}
                    dy={10}
                    interval={0}
                    padding={{ left: 20, right: 20 }}
                    minTickGap={5}
                  />
                  <YAxis hide={true} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 10px 15px rgba(0,0,0,0.1)",
                    }}
                    itemStyle={{ color: "#10b981", fontWeight: "bold" }}
                    formatter={(value) => [formatAmount(typeof value === 'number' ? value : 0), '']}
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
              <p>{t('statistics.no_data')}</p>
              <span>{t('statistics.no_data_sub')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Statistics;
