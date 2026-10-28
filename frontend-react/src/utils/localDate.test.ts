import { describe, it, expect } from 'vitest';
import { toLocalDateStr } from './localDate';

describe('toLocalDateStr', () => {
  it('formats the local calendar day, zero-padded', () => {
    expect(toLocalDateStr(new Date(2026, 9, 28, 0, 30))).toBe('2026-10-28');
    expect(toLocalDateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
