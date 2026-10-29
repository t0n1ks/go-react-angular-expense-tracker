import { describe, it, expect, beforeAll, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';

// Server-rendered structural checks for "Вернуть в бюджет": it must render
// for a deposit in every language with a real label/aria-label (no raw keys),
// and without a current cycle it must stay VISIBLE — disabled, with the
// reason — instead of disappearing (the 2.18.4 regression).

const settings = {
  hasActiveCycle: true,
  cycleWindow: { start: '2026-10-28T22:59:00Z', end: null as string | null },
};
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ axiosInstance: { post: vi.fn() } }) }));
vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({
    formatAmount: (n: number) => `€${n.toFixed(2)}`,
    hasActiveCycle: settings.hasActiveCycle,
    cycleWindow: settings.cycleWindow,
    refreshCycle: vi.fn(),
  }),
}));

const { default: ReturnToBudget } = await import('./ReturnToBudget');

const LANGS = ['en', 'de', 'ru', 'uk'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

const thisCycle = { date: '2026-10-29', created_at: '2026-10-29T03:05:00Z', effective_at: '2026-10-29T03:05:00Z' };
const pastCycle = { date: '2026-10-04', created_at: '2026-10-04T10:00:00Z', effective_at: '2026-10-04T10:00:00Z' };

const render = (depositTime = thisCycle) =>
  renderToStaticMarkup(
    <ReturnToBudget depositId={577} depositAmount={11} depositTime={depositTime} inputId="r577" onDone={() => {}} />,
  );

describe('ReturnToBudget', () => {
  it.each(LANGS)('renders the amount field and the button with real text (%s)', async (lng) => {
    settings.hasActiveCycle = true;
    await i18n.changeLanguage(lng);
    const html = render();
    expect(html).toContain('id="r577"');
    expect(html).toContain('for="r577"');
    expect(html).toContain('value="11"'); // defaults to the whole deposit
    expect(html).toContain(i18n.t('transactions.return_to_budget_btn'));
    expect(html).toContain(`aria-label="${i18n.t('transactions.return_to_budget_aria', { amount: '€11.00' })}"`);
    expect(html).not.toMatch(/transactions\.return_to_budget|dashboard\.savings_return/);
  });

  it('says a deposit from a past cycle returns as a today-dated transfer', async () => {
    settings.hasActiveCycle = true;
    await i18n.changeLanguage('ru');
    expect(render(pastCycle)).toContain(i18n.t('transactions.return_to_budget_closed_hint'));
    expect(render(thisCycle)).toContain(i18n.t('transactions.return_to_budget_hint'));
  });

  it('stays visible but disabled, explaining why, without a current cycle', async () => {
    settings.hasActiveCycle = false;
    await i18n.changeLanguage('ru');
    const html = render();
    expect(html).toContain(i18n.t('transactions.return_to_budget_btn'));
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain(i18n.t('dashboard.savings_return_no_cycle'));
  });
});
