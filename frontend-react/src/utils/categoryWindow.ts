// Resolves the date window the "Expenses by category" donut is scoped to.
//
// Previously the donut fell back to ALL-TIME whenever there was no active cycle
// (`if (!cycleStart) return true`), and it trusted the cycle dates blindly — so
// cycle-less users saw an all-time chart and users with a stale / mis-dated
// cycle got a window reaching months into the past. This helper removes the
// all-time fallback and validates the cycle window before using it, falling
// back to the current calendar month (the same default the Python forecaster
// uses: `today.replace(day=1)`) so the donut, budget card and forecast agree.

export interface CategoryWindowInput {
  hasActiveCycle: boolean;
  cycleStartAt?: string | null;
  nextPaydayAt?: string | null;
  /** Injected for deterministic testing; defaults to now at call sites. */
  now: Date;
}

export interface DateWindow {
  start: Date;
  /** null → open-ended up to `now` (used for the current-month default). */
  end: Date | null;
  source: 'cycle' | 'default';
}

// A salary cycle longer than this is implausible (mis-dated / stale data) and is
// rejected in favour of the safe default window. Matches the +180d upper bound
// the end-date editor allows.
export const MAX_CYCLE_SPAN_DAYS = 180;

function currentMonthWindow(now: Date): DateWindow {
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null, source: 'default' };
}

export function resolveCategoryWindow(input: CategoryWindowInput): DateWindow {
  const { hasActiveCycle, cycleStartAt, nextPaydayAt, now } = input;

  if (!hasActiveCycle || !cycleStartAt) return currentMonthWindow(now);

  const start = new Date(cycleStartAt);
  if (isNaN(start.getTime())) return currentMonthWindow(now);
  // A cycle cannot start in the future.
  if (start.getTime() > now.getTime()) return currentMonthWindow(now);

  let end: Date | null = null;
  if (nextPaydayAt) {
    const parsedEnd = new Date(nextPaydayAt);
    if (!isNaN(parsedEnd.getTime())) {
      // Inverted window (end before start) → treat the cycle as needing repair.
      if (parsedEnd.getTime() < start.getTime()) return currentMonthWindow(now);
      end = parsedEnd;
    }
  }

  // Reject an implausibly long span (a stale open-ended or mis-dated cycle whose
  // start is far in the past) rather than scoping to months of data.
  const spanEnd = end ?? now;
  const spanDays = (spanEnd.getTime() - start.getTime()) / 86_400_000;
  if (spanDays > MAX_CYCLE_SPAN_DAYS) return currentMonthWindow(now);

  return { start, end, source: 'cycle' };
}

export function isInWindow(eventDate: Date, w: DateWindow): boolean {
  if (isNaN(eventDate.getTime())) return false;
  if (eventDate.getTime() < w.start.getTime()) return false;
  if (w.end && eventDate.getTime() > w.end.getTime()) return false;
  return true;
}
