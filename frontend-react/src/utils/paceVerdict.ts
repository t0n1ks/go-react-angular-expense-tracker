// ── Pace-aware weekly guru (frontend mirror of Python app/services/pace_advisor.py) ──
//
// Turns the AUTHORITATIVE weekly-budget numbers into a pace verdict for the UFO's
// autonomous fallback: server-computed cycleStats for cycle users, the server
// budgetWindow for no-cycle monthly-goal users — in both cases the exact figures
// the budget bar renders. It never re-derives budget math from
// monthlySpendingGoal / 4.3 — that historic shortcut is what made the UFO claim
// "133% over" while the bar showed room to spare.
//
// Hard consistency guarantee: percentOver is > 0 ONLY when spentThisWeek actually
// exceeds weeklyAllowance, and 'pacing_over' is the ONLY tier that carries an
// "over the limit" percentage.

export type PaceTier =
  | 'pacing_fresh'  // week just started — no scary numbers yet
  | 'pacing_over'   // spent > weekly allowance — honest warning
  | 'pacing_warn'   // ahead of an even pace — gentle heads-up
  | 'pacing_great'  // well under with little time left — treat yourself
  | 'pacing_good'   // on/under an even pace — calm, on track
  | null;           // no valid basis — caller keeps its neutral fallback

export interface PaceVerdict {
  tier: PaceTier;
  pctUsed: number;   // spent / allowance, rounded — truthful % of the week used
  percentOver: number; // max(0, pctUsed - 100) — the overage, 0 unless truly over
}

const OVER_PACE_RATIO = 1.2;
const WELL_UNDER_RATIO = 0.5;
const LATE_WEEK_REMAINING = 2;
const TREAT_USED_CEILING = 60;

/**
 * Pure, deterministic pace verdict from authoritative weekly numbers.
 * Kept byte-for-byte in step with the Python advisor so online (Python) and
 * offline (this) paths speak the same tone.
 */
export function evaluatePace(
  weeklyAllowance: number,
  spentThisWeek: number,
  daysElapsedInWeek: number,
  daysRemainingInWeek: number,
): PaceVerdict {
  if (!(weeklyAllowance > 0)) {
    return { tier: null, pctUsed: 0, percentOver: 0 };
  }

  const usedRatio = spentThisWeek / weeklyAllowance;
  const pctUsed = Math.round(usedRatio * 100);
  const percentOver = Math.max(0, pctUsed - 100);

  // Fresh week / nothing spent → neutral. Guards divide-by-zero on expected.
  if (daysElapsedInWeek <= 0 || spentThisWeek <= 0) {
    return { tier: 'pacing_fresh', pctUsed, percentOver };
  }

  // Honest over-budget warning — the ONLY tier that surfaces percentOver.
  if (spentThisWeek > weeklyAllowance) {
    return { tier: 'pacing_over', pctUsed, percentOver };
  }

  const expectedByNow = (weeklyAllowance * daysElapsedInWeek) / 7;
  const paceRatio = expectedByNow > 0 ? spentThisWeek / expectedByNow : 0;

  if (paceRatio >= OVER_PACE_RATIO) {
    return { tier: 'pacing_warn', pctUsed, percentOver };
  }

  // Well under an even pace: encourage a guilt-free treat near the week's end,
  // or when running remarkably lean past midweek.
  const wellUnderLate = daysRemainingInWeek <= LATE_WEEK_REMAINING && pctUsed < TREAT_USED_CEILING;
  const remarkablyLean = paceRatio < WELL_UNDER_RATIO && daysElapsedInWeek >= 3;
  if (paceRatio < 0.8 && (wellUnderLate || remarkablyLean)) {
    return { tier: 'pacing_great', pctUsed, percentOver };
  }

  return { tier: 'pacing_good', pctUsed, percentOver };
}

// ── Window resolution (mirror of Python pace_advisor.resolve_pace) ───────────

/** Server cycle stats — the weekly window for users running a salary cycle. */
export interface CycleStatsWindow {
  current_week_allowance: number;
  current_week_spent: number;
  current_week_index: number;
  days_elapsed: number;
  days_remaining: number;
}

/** Server budget window — the weekly window for no-cycle monthly-goal users. */
export interface BudgetPaceWindow {
  has_goal: boolean;
  current_week_allowance: number;
  current_week_spent: number;
  days_elapsed_in_week: number;
  days_remaining_in_week: number;
}

/** The four authoritative numbers evaluatePace consumes, whatever the source. */
export interface PaceWindow {
  allowance: number;
  spent: number;
  elapsedInWeek: number;
  remainingInWeek: number;
}

/**
 * Pick the ONE authoritative weekly window for this user.
 *
 * Cycle users are served by cycleStats, no-cycle monthly-goal users by
 * budgetWindow — the same switch the budget bar itself makes. Returns null when
 * neither source has a valid allowance, so the caller degrades to
 * percentage-free copy instead of inventing a number.
 */
export function resolvePaceWindow(
  hasCycle: boolean | undefined,
  cycleStats: CycleStatsWindow | null | undefined,
  budgetWindow: BudgetPaceWindow | null | undefined,
): PaceWindow | null {
  if (hasCycle && cycleStats && cycleStats.current_week_allowance > 0) {
    // Day position inside the current cycle-week (7-day chunks from cycle start).
    // Mirrors backend/handlers/ai.go so the online and autonomous paths agree.
    const elapsedInWeek = Math.min(
      Math.max(cycleStats.days_elapsed - cycleStats.current_week_index * 7, 0), 7,
    );
    return {
      allowance: cycleStats.current_week_allowance,
      spent: cycleStats.current_week_spent,
      elapsedInWeek,
      // The cycle can end before the notional 7-day week completes.
      remainingInWeek: Math.max(Math.min(7 - elapsedInWeek, cycleStats.days_remaining), 0),
    };
  }

  if (budgetWindow && budgetWindow.has_goal && budgetWindow.current_week_allowance > 0) {
    // The month window ships its day counts ready-made (Go's computeBudgetWindow
    // derives them from the same Monday anchor as the allowance).
    return {
      allowance: budgetWindow.current_week_allowance,
      spent: budgetWindow.current_week_spent,
      elapsedInWeek: budgetWindow.days_elapsed_in_week,
      remainingInWeek: budgetWindow.days_remaining_in_week,
    };
  }

  return null;
}
