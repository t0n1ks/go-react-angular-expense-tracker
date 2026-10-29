import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import BalanceViewTabs from './BalanceViewTabs';

// Structural a11y checks for the Общий / Бюджет / Копилка switcher: a real
// tablist with one tab stop, the active tab marked, each tab controlling the
// chart panel, and real labels (no raw keys) in all four languages.

const LANGS = ['en', 'de', 'ru', 'uk'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

const render = () =>
  renderToStaticMarkup(<BalanceViewTabs value="budget" onChange={() => {}} panelId="panel" />);

describe('BalanceViewTabs', () => {
  it.each(LANGS)('is an accessible tablist with real labels (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain(`aria-label="${i18n.t('statistics.balance_views_label')}"`);
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-controls="panel"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1); // one tab stop
    expect(html).toMatch(/id="balance-tab-budget"[^>]*aria-selected="true"/);
    for (const v of ['total', 'budget', 'savings']) {
      expect(html).toContain(i18n.t(`statistics.balance_view_${v}`));
    }
    expect(html).not.toMatch(/statistics\.balance_view/);
  });
});
