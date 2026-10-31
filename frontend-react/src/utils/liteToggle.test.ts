import { describe, it, expect } from 'vitest';
import { liteToggleLocked } from './liteToggle';

describe('Lite switch', () => {
  it('switching Lite off is always allowed, with or without a cycle', () => {
    expect(liteToggleLocked(true, true)).toBe(false);
    expect(liteToggleLocked(false, true)).toBe(false);
  });

  it('switching Lite on waits while a salary cycle is active', () => {
    expect(liteToggleLocked(true, false)).toBe(true);
    expect(liteToggleLocked(false, false)).toBe(false);
  });
});
