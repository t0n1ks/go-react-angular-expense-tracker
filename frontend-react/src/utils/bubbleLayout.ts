// Where the companion's speech bubble goes, keeping the saucer steady.
//
// The saucer rests at IDLE_Y of the screen. A bubble that fits above it (or
// needs the saucer to sink only a little) sits above, its tail pointing down.
// One that would shove the saucer around goes BESIDE it instead: the saucer
// steps left, the bubble sits to its right with its tail pointing left, and
// the saucer keeps its height. All values are px within the screen.

export const IDLE_Y = 0.44;            // the saucer's resting centre (share of screen height)
export const BUBBLE_TOP_MIN = 24;      // the bubble never rises above this
export const BUBBLE_GAP = 8;           // bubble ↔ saucer (above)
export const SIDE_GAP = 12;            // saucer ↔ bubble (beside), before the tail
export const SIDE_MAX_W = 340;         // a side bubble's widest
export const SIDE_MARGIN = 14;         // side layout ↔ screen edges
export const HEALTH_ROOM = 30;         // the health bar under everything

/** The largest sink allowed before switching to the side layout. */
export function maxSink(screenH: number): number {
  return Math.max(12, Math.round(screenH * 0.08));
}

export type BubblePlacement =
  | { kind: 'above'; ufoX: number; ufoY: number; bubbleTop: number }
  | { kind: 'side'; ufoX: number; ufoY: number; bubbleLeft: number; bubbleMaxW: number; bubbleMaxH: number };

export interface BubbleLayoutInput {
  screenW: number;
  screenH: number;
  /** The bubble's height laid out ABOVE (its natural width) — measured once per text. */
  bubbleH: number;
  ufoHalf: number;
}

export function placeBubble({ screenW, screenH, bubbleH, ufoHalf }: BubbleLayoutInput): BubblePlacement {
  const idleY = screenH * IDLE_Y;
  const freeTop = idleY - ufoHalf - BUBBLE_GAP - bubbleH; // bubble top if the saucer stays put
  const sink = Math.max(0, BUBBLE_TOP_MIN - freeTop);
  const ufoY = idleY + sink;
  if (sink <= maxSink(screenH) && ufoY + ufoHalf + HEALTH_ROOM <= screenH) {
    return { kind: 'above', ufoX: screenW / 2, ufoY, bubbleTop: Math.max(BUBBLE_TOP_MIN, freeTop) };
  }
  // Beside: centre the saucer + bubble pair, the saucer never closer than
  // SIDE_MARGIN to the left edge.
  const bubbleMaxW = Math.min(SIDE_MAX_W, Math.round(screenW * 0.62));
  const pairW = ufoHalf * 2 + SIDE_GAP + bubbleMaxW;
  const ufoX = Math.max(ufoHalf + SIDE_MARGIN, (screenW - pairW) / 2 + ufoHalf);
  const bubbleLeft = ufoX + ufoHalf + SIDE_GAP;
  return {
    kind: 'side',
    ufoX,
    ufoY: idleY,
    bubbleLeft,
    bubbleMaxW: Math.min(bubbleMaxW, screenW - bubbleLeft - SIDE_MARGIN),
    bubbleMaxH: screenH - 2 * 8 - HEALTH_ROOM,
  };
}

/** A side bubble's top: centred on the saucer, kept inside the screen and above the health bar. */
export function sideBubbleTop(ufoY: number, bubbleH: number, screenH: number): number {
  return Math.max(8, Math.min(ufoY - bubbleH / 2, screenH - HEALTH_ROOM - 4 - bubbleH));
}
