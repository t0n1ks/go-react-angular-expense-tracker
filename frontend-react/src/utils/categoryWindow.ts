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
  /** Server-reported cycle window (GET /salary-cycle/current window_start). */
  cycleStartAt?: string | null;
  /** Server-reported EXCLUSIVE window end (window_end); null = open — the
   *  cycle is current until the next one starts, even after its payday. */
  windowEndAt?: string | null;
  /** Injected for deterministic testing; defaults to now at call sites. */
  now: Date;
}

export interface DateWindow {
  start: Date;
  /** Exclusive end; null → open-ended (current-month default, or a cycle that
   *  has not been handed over yet). */
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
  const { hasActiveCycle, cycleStartAt, windowEndAt, now } = input;

  if (!hasActiveCycle || !cycleStartAt) return currentMonthWindow(now);

  const start = new Date(cycleStartAt);
  if (isNaN(start.getTime())) return currentMonthWindow(now);
  // A cycle cannot start in the future.
  if (start.getTime() > now.getTime()) return currentMonthWindow(now);

  let end: Date | null = null;
  if (windowEndAt) {
    const parsedEnd = new Date(windowEndAt);
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
  if (w.end && eventDate.getTime() >= w.end.getTime()) return false; // [start, end)
  return true;
}

export interface TimedTransaction {
  date: string;
  created_at?: string;
  /** Server-computed instant the transaction counts at for cycle windows. */
  effective_at?: string;
}

/**
 * The instant a transaction counts at for cycle/budget windows. The server's
 * effective_at is authoritative (entry time when entered on its own date,
 * else the start of its date in the user's timezone); the fallbacks only cover
 * a response from an older backend.
 */
export function txEventTime(tx: TimedTransaction): Date {
  return new Date(tx.effective_at ?? tx.created_at ?? tx.date);
}

/**
 * Whether a transaction counts in the current cycle's server window
 * ([window_start, window_end)). False without a current cycle.
 */
export function inCurrentCycle(
  tx: TimedTransaction,
  cycleWindow: { start: string; end: string | null } | null | undefined,
): boolean {
  if (!cycleWindow) return false;
  return isInWindow(txEventTime(tx), {
    start: new Date(cycleWindow.start),
    end: cycleWindow.end ? new Date(cycleWindow.end) : null,
    source: 'cycle',
  });
}
