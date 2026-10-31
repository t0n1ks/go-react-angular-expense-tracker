import { describe, it, expect } from 'vitest';
import en from '../i18n/locales/en.json';
import de from '../i18n/locales/de.json';
import ru from '../i18n/locales/ru.json';
import uk from '../i18n/locales/uk.json';
import { LITE_TIME_CHANCE, LITE_TIME_KEYS, pickLiteTimeLine } from './liteCalendar';

const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('Lite calendar whimsy', () => {
  it('never in extended mode or under radio silence', () => {
    for (const s of [{ liteMode: false, radioSilence: false }, { liteMode: true, radioSilence: true }, { liteMode: false, radioSilence: true }]) {
      expect(pickLiteTimeLine({ ...s, last: null, rand: () => 0 })).toBeNull();
    }
  });
  it('only now and then in Lite', () => {
    expect(pickLiteTimeLine({ liteMode: true, radioSilence: false, last: null, rand: () => LITE_TIME_CHANCE })).toBeNull();
    expect(pickLiteTimeLine({ liteMode: true, radioSilence: false, last: null, rand: seq(0, 0) })).toBe(0);
  });
  it('never the same line twice in a row', () => {
    for (let last = 0; last < LITE_TIME_KEYS.length; last++) {
      for (const r of [0, 0.3, 0.6, 0.99]) {
        const idx = pickLiteTimeLine({ liteMode: true, radioSilence: false, last, rand: seq(0, r) });
        expect(idx).not.toBeNull();
        expect(idx).not.toBe(last);
      }
    }
  });
  it('every line exists in all four languages', () => {
    for (const loc of [en, de, ru, uk]) {
      const companion = loc.companion as Record<string, unknown>;
      for (const key of LITE_TIME_KEYS) {
        const text = companion[key.split('.')[1]] as string;
        expect(typeof text).toBe('string');
        expect(text.length).toBeGreaterThan(0);
      }
      expect(companion.glitch_back).toBeTruthy();
    }
  });
});
