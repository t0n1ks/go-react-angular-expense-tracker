import { describe, it, expect } from 'vitest';
import { evaluatePace } from './paceVerdict';

describe('evaluatePace', () => {
  it('returns no verdict when there is no allowance', () => {
    const v = evaluatePace(0, 20, 3, 4);
    expect(v.tier).toBeNull();
  });

  it('is neutral on a fresh week (zero elapsed) with no scary percentage', () => {
    const v = evaluatePace(76.78, 0, 0, 7);
    expect(v.tier).toBe('pacing_fresh');
    expect(v.percentOver).toBe(0);
  });

  it('REGRESSION: under budget never reads as over', () => {
    // The exact screenshot scenario: allowance €76.78, spent €36.58, midweek.
    const v = evaluatePace(76.78, 36.58, 3, 4);
    expect(v.tier).not.toBe('pacing_over');
    expect(v.percentOver).toBe(0);
    expect(v.pctUsed).toBe(48); // 47.6% → 48
  });

  it('invites a treat late in the week when well under', () => {
    const v = evaluatePace(100, 10, 5, 2);
    expect(v.tier).toBe('pacing_great');
    expect(v.percentOver).toBe(0);
  });

  it('is great when remarkably lean past midweek', () => {
    expect(evaluatePace(100, 15, 4, 3).tier).toBe('pacing_great');
  });

  it('is good on an even pace', () => {
    expect(evaluatePace(100, 50, 4, 3).tier).toBe('pacing_good');
  });

  it('gently warns when ahead of pace but still under budget (no over %)', () => {
    const v = evaluatePace(100, 45, 2, 5);
    expect(v.tier).toBe('pacing_warn');
    expect(v.percentOver).toBe(0);
  });

  it('is an honest over-budget warning with the TRUE overage', () => {
    const v = evaluatePace(100, 133, 4, 3);
    expect(v.tier).toBe('pacing_over');
    expect(v.pctUsed).toBe(133);
    expect(v.percentOver).toBe(33);
  });

  it('never emits a positive percentOver while at or under the allowance', () => {
    for (const spent of [0, 10, 50, 99.9, 100]) {
      expect(evaluatePace(100, spent, 4, 3).percentOver).toBe(0);
    }
    expect(evaluatePace(100, 120, 4, 3).percentOver).toBe(20);
  });
});
