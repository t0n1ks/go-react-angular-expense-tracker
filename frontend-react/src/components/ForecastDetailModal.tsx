import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, BrainCircuit, Flame, CalendarCheck2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../context/SettingsContext";
import ForecastCalibrating from "./ForecastCalibrating";
import "./ForecastDetailModal.css";

interface Props {
  open: boolean;
  predictedBalance: number | null;
  spendingTier: string;
  dailyRate: number;
  daysRemaining: number;
  calibrating: boolean; // first week: "collecting data" instead of the figures
  periodLabel?: 'payday' | 'month';
  onClose: () => void;
}

const ForecastDetailModal: React.FC<Props> = ({
  open,
  predictedBalance,
  spendingTier,
  dailyRate,
  daysRemaining,
  calibrating,
  periodLabel = 'month',
  onClose,
}) => {
  const { t } = useTranslation();
  const { formatAmount } = useSettings();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const isPositive = predictedBalance !== null && predictedBalance >= 0;

  const tierKey = `ai.forecast_tier.${spendingTier}` as const;
  const tierLabel = t(tierKey, { defaultValue: spendingTier.replace(/_/g, " ") });

  // Days until payday / month end — factual, so shown in every state.
  const daysLeftRow = (
    <div className="fmd-row">
      <CalendarCheck2 size={16} className="fmd-row-icon" />
      <div className="fmd-row-content">
        <span className="fmd-row-label">
          {t(periodLabel === 'payday' ? "statistics.forecast_modal_days_until_payday" : "statistics.forecast_modal_days_left")}
        </span>
        <span className="fmd-row-value">
          {t(periodLabel === 'payday' ? "statistics.forecast_modal_days_payday_count" : "statistics.forecast_modal_days_remaining", { count: daysRemaining })}
        </span>
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fmd-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            className="fmd-modal"
            initial={{ opacity: 0, y: 48, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 380 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="fmd-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>

            <div className="fmd-header">
              <div className="fmd-icon">
                <BrainCircuit size={22} />
              </div>
              <h2 className="fmd-title">{t(periodLabel === 'payday' ? "statistics.forecast_modal_title_payday" : "statistics.forecast_modal_title")}</h2>
            </div>

            <div className="fmd-divider" />

            {predictedBalance === null ? (
              <p className="fmd-unavail">{t("statistics.forecast_unavailable")}</p>
            ) : calibrating ? (
              <>
                <ForecastCalibrating />

                <div className="fmd-divider" />

                <div className="fmd-rows">{daysLeftRow}</div>

                <div className="fmd-tier-row">
                  <span className="fmd-tier-label">{t("statistics.forecast_modal_tier")}</span>
                  <span className="fmd-tier-value">{tierLabel}</span>
                </div>
              </>
            ) : (
              <>
                <div className={`fmd-balance ${isPositive ? "fmd-balance--pos" : "fmd-balance--neg"}`}>
                  {isPositive ? "+" : "−"}{formatAmount(Math.abs(predictedBalance))}
                </div>
                <p className="fmd-balance-sub">
                  {isPositive
                    ? t(periodLabel === 'payday' ? "statistics.forecast_positive_payday" : "statistics.forecast_positive")
                    : t(periodLabel === 'payday' ? "statistics.forecast_negative_payday" : "statistics.forecast_negative")}
                </p>

                <div className="fmd-divider" />

                <div className="fmd-rows">
                  <div className="fmd-row">
                    <Flame size={16} className="fmd-row-icon" />
                    <div className="fmd-row-content">
                      <span className="fmd-row-label">{t("statistics.forecast_modal_rate")}</span>
                      <span className="fmd-row-value">{formatAmount(dailyRate)} / {t("statistics.forecast_modal_day")}</span>
                    </div>
                  </div>

                  {daysLeftRow}
                </div>

                <div className="fmd-divider" />

                <div className="fmd-context">
                  <p>
                    {t(periodLabel === 'payday' ? "statistics.forecast_modal_context_payday" : "statistics.forecast_modal_context", {
                      rate: formatAmount(dailyRate),
                      balance: formatAmount(Math.abs(predictedBalance)),
                      direction: isPositive ? t("statistics.forecast_modal_surplus_word") : t("statistics.forecast_modal_deficit_word"),
                    })}
                  </p>
                </div>

                <div className="fmd-tier-row">
                  <span className="fmd-tier-label">{t("statistics.forecast_modal_tier")}</span>
                  <span className="fmd-tier-value">{tierLabel}</span>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ForecastDetailModal;
