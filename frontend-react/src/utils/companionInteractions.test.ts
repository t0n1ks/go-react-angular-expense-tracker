import { describe, it, expect, beforeAll } from 'vitest';
import i18n from 'i18next';
import en from '../i18n/locales/en.json';
import ru from '../i18n/locales/ru.json';
import { countsForQuest, messageActionEffect, pickExitLine, type CompanionInteraction } from './companion';
import { ufoPlayerOptions, UFO_VIEWBOX } from './companionUfo';

beforeAll(async () => {
  await i18n.init({ resources: { en: { translation: en }, ru: { translation: ru } }, lng: 'ru', fallbackLng: 'en' });
});

describe('message actions', () => {
  it('👍 and 👎 vote; ✕ never does and makes the UFO fly on', () => {
    expect(messageActionEffect('like')).toEqual({ vote: 'liked', flyOff: false });
    expect(messageActionEffect('dislike')).toEqual({ vote: 'disliked', flyOff: false });
    expect(messageActionEffect('close')).toEqual({ vote: null, flyOff: true });
  });

  it('repeated ✕ never produces a vote', () => {
    const votes = Array.from({ length: 10 }, () => messageActionEffect('close').vote).filter(Boolean);
    expect(votes).toEqual([]);
  });
});

describe('health-neutral interactions', () => {
  it('only the star and the cow count for the quest', () => {
    const all: CompanionInteraction[] = ['star', 'cow', 'journal_yes', 'journal_no', 'message_close', 'message_vote'];
    expect(all.filter(countsForQuest)).toEqual(['star', 'cow']);
  });
});

describe('exit line (placeholder until Stage D)', () => {
  it('picks a line from the localized pool', () => {
    const pool = i18n.t('ai.exit_phrases', { returnObjects: true }) as string[];
    expect(pickExitLine(i18n.t, () => 0)).toBe(pool[0]);
    expect(pickExitLine(i18n.t, () => 0.999)).toBe(pool[pool.length - 1]);
  });
});

describe('Lottie UFO', () => {
  it('loops normally and is a still frame under reduced motion', () => {
    expect(ufoPlayerOptions(false)).toEqual({ loop: true, autoplay: true, stillFrame: null });
    expect(ufoPlayerOptions(true)).toEqual({ loop: false, autoplay: false, stillFrame: 0 });
  });

  it('crops the canvas to a square around the saucer and its beam', () => {
    const [x, y, w, h] = UFO_VIEWBOX.split(' ').map(Number);
    expect(w).toBe(h);
    expect(x).toBeLessThanOrEqual(130);
    expect(y).toBeLessThanOrEqual(248);
    expect(x + w).toBeGreaterThanOrEqual(670);
    expect(y + h).toBeGreaterThanOrEqual(777);
  });
});
