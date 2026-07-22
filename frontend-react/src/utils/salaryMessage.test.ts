import { describe, it, expect } from 'vitest';
import { isCycleFresh, salaryMarkerKey, FRESH_CYCLE_DAYS } from './salaryMessage';

// Regression for the UFO "funds received / new cycle started" greeting that
// was firing mid-cycle. The greeting must only be eligible right at a cycle's
// start; the per-cycle marker key then makes it once-only.
describe('isCycleFresh (UFO salary-message trigger)', () => {
  const start = '2026-07-18T09:00:00';

  it('is fresh exactly at the cycle start', () => {
    expect(isCycleFresh(start, new Date('2026-07-18T09:00:00'))).toBe(true);
  });

  it('is fresh within the freshness window', () => {
    expect(isCycleFresh(start, new Date('2026-07-20T09:00:00'))).toBe(true); // 2 days in
  });

  it('is fresh right up to the window edge', () => {
    const edge = new Date(new Date(start).getTime() + FRESH_CYCLE_DAYS * 24 * 60 * 60 * 1000);
    expect(isCycleFresh(start, edge)).toBe(true);
  });

  it('is NOT fresh mid-cycle (the reported bug: 7 days in, payday still ahead)', () => {
    expect(isCycleFresh(start, new Date('2026-07-25T09:00:00'))).toBe(false);
  });

  it('is NOT fresh just past the window', () => {
    const past = new Date(new Date(start).getTime() + (FRESH_CYCLE_DAYS * 24 + 1) * 60 * 60 * 1000);
    expect(isCycleFresh(start, past)).toBe(false);
  });

  it('is NOT fresh for a future start (clock skew)', () => {
    expect(isCycleFresh('2026-07-20T09:00:00', new Date('2026-07-18T09:00:00'))).toBe(false);
  });

  it('is NOT fresh for missing or invalid input', () => {
    expect(isCycleFresh(null, new Date(start))).toBe(false);
    expect(isCycleFresh(undefined, new Date(start))).toBe(false);
    expect(isCycleFresh('not-a-date', new Date(start))).toBe(false);
  });
});

describe('salaryMarkerKey', () => {
  it('is per-user and per-cycle so a new cycle can greet again', () => {
    expect(salaryMarkerKey(42, 7)).toBe('salary_msg_shown_42_7');
    expect(salaryMarkerKey(42, 8)).not.toBe(salaryMarkerKey(42, 7)); // next cycle → new key
    expect(salaryMarkerKey(1, 7)).not.toBe(salaryMarkerKey(2, 7));   // different user → new key
  });

  it('falls back to anon when userId is absent', () => {
    expect(salaryMarkerKey(undefined, 7)).toBe('salary_msg_shown_anon_7');
  });
});
