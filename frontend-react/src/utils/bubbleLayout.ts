// Where the companion's speech bubble goes, keeping the saucer steady.
//
// The saucer rests at IDLE_Y of the screen. The decision is by HEIGHT: a
// bubble whose rendered height fits above the resting saucer (or makes it
// sink only a little) sits above, tail down. A taller one goes BESIDE it: the
// saucer steps a little right, the bubble sits to its left with its tail
// pointing right, and the saucer keeps its height. Short lines (exit lines,
// greetings, the moon's status) always stay above. All values are px within
// the screen; the bubble's width and text height are capped in CSS
// (.tama-bubble max-width, .tama-bubble-text max-height) and the text scrolls.

export const IDLE_Y = 0.44;            // the saucer's resting centre (share of screen height)
export const BUBBLE_TOP_MIN = 24;      // the bubble never rises above this
export const BUBBLE_GAP = 8;           // bubble ↔ saucer (above)
export const SIDE_GAP = 12;            // bubble ↔ saucer (beside), before the tail
export const SIDE_MAX_W = 260;         // a side bubble's widest
export const SIDE_MARGIN = 14;         // side layout ↔ screen edges
export const HEALTH_ROOM = 30;         // the health bar under everything

/** The largest sink allowed before switching to the side layout. */
export function maxSink(screenH: number): number {
  return Math.max(12, Math.round(screenH * 0.08));
}

export type BubblePlacement =
  | { kind: 'above'; ufoX: number; ufoY: number; bubbleTop: number; bubbleMaxH?: number }
  | { kind: 'side'; ufoX: number; ufoY: number; bubbleRight: number; bubbleMaxW: number; bubbleMaxH: number };

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
    // Still above: sink as little as needed — at most twice the usual
    // allowance, never onto the health bar; whatever doesn't fit scrolls.
    const ufoY = Math.min(idleY + Math.min(sink, 2 * maxSink(screenH)), lowest);
    return { kind: 'above', ufoX: screenW / 2, ufoY, bubbleTop: BUBBLE_TOP_MIN, bubbleMaxH: ufoY - ufoHalf - BUBBLE_GAP - BUBBLE_TOP_MIN };
  }
  // Beside: centre the bubble + saucer pair, the saucer on the right and
  // never closer than SIDE_MARGIN to the right edge.
  const bubbleMaxW = Math.min(SIDE_MAX_W, Math.round(screenW * 0.6));
  const pairW = bubbleMaxW + SIDE_GAP + ufoHalf * 2;
  const ufoX = screenW - Math.max(ufoHalf + SIDE_MARGIN, (screenW - pairW) / 2 + ufoHalf);
  const bubbleRight = ufoX - ufoHalf - SIDE_GAP;
  return {
    kind: 'side',
    ufoX,
    ufoY: idleY,
    bubbleRight,
    bubbleMaxW: Math.min(bubbleMaxW, bubbleRight - SIDE_MARGIN),
    bubbleMaxH: screenH - 2 * 8 - HEALTH_ROOM,
  };
}

/** A side bubble's top: centred on the saucer, kept inside the screen and above the health bar. */
export function sideBubbleTop(ufoY: number, bubbleH: number, screenH: number): number {
  return Math.max(8, Math.min(ufoY - bubbleH / 2, screenH - HEALTH_ROOM - 4 - bubbleH));
}
