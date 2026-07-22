// Gating for the UFO's "new cycle started / funds received" greeting.
//
// The message must appear ONCE, only at the real start of a cycle, and never
// again on reloads/reopens within the same cycle — and never mid-cycle. The
// "freshness" gate below is the pure, testable core of that rule; the persisted
// per-cycle marker (see salaryMarkerKey) provides the once-only guarantee.

export const FRESH_CYCLE_DAYS = 3;

/**
 * True only when `now` falls within the first `freshDays` after the cycle's
 * start. A future start (clock skew) or a cycle older than the window is not
 * fresh — so a mid-cycle reload (e.g. 7 days in) never re-triggers the greeting.
 */
export function isCycleFresh(
  cycleStartAt: string | null | undefined,
  now: Date,
  freshDays: number = FRESH_CYCLE_DAYS,
): boolean {
  if (!cycleStartAt) return false;
  const startMs = new Date(cycleStartAt).getTime();
  if (!Number.isFinite(startMs)) return false;
  const ageMs = now.getTime() - startMs;
  return ageMs >= 0 && ageMs <= freshDays * 24 * 60 * 60 * 1000;
}

/** Per-cycle localStorage key marking that the greeting was already shown. */
export function salaryMarkerKey(userId: number | undefined, cycleId: number): string {
  return `salary_msg_shown_${userId ?? 'anon'}_${cycleId}`;
}
