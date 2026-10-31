// Lite budget card status (Lite mode only). Pure, so it is unit-tested.

export type LiteTier = 'green' | 'yellow' | 'orange' | 'red';

/** Share of the limit spent, in % (0 when there is no limit). */
export function litePercent(spent: number, limit: number): number {
  return limit > 0 ? (Math.max(0, spent) / limit) * 100 : 0;
}

/**
 * Colour band by % of the limit spent: 0–35 green, 36–80 yellow, 81–90
 * orange, 91+ red (fractional % between bands goes to the next band up).
 */
export function liteTier(percent: number): LiteTier {
  if (percent <= 35) return 'green';
  if (percent <= 80) return 'yellow';
  if (percent <= 90) return 'orange';
  return 'red';
}

/** What's left of the limit this month, never below zero. */
export function liteRemaining(spent: number, limit: number): number {
  return Math.max(0, limit - Math.max(0, spent));
}

/** Overspent: spent reached the limit (≥ 100%) → the red down-arrow. */
export function liteOverspent(spent: number, limit: number): boolean {
  return limit > 0 && spent >= limit;
}
