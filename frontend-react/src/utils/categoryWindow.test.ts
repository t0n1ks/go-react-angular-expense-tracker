import { describe, it, expect } from 'vitest';
import { resolveCategoryWindow, isInWindow, MAX_CYCLE_SPAN_DAYS } from './categoryWindow';

const now = new Date('2026-07-18T12:00:00');

describe('resolveCategoryWindow (Bug B regression)', () => {
  it('no active cycle → current month, NOT all-time', () => {
    const w = resolveCategoryWindow({ hasActiveCycle: false, now });
    expect(w.source).toBe('default');
    expect(w.start.getFullYear()).toBe(2026);
    expect(w.start.getMonth()).toBe(6); // July (0-indexed)
    expect(w.start.getDate()).toBe(1);
    // An old expense from months ago must fall OUTSIDE the default window.
    expect(isInWindow(new Date('2026-01-05T10:00:00'), w)).toBe(false);
    // A recent expense this month falls inside.
    expect(isInWindow(new Date('2026-07-10T10:00:00'), w)).toBe(true);
  });

  it('valid current cycle → uses the cycle window', () => {
    const w = resolveCategoryWindow({
      hasActiveCycle: true,
      cycleStartAt: '2026-07-01T12:00:00',
      nextPaydayAt: '2026-07-31T00:00:00Z',
      now,
    });
    expect(w.source).toBe('cycle');
    expect(isInWindow(new Date('2026-06-30T10:00:00'), w)).toBe(false); // before start
    expect(isInWindow(new Date('2026-07-05T10:00:00'), w)).toBe(true);
  });

  it('mis-dated cycle whose start is far in the past → default, not months of data', () => {
    const w = resolveCategoryWindow({
      hasActiveCycle: true,
      cycleStartAt: '2026-01-01T12:00:00', // ~198 days before now
      nextPaydayAt: null, // open-ended, so span = now - start > MAX
      now,
    });
    expect(w.source).toBe('default');
  });

  it('inverted window (end before start) → default', () => {
    const w = resolveCategoryWindow({
      hasActiveCycle: true,
      cycleStartAt: '2026-07-10T12:00:00',
      nextPaydayAt: '2026-07-05T00:00:00',
      now,
    });
    expect(w.source).toBe('default');
  });

  it('future start date → default', () => {
    const w = resolveCategoryWindow({
      hasActiveCycle: true,
      cycleStartAt: '2026-08-01T12:00:00',
      nextPaydayAt: '2026-08-31T00:00:00',
      now,
    });
    expect(w.source).toBe('default');
  });

  it('span exactly at the limit is accepted; beyond it is rejected', () => {
    const start = new Date(now.getTime() - MAX_CYCLE_SPAN_DAYS * 86_400_000 + 86_400_000);
    const ok = resolveCategoryWindow({ hasActiveCycle: true, cycleStartAt: start.toISOString(), now });
    expect(ok.source).toBe('cycle');

    const tooOld = new Date(now.getTime() - (MAX_CYCLE_SPAN_DAYS + 5) * 86_400_000);
    const bad = resolveCategoryWindow({ hasActiveCycle: true, cycleStartAt: tooOld.toISOString(), now });
    expect(bad.source).toBe('default');
  });
});
