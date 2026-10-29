import { describe, it, expect, beforeAll } from 'vitest';
import i18n from 'i18next';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import {
  COMPANION_MESSAGE_TYPES,
  COMPANION_REASON_TYPES,
  healthChangeText,
  messageKey,
  messageText,
  reasonText,
  signedAmount,
  weekdayName,
  type CompanionMessage,
} from './companion';

const LANGS = ['en', 'de', 'ru', 'uk'] as const;
const fmt = (n: number) => `€${n.toFixed(2)}`;

beforeAll(async () => {
  await i18n.init({
    resources: { en: { translation: en }, de: { translation: de }, ru: { translation: ru }, uk: { translation: uk } },
    lng: 'en',
    fallbackLng: false,
    interpolation: { escapeValue: false },
  });
});

// Every number any message may carry (as the server sends them).
const ALL_SLOTS = {
  over: 12, remaining: 212, days_left: 14, daily: 15.14, amount: 80, ratio: 3, category: 'Groceries',
  saved_total: 340, spent_pct: 62, elapsed_pct: 40, week: 2, spent: 238, forecast_end: -40.5, weekday: 5,
  day: 12, days_total: 30, days: 9,
};

const msg = (type: string, slots: Record<string, number | string> = ALL_SLOTS): CompanionMessage =>
  ({ id: `${type}-1`, type, priority: 1, tone: 'supportive', slots });

// Shaming words must never appear (research: shame makes people avoid the app).
const SHAME: Record<(typeof LANGS)[number], RegExp> = {
  en: /\b(fail|failed|bad|shame|terrible|guilty|wasted|irresponsible)\b/i,
  de: /(versagt|schlecht|schäm|schrecklich|schuld|verschwendet)/i,
  ru: /(провал|плохо|стыд|ужасн|винова|растратил|безответствен)/i,
  uk: /(провал|погано|сором|жахлив|винн|розтратив|безвідповідальн)/i,
};

describe('companion texts', () => {
  it.each(LANGS)('every message type and reason has a full text (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    for (const type of COMPANION_MESSAGE_TYPES) {
      const text = messageText(msg(type), i18n.t, fmt, lng);
      expect(text, type).not.toMatch(/companion\.|\{\{/);
      expect(text.length, type).toBeGreaterThan(10);
    }
    for (const type of ['week_checkin_forecast', 'big_expense_short']) {
      expect(i18n.exists(`companion.msg.${type}`), type).toBe(true);
    }
    for (const type of COMPANION_REASON_TYPES) {
      const text = reasonText({ type, slots: ALL_SLOTS }, i18n.t, fmt, lng);
      expect(text, type).not.toMatch(/companion\.|\{\{/);
    }
    for (const mood of ['thriving', 'content', 'worried', 'stressed', 'exhausted']) {
      expect(i18n.exists(`companion.mood.${mood}`), mood).toBe(true);
    }
  });

  it.each(LANGS)('never shames (%s)', async (lng) => {
    await i18n.changeLanguage(lng);
    const all = [
      ...COMPANION_MESSAGE_TYPES.map((type) => messageText(msg(type), i18n.t, fmt, lng)),
      i18n.t('companion.msg.week_checkin_forecast', ALL_SLOTS),
      i18n.t('companion.msg.big_expense_short', ALL_SLOTS),
      ...COMPANION_REASON_TYPES.map((type) => reasonText({ type, slots: ALL_SLOTS }, i18n.t, fmt, lng)),
    ];
    for (const text of all) expect(text).not.toMatch(SHAME[lng]);
  });

  it('fact + option: an overspend message names the gap and the way back', async () => {
    await i18n.changeLanguage('ru');
    const text = messageText(msg('overspent'), i18n.t, fmt, 'ru');
    expect(text).toContain('€12.00');
    expect(text).toContain('14');
  });

  it('prefers the AI service variant when it sent one', () => {
    expect(messageText({ ...msg('income'), text: 'From Stage D' }, i18n.t, fmt, 'en')).toBe('From Stage D');
  });

  it('cites the forecast only when the server sent it (never in week 1)', () => {
    expect(messageKey(msg('week_checkin', { week: 2, remaining: 1, days_left: 1, daily: 1, spent: 1 })))
      .toBe('companion.msg.week_checkin');
    expect(messageKey(msg('week_checkin'))).toBe('companion.msg.week_checkin_forecast');
  });

  it('signs money with a true minus and names weekdays locally', () => {
    expect(signedAmount(-40.5, fmt)).toBe('−€40.50');
    expect(signedAmount(3, fmt)).toBe('€3.00');
    expect(weekdayName(5, 'en-GB')).toBe('Friday');
    expect(weekdayName(0, 'en-GB')).toBe('Sunday');
  });

  it('explains a drop with the delta and the reason', async () => {
    await i18n.changeLanguage('en');
    expect(healthChangeText(72, 85, 'why', i18n.t)).toBe('Health 72% (−13%): why');
    expect(healthChangeText(90, 85, 'why', i18n.t)).toBe('Health 90%: why');
  });
});
