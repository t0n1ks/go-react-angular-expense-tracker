// ── Pace-aware weekly guru (frontend mirror of Python app/services/pace_advisor.py) ──
//
// Turns the AUTHORITATIVE weekly-budget numbers (server-computed cycleStats — the
// exact figures the budget bar renders) into a pace verdict for the UFO's
// autonomous fallback. It never re-derives budget math from monthlySpendingGoal /
// 4.3 — that historic shortcut is what made the UFO claim "133% over" while the
// bar showed room to spare.
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
