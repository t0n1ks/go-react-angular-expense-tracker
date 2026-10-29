import { describe, it, expect, beforeAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import type { MoneyPoint } from '../utils/balanceTimeline';

// Server-rendered structure of the balance chart (layout itself needs a real
// browser): the two readouts (selected day left, today right) sit OUTSIDE the
// plot, the slider is a labelled range over the visible days with the
// selected day as its spoken value, and both control bars use the same bar
// component — all with real text in four languages.

vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ formatAmount: (n: number) => `€${n.toFixed(2)}`, currencySymbol: '€' }),
}));
vi.mock('../context/ThemeContext', () => ({ useTheme: () => ({ isDark: false }) }));

const { default: BalanceChart } = await import('./BalanceChart');

const LANGS = ['en', 'de', 'ru', 'uk'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

// Recent days so the default 90-day range shows them all.
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const series: MoneyPoint[] = [
  { date: day(2), spendable: 404, savings: 100, total: 504 },
  { date: day(1), spendable: 380.11, savings: 11, total: 391.11 },
  { date: day(0), spendable: 383.89, savings: 11, total: 394.89 },
];

const render = () => renderToStaticMarkup(<BalanceChart moneySeries={series} transactions={[]} />);

describe('BalanceChart', () => {
  it.each(LANGS)('shows the selected day and today as fixed readouts (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const html = render();
    const readouts = html.indexOf('balance-readouts');
    const plot = html.indexOf('balance-chart-plot');
    expect(readouts).toBeGreaterThan(-1);
    expect(readouts).toBeLessThan(plot); // above the plot, never over the line
    // Default: the latest day (Total view) on the left, today's Total on the right.
    expect(html).toMatch(/balance-hud-value[^>]*>€394\.89</);
    expect(html).toMatch(/balance-now-value[^>]*>€394\.89</);
    expect(html).toContain(i18n.t('statistics.balance_now', { view: i18n.t('statistics.balance_view_total') }));
    expect(html).not.toMatch(/statistics\.balance_/);
  });

  it('has a labelled day slider spanning the visible days, at the latest day', async () => {
    await i18n.changeLanguage('ru');
    const html = render();
    const slider = html.match(/<input[^>]*type="range"[^>]*>/)?.[0] ?? '';
    expect(slider).toContain('min="0"');
    expect(slider).toContain('max="2"');
    expect(slider).toContain('value="2"');
    expect(slider).toContain(`aria-label="${i18n.t('statistics.balance_scrub_label')}"`);
    expect(slider).toMatch(/aria-valuetext="[^"]*€394\.89"/);
  });

  it('renders both control bars with the same bar component', async () => {
    await i18n.changeLanguage('de');
    const html = render();
    expect(html.match(/class="balance-bar balance-bar--4"/g)).toHaveLength(1);
    expect(html.match(/class="balance-bar balance-bar--3"/g)).toHaveLength(1);
    expect(html.match(/class="balance-seg( balance-seg--active)?"/g)).toHaveLength(7);
  });
});
