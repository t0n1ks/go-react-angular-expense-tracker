import { describe, it, expect } from 'vitest';
import { litePercent, liteTier, liteRemaining, liteOverspent } from './liteBudget';

describe('liteTier', () => {
  it.each([
    [0, 'green'], [35, 'green'],
    [35.5, 'yellow'], [36, 'yellow'], [80, 'yellow'],
    [81, 'orange'], [90, 'orange'],
    [91, 'red'], [100, 'red'], [140, 'red'],
  ])('%d%% → %s', (pct, tier) => {
    expect(liteTier(pct)).toBe(tier);
  });
});

describe('Lite budget figures', () => {
  it('percent of the limit, 0 without a limit', () => {
    expect(litePercent(50, 200)).toBe(25);
    expect(litePercent(50, 0)).toBe(0);
  });
  it('remaining never goes below zero', () => {
    expect(liteRemaining(120, 200)).toBe(80);
    expect(liteRemaining(250, 200)).toBe(0);
  });
  it('overspent from 100% of the limit', () => {
    expect(liteOverspent(199.99, 200)).toBe(false);
    expect(liteOverspent(200, 200)).toBe(true);
    expect(liteOverspent(10, 0)).toBe(false);
  });
});
