import { describe, it, expect, beforeAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import ru from '../i18n/locales/ru.json';

// The forecast popup mirrors the card: in the first week it shows the
// "collecting data" state plus the factual days left — no projected figure,
// no pace, no "you will be in the red" sentence.

vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ formatAmount: (n: number) => `€${n.toFixed(2)}` }),
}));

const { default: ForecastDetailModal } = await import('./ForecastDetailModal');

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ru: { translation: ru } },
    lng: 'ru',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

const render = (calibrating: boolean) =>
  renderToStaticMarkup(
    <ForecastDetailModal
      open
      predictedBalance={-314.73}
      spendingTier="pacing_good"
      dailyRate={45}
      daysRemaining={24}
      periodLabel="payday"
      calibrating={calibrating}
      onClose={() => {}}
    />,
  );

describe('ForecastDetailModal', () => {
  it('first week: "collecting data" and days left, no figures', () => {
    const html = render(true);
    expect(html).toContain(i18n.t('statistics.forecast_calibrating_title'));
    expect(html).toContain(i18n.t('statistics.forecast_modal_days_payday_count', { count: 24 }));
    expect(html).not.toContain('314.73');
    expect(html).not.toContain('€45.00');
    expect(html).not.toContain(i18n.t('statistics.forecast_modal_deficit_word'));
  });

  it('after the first week: the projection, pace and days left', () => {
    const html = render(false);
    expect(html).toContain('€314.73');
    expect(html).toContain('€45.00');
    expect(html).toContain(i18n.t('statistics.forecast_modal_days_payday_count', { count: 24 }));
    expect(html).not.toContain(i18n.t('statistics.forecast_calibrating_title'));
  });
});
