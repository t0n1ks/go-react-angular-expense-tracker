import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import CompanionHealthMeter from './CompanionHealthMeter';

// Health is an ARIA meter with the percentage and the mood in words (never
// colour alone), described by the plain-language reason.

const LANGS = ['en', 'de', 'ru', 'uk'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

describe('CompanionHealthMeter', () => {
  it.each(LANGS)('is a labelled meter with % and mood in text (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const html = renderToStaticMarkup(
      <CompanionHealthMeter health={72} mood="content" reason="the reason" onExplain={() => {}} />,
    );
    const mood = i18n.t('companion.mood.content');
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="72"');
    expect(html).toContain(`aria-valuetext="${i18n.t('companion.health_valuetext', { value: 72, mood })}"`);
    expect(html).toContain(`aria-label="${i18n.t('companion.health_label')}"`);
    expect(html).toContain(`>${i18n.t('companion.health_short', { value: 72, mood })}</button>`);
    expect(html).toMatch(/<span id="[^"]+" hidden="">the reason<\/span>/);
    expect(html).toContain('width:72%');
    expect(html).not.toMatch(/companion\./);
  });
});
