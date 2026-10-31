import { describe, it, expect } from 'vitest';
import { isRadioSilence, companionMessageVisible, ambientTypes } from './aiGate';

const ext = (aiAdviceEnabled: boolean, aiHumorEnabled = true) => ({ liteMode: false, aiAdviceEnabled, aiHumorEnabled });
const lite = (aiAdviceEnabled: boolean, aiHumorEnabled = true) => ({ liteMode: true, aiAdviceEnabled, aiHumorEnabled });

describe('radio silence', () => {
  it('humour off silences everything, in both modes, whatever the finance toggle', () => {
    for (const s of [ext(true, false), ext(false, false), lite(true, false)]) {
      expect(isRadioSilence(s)).toBe(true);
      expect(companionMessageVisible('pace_warn', s)).toBe(false);
      expect(companionMessageVisible('quest_ask', s)).toBe(false);
      expect(ambientTypes(s)).toBeNull();
    }
  });
});

describe('extended mode (unchanged behaviour)', () => {
  it('finance on: every companion message and ambient line', () => {
    expect(companionMessageVisible('pace_warn', ext(true))).toBe(true);
    expect(companionMessageVisible('quest_ask', ext(true))).toBe(true);
    expect([...ambientTypes(ext(true))!].sort()).toEqual(['ENCOURAGEMENT', 'GREETING', 'TIP']);
  });
  it('finance off: no spending advice shown', () => {
    expect(companionMessageVisible('pace_warn', ext(false))).toBe(false);
    expect(companionMessageVisible('big_expense', ext(false))).toBe(false);
    expect(ambientTypes(ext(false))).toBeNull();
  });
});

describe('Lite mode', () => {
  it('hides finance advice whatever the (hidden) finance toggle says', () => {
    for (const s of [lite(true), lite(false)]) {
      expect(companionMessageVisible('pace_warn', s)).toBe(false);
      expect(companionMessageVisible('overspent', s)).toBe(false);
      expect(companionMessageVisible('quest_ask', s)).toBe(true);
      expect([...ambientTypes(s)!].sort()).toEqual(['ENCOURAGEMENT', 'GREETING']);
    }
  });
});
