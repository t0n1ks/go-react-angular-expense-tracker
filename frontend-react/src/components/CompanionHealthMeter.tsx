import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompanionMood } from '../utils/companion';

// The UFO's health: a bar with the percentage written inside it; its colour
// follows the mood (green → amber → red). The mood word is not shown — it is
// part of the meter's accessible text ("72% — calm"), so colour is never the
// only signal. The whole bar is tappable: it explains the current health.

interface Props {
  health: number;
  mood: CompanionMood;
  reason: string;
  onExplain: () => void;
  // Purely cosmetic value drawn in the bar for a moment (the welcome-back
  // "glitch"); the accessible value always stays the true health.
  displayHealth?: number;
}

const CompanionHealthMeter: React.FC<Props> = ({ health, mood, reason, onExplain, displayHealth }) => {
  const { t } = useTranslation();
  const reasonId = useId();
  const value = Math.max(0, Math.min(100, Math.round(health)));
  const glitching = displayHealth !== undefined;
  const shown = glitching ? Math.max(0, Math.min(100, Math.round(displayHealth))) : value;
  const moodLabel = t(`companion.mood.${mood}`);

  return (
    <div className="tama-health">
      <div
        className={`tama-health-track tama-health-track--${mood}${glitching ? ' tama-health-track--glitch' : ''}`}
        role="meter"
        aria-label={t('companion.health_label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={t('companion.health_valuetext', { value, mood: moodLabel })}
        aria-describedby={reasonId}
      >
        <span className="tama-health-fill" style={{ width: `${shown}%` }} />
        <span className="tama-health-value" aria-hidden="true">{shown}%</span>
      </div>
      {/* Covers the bar: tap or Enter explains why. */}
      <button
        type="button"
        className="tama-health-explain"
        onClick={onExplain}
        aria-label={t('companion.health_explain', { value, mood: moodLabel })}
        aria-describedby={reasonId}
        title={reason}
      />
      <span id={reasonId} hidden>{reason}</span>
    </div>
  );
};

export default CompanionHealthMeter;
