// Lite calendar whimsy. Lite has no cycle week to count, so a calendar tap
// now and then adds one gentle "time doesn't matter here" line to whatever the
// calendar already says. Companion content: it rides the calendar's own bubble
// (no new channel, no quota) and never shows under radio silence.

export const LITE_TIME_KEYS = [
  'companion.lite_time_1',
  'companion.lite_time_2',
  'companion.lite_time_3',
  'companion.lite_time_4',
] as const;

/** How often a Lite calendar tap gets a line. */
export const LITE_TIME_CHANCE = 0.4;

interface PickOptions {
  liteMode: boolean;
  radioSilence: boolean;
  /** The line shown last time — never repeated twice in a row. */
  last: number | null;
  rand?: () => number;
}

/** Index into LITE_TIME_KEYS to add to this calendar tap, or null for none. */
export function pickLiteTimeLine({ liteMode, radioSilence, last, rand = Math.random }: PickOptions): number | null {
  if (!liteMode || radioSilence) return null;
  if (rand() >= LITE_TIME_CHANCE) return null;
  const choices = LITE_TIME_KEYS.map((_, i) => i).filter(i => i !== last);
  return choices[Math.floor(rand() * choices.length) % choices.length];
}
