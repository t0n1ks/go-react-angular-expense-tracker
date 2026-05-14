import React from "react";
import { motion } from "framer-motion";
import { BrainCircuit, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../context/SettingsContext";
import "./ForecastCard.css";

interface Props {
  predictedBalance: number | null;
  healthScore: number | null;
  spendingTier: string;
  dailyRate: number;
  onClick: () => void;
}

const ForecastCard: React.FC<Props> = ({
  predictedBalance,
  healthScore,
  spendingTier,
  dailyRate,
  onClick,
}) => {
  const { t } = useTranslation();
  const { formatAmount } = useSettings();

  const isPositive = predictedBalance !== null && predictedBalance >= 0;

  const tierKey = `ai.forecast_tier.${spendingTier}` as const;
  const tierLabel = t(tierKey, { defaultValue: spendingTier.replace(/_/g, " ") });

  return (
    <motion.div
      className={`forecast-card ${isPositive ? "forecast-card--positive" : "forecast-card--negative"}`}
      onClick={onClick}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", damping: 24, stiffness: 300 }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      aria-label={t("statistics.forecast_aria")}
    >
      <div className="forecast-card-header">
        <div className="forecast-card-icon">
          <BrainCircuit size={20} />
        </div>
        <span className="forecast-card-title">{t("statistics.forecast_title")}</span>
        <ChevronRight size={18} className="forecast-card-chevron" />
      </div>

      <div className="forecast-card-body">
        {predictedBalance === null ? (
          <span className="forecast-card-unavail">{t("statistics.forecast_unavailable")}</span>
        ) : (
          <>
            <div className={`forecast-balance ${isPositive ? "forecast-balance--pos" : "forecast-balance--neg"}`}>
              {isPositive ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
              <span className="forecast-balance-amount">{formatAmount(Math.abs(predictedBalance))}</span>
              <span className="forecast-balance-sign">{isPositive ? t("statistics.forecast_surplus") : t("statistics.forecast_deficit")}</span>
            </div>

            <p className="forecast-rate-line">
              {t("statistics.forecast_rate_line", { rate: formatAmount(dailyRate) })}
            </p>
          </>
        )}
      </div>

      {healthScore !== null && (
        <div className="forecast-health-bar-wrap">
          <div className="forecast-health-bar-track">
            <motion.div
              className="forecast-health-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${healthScore}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              style={{
                background: healthScore > 60 ? "#10b981" : healthScore > 35 ? "#f59e0b" : "#f87171",
              }}
            />
          </div>
          <span className="forecast-health-label">
            {t("statistics.forecast_health")} {healthScore}/100
          </span>
        </div>
      )}

      <div className="forecast-tier-badge">{tierLabel}</div>
    </motion.div>
  );
};

export default ForecastCard;
