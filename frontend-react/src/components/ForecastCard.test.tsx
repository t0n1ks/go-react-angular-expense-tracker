import { describe, it, expect, beforeAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';

// The month-end forecast card renders the server's numbers as they are: a
// deficit is shown as a deficit (minus sign + label), the rate is the server's
// real average pace, and during the first week a calm "collecting data"
// state replaces the figures (no alarming deficit from almost no data).

vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ formatAmount: (n: number) => `€${n.toFixed(2)}` }),
}));

const { default: ForecastCard } = await import('./ForecastCard');

const LANGS = ['en', 'de', 'ru', 'uk'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

const render = (predictedBalance: number, calibrating = false, spendingTier: string | null = 'pacing_good') =>
  renderToStaticMarkup(
    <ForecastCard predictedBalance={predictedBalance} spendingTier={spendingTier} dailyRate={7.6} calibrating={calibrating} onClick={() => {}} />,
  );

describe('ForecastCard', () => {
  it.each(LANGS)('shows a projected deficit honestly (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const html = render(-42.5);
    expect(html).toContain('forecast-card--negative');
    expect(html).toContain('−€42.50');
    expect(html).toContain(i18n.t('statistics.forecast_deficit'));
    expect(html).toContain(i18n.t('statistics.forecast_rate_line', { rate: '€7.60' }));
    expect(html).not.toMatch(/statistics\./);
  });

  it('shows a surplus without a sign', async () => {
    await i18n.changeLanguage('ru');
    const html = render(50);
    expect(html).toContain('forecast-card--positive');
    expect(html).toMatch(/forecast-balance-amount">€50\.00</);
    expect(html).toContain(i18n.t('statistics.forecast_surplus'));
  });

  it.each(LANGS)('shows "collecting data" instead of any figure in the first week (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const html = render(-314.73, true);
    expect(html).toContain(i18n.t('statistics.forecast_calibrating_title'));
    expect(html).toContain(i18n.t('statistics.forecast_calibrating_hint'));
    expect(html).toContain('role="status"');
    expect(html).toContain('forecast-card--calibrating');
    expect(html).not.toContain('314.73');
    expect(html).not.toContain('€7.60');
    expect(html).not.toContain(i18n.t('statistics.forecast_deficit'));
    expect(html).not.toMatch(/statistics\./);
  });

  it('shows the real figure once the week is over', async () => {
    await i18n.changeLanguage('ru');
    const html = render(-314.73, false);
    expect(html).toContain('−€314.73');
    expect(html).not.toContain(i18n.t('statistics.forecast_calibrating_title'));
  });

  it('hides the tier badge until the AI verdict is known', async () => {
    expect(render(10, false, null)).not.toContain('forecast-tier-badge');
  });
});
