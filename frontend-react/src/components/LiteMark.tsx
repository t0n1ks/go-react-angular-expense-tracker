import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import './LiteMark.css';

// The one place the Lite state is shown: a small engraved «lite» in the app
// header (centred in the phone / tablet bar, beside the logo on desktop),
// only while Lite mode is on. A status, not a control: the visible word is
// decorative and screen readers hear the mode's name instead.

const LiteMark: React.FC<{ placement: 'bar' | 'sidebar' }> = ({ placement }) => {
  const { t } = useTranslation();
  const { liteMode } = useSettings();
  if (!liteMode) return null;
  return (
    <span className={`lite-mark lite-mark--${placement}`} title={t('settings.lite_title')}>
      <span className="lite-mark-word" aria-hidden="true">lite</span>
      <span className="sr-only">{t('settings.lite_title')}</span>
    </span>
  );
};

export default LiteMark;
