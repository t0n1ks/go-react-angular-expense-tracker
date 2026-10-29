import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompanionMood } from '../utils/companion';

// The UFO's health: a bar (an ARIA meter) with the percentage and the mood
// written out — never colour alone. Tapping the label explains why health is
// where it is, in plain words (the server's reason).

interface Props {
  health: number;
  mood: CompanionMood;
  reason: string;
  onExplain: () => void;
}

const CompanionHealthMeter: React.FC<Props> = ({ health, mood, reason, onExplain }) => {
  const { t } = useTranslation();
  const reasonId = useId();
  const moodLabel = t(`companion.mood.${mood}`);
  const value = Math.max(0, Math.min(100, Math.round(health)));

  return (
    <div className="tama-health">
      <div
        className="tama-health-track"
        role="meter"
        aria-label={t('companion.health_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={t('companion.health_valuetext', { value, mood: moodLabel })}
        aria-describedby={reasonId}
      >
        <span className={`tama-health-fill tama-health-fill--${mood}`} style={{ width: `${value}%` }} />
      </div>
      <button
        type="button"
        className="tama-health-text"
        onClick={onExplain}
        aria-describedby={reasonId}
        title={reason}
      >
        {t('companion.health_short', { value, mood: moodLabel })}
      </button>
      <span id={reasonId} hidden>{reason}</span>
    </div>
  );
};

export default CompanionHealthMeter;
