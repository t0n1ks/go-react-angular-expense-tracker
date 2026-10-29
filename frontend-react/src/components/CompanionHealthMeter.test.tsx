import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import CompanionHealthMeter from './CompanionHealthMeter';

// Health: the % is written inside the bar, the bar's colour follows the mood,
// and the mood word is only in the accessible text — never visible, never the
// only signal. The whole bar is a button that explains the reason.

const LANGS = ['en', 'de', 'ru', 'uk'] as const;
const MOODS = ['thriving', 'content', 'worried', 'stressed', 'exhausted'] as const;

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

const render = (health: number, mood: (typeof MOODS)[number]) =>
  renderToStaticMarkup(<CompanionHealthMeter health={health} mood={mood} reason="the reason" onExplain={() => {}} />);

/** Text a sighted user sees: tags and attributes stripped. */
const visibleText = (html: string) => html.replace(/<span id="[^"]+" hidden="">[^<]*<\/span>/, '').replace(/<[^>]+>/g, '');

describe('CompanionHealthMeter', () => {
  it.each(LANGS)('shows only the % inside the bar; the mood is in the accessible text (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const html = render(72, 'content');
    const mood = i18n.t('companion.mood.content');
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="72"');
    expect(html).toContain(`aria-valuetext="${i18n.t('companion.health_valuetext', { value: 72, mood })}"`);
    expect(html).toContain(`aria-label="${i18n.t('companion.health_explain', { value: 72, mood })}"`);
    expect(html).toMatch(/tama-health-value" aria-hidden="true">72%</);
    expect(visibleText(html)).toBe('72%');
    expect(visibleText(html)).not.toContain(mood);
    expect(html).toMatch(/<span id="[^"]+" hidden="">the reason<\/span>/);
    expect(html).not.toMatch(/companion\./);
  });

  it('colours the bar by mood and fills it to the value', () => {
    for (const mood of MOODS) expect(render(50, mood)).toContain(`tama-health-track--${mood}`);
    expect(render(25, 'exhausted')).toContain('width:25%');
  });
});
