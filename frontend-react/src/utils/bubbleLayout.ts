// Where the companion's speech bubble goes, keeping the saucer steady.
//
// The saucer rests at IDLE_Y of the screen. The decision is by HEIGHT: a
// bubble whose rendered height fits above the resting saucer (or makes it
// sink only a little) sits above, tail down. A taller one takes the centre of
// the screen and the saucer recedes into the background (aside, smaller,
// dimmer, behind the bubble) until it closes. Short lines (exit lines,
// greetings, the moon's status) always stay above. All values are px within
// the screen; the bubble's width and text height are capped in CSS
// (.tama-bubble max-width, .tama-bubble-text max-height) and the text scrolls.

export const IDLE_Y = 0.44;            // the saucer's resting centre (share of screen height)
export const BUBBLE_TOP_MIN = 24;      // the bubble never rises above this
export const BUBBLE_GAP = 8;           // bubble ↔ saucer (above)
export const SIDE_MARGIN = 14;         // a receded saucer ↔ screen edge
export const RECEDE_X = 0.16;          // where the saucer recedes to (share of width / height)
export const RECEDE_Y = 0.3;
export const RECEDE_SCALE = 0.62;      // …how much smaller it gets
export const RECEDE_OPACITY = 0.55;    // …and how dim
export const HEALTH_ROOM = 30;         // the health bar under everything

/** The largest sink allowed before switching to the side layout. */
export function maxSink(screenH: number): number {
  return Math.max(12, Math.round(screenH * 0.08));
}

export type BubblePlacement =
  | { kind: 'above'; ufoX: number; ufoY: number; bubbleTop: number; bubbleMaxH?: number }
  | { kind: 'center'; ufoX: number; ufoY: number; bubbleMaxH: number };

export interface BubbleLayoutInput {
  screenW: number;
  screenH: number;
  /** The bubble's height laid out ABOVE (capped width) — measured once per text. */
  bubbleH: number;
  ufoHalf: number;
  /** Short lines that always sit above (exit line, greeting, moon status). */
  aboveOnly?: boolean;
}

export function placeBubble({ screenW, screenH, bubbleH, ufoHalf, aboveOnly = false }: BubbleLayoutInput): BubblePlacement {
  const idleY = screenH * IDLE_Y;
  const freeTop = idleY - ufoHalf - BUBBLE_GAP - bubbleH; // bubble top if the saucer stays put
  const sink = Math.max(0, BUBBLE_TOP_MIN - freeTop);
  const lowest = screenH - ufoHalf - HEALTH_ROOM;         // the saucer never sits on the health bar
  if (sink <= maxSink(screenH) && idleY + sink <= lowest) {
    return { kind: 'above', ufoX: screenW / 2, ufoY: idleY + sink, bubbleTop: Math.max(BUBBLE_TOP_MIN, freeTop) };
  }
  if (aboveOnly) {
    // Still above: sink just as far as the line needs (short lines are only
    // 1–2 rows), never onto the health bar; anything still left over scrolls.
    const ufoY = Math.min(idleY + sink, lowest);
    return { kind: 'above', ufoX: screenW / 2, ufoY, bubbleTop: BUBBLE_TOP_MIN, bubbleMaxH: ufoY - ufoHalf - BUBBLE_GAP - BUBBLE_TOP_MIN };
  }
  // Focus: the bubble takes the centre of the screen and the saucer recedes —
  // aside to the upper left, smaller and dimmer, behind the bubble — until it
  // closes. Its height is the room above the health bar.
  return {
    kind: 'center',
    ufoX: Math.max(screenW * RECEDE_X, ufoHalf * RECEDE_SCALE + SIDE_MARGIN),
    ufoY: screenH * RECEDE_Y,
    bubbleMaxH: screenH - 2 * 8 - HEALTH_ROOM,
  };
}

/** A centred bubble's top: midway in the room above the health bar. */
export function centerBubbleTop(bubbleH: number, screenH: number): number {
  return Math.max(8, (screenH - HEALTH_ROOM - bubbleH) / 2);
}
