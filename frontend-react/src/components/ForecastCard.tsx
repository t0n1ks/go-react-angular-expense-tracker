import React from "react";
import { motion } from "framer-motion";
import { BrainCircuit, TrendingUp, TrendingDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../context/SettingsContext";
import "./ForecastCard.css";

interface Props {
  predictedBalance: number; // budget left at the period's end; negative = deficit
  spendingTier: string | null; // AI pace verdict; no badge while it is unknown
  dailyRate: number; // the real average daily pace the projection uses
  rough: boolean; // fewer than 3 days of history
  onClick: () => void;
}

const ForecastCard: React.FC<Props> = ({
  predictedBalance,
  spendingTier,
  dailyRate,
  rough,
  onClick,
}) => {
  const { t } = useTranslation();
  const { formatAmount } = useSettings();

  const isPositive = predictedBalance >= 0;

  const tierLabel = spendingTier
    ? t(`ai.forecast_tier.${spendingTier}`, { defaultValue: spendingTier.replace(/_/g, " ") })
    : null;

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
        <div className={`forecast-balance ${isPositive ? "forecast-balance--pos" : "forecast-balance--neg"}`}>
          {isPositive ? <TrendingUp size={22} aria-hidden="true" /> : <TrendingDown size={22} aria-hidden="true" />}
          <span className="forecast-balance-amount">
            {isPositive ? "" : "−"}{formatAmount(Math.abs(predictedBalance))}
          </span>
          <span className="forecast-balance-sign">{isPositive ? t("statistics.forecast_surplus") : t("statistics.forecast_deficit")}</span>
        </div>

        <p className="forecast-rate-line">
          {t("statistics.forecast_rate_line", { rate: formatAmount(dailyRate) })}
        </p>
        {rough && <p className="forecast-rough">{t("statistics.forecast_rough")}</p>}
      </div>

      {tierLabel && <div className="forecast-tier-badge">{tierLabel}</div>}
    </motion.div>
  );
};

export default ForecastCard;
