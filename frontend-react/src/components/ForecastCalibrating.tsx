import React from "react";
import { Hourglass } from "lucide-react";
import { useTranslation } from "react-i18next";
import "./ForecastCalibrating.css";

// The forecast's calm first-week state: shown instead of the projected figure
// until a week of spending exists (server flag `calibrating`), so one big shop
// on day 1 never reads as an alarming deficit. Shared by the card and modal.
const ForecastCalibrating: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="forecast-calibrating" role="status">
      <Hourglass size={22} className="forecast-calibrating-icon" aria-hidden="true" />
      <div className="forecast-calibrating-text">
        <p className="forecast-calibrating-title">{t("statistics.forecast_calibrating_title")}</p>
        <p className="forecast-calibrating-hint">{t("statistics.forecast_calibrating_hint")}</p>
      </div>
    </div>
  );
};

export default ForecastCalibrating;
