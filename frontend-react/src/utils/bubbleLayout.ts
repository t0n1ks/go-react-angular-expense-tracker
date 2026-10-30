// Where the companion's speech bubble goes, keeping the saucer steady.
//
// The saucer rests at IDLE_Y of the screen. The decision is by HEIGHT: a
// bubble whose rendered height fits above the resting saucer (or makes it
// sink only a little) sits above, tail down. A taller one takes the centre of
// the screen and the saucer steps back below the bubble's lower-right corner —
// slightly smaller, still opaque, the tail running onto its dome. The bubble
// never passes the moon's left edge; the saucer may cross it by half its
// width. Short lines (exit lines, greetings, the moon's status) stay above. All values are px within
// the screen; the bubble's width and text height are capped in CSS
// (.tama-bubble max-width, .tama-bubble-text max-height) and the text scrolls.

export const IDLE_Y = 0.44;            // the saucer's resting centre (share of screen height)
export const BUBBLE_TOP_MIN = 24;      // the bubble never rises above this
export const BUBBLE_GAP = 8;           // bubble ↔ saucer (above)
export const RECEDE_SCALE = 0.8;       // a receded saucer: a step back, not a fade
export const TAIL_DROP = 9;            // bubble's bottom → the top of the saucer's dome
export const BUBBLE_EDGE = 8;          // a centred bubble ↔ screen edge
export const LONG_MAX_W = 240;         // long text's widest box (as in CSS .tama-bubble--long)
export const CENTER_MIN_W = 150;       // a centred bubble never narrows below this
// The saucer art (ufo-3d.json, cropped by UFO_VIEWBOX): its canopy's top sits
// ~0.16 of the box above the centre, its lowest edge ~0.3 below.
export const DOME_ABOVE = 0.16;
export const SAUCER_FOOT = 0.3;
export const HEALTH_ROOM = 30;         // the health bar under everything

/** The largest sink allowed before switching to the side layout. */
export function maxSink(screenH: number): number {
  return Math.max(12, Math.round(screenH * 0.08));
}

export type BubblePlacement =
  | { kind: 'above'; ufoX: number; ufoY: number; bubbleTop: number; bubbleMaxH?: number }
  | { kind: 'center'; bubbleMaxW: number; bubbleMaxH: number };

export interface BubbleLayoutInput {
  screenW: number;
  screenH: number;
  /** The bubble's height laid out ABOVE (capped width) — measured once per text. */
  bubbleH: number;
  ufoHalf: number;
  /** Short lines that always sit above (exit line, greeting, moon status). */
  aboveOnly?: boolean;
  /** The moon's left edge: a centred bubble never passes it (the saucer by at most half). */
  moonLeft?: number;
}

export function placeBubble({ screenW, screenH, bubbleH, ufoHalf, aboveOnly = false, moonLeft }: BubbleLayoutInput): BubblePlacement {
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
  // Focus: the bubble takes the centre of the screen; the saucer steps back
  // below its lower-right corner (see centerLayout). The bubble stays left of
  // the moon's left edge — first by sliding left, then by narrowing.
  const limitRight = moonLeft ?? screenW - BUBBLE_EDGE;
  return {
    kind: 'center',
    bubbleMaxW: Math.round(Math.max(CENTER_MIN_W, Math.min(LONG_MAX_W, screenW * 0.82, limitRight - BUBBLE_EDGE))),
    bubbleMaxH: Math.round(centerBottomMax(screenH, ufoHalf) - 8),
  };
}

/** The receded saucer's box (its art is square). */
const recededBox = (ufoHalf: number) => ufoHalf * 2 * RECEDE_SCALE;

/** The lowest a centred bubble's bottom may sit: tail + receded saucer fit below. */
function centerBottomMax(screenH: number, ufoHalf: number): number {
  const box = recededBox(ufoHalf);
  return screenH - 8 - box * SAUCER_FOOT - box * DOME_ABOVE - TAIL_DROP;
}

export interface CenterFrame {
  bubbleLeft: number;
  bubbleTop: number;
  ufoX: number;
  ufoY: number;
  /** The tail: from two points on the bubble's rounded lower-right corner to a tip on the dome. */
  tail: { x1: number; y1: number; x2: number; y2: number; tx: number; ty: number };
}

/**
 * Where a centred bubble (its rendered size), its tail and the receded saucer
 * go. The group sits mid-screen; the bubble's right edge never passes the
 * moon's left edge (it slides left first); the saucer sits just right of and
 * below the bubble's corner, its centre at most ON that line — so at most half
 * of it crosses — and the tail runs from the corner onto its dome.
 */
export function centerLayout(
  { screenW, screenH, bubbleW, bubbleH, ufoHalf, moonLeft }:
  { screenW: number; screenH: number; bubbleW: number; bubbleH: number; ufoHalf: number; moonLeft?: number },
): CenterFrame {
  const box = recededBox(ufoHalf);
  const limitRight = moonLeft ?? screenW - BUBBLE_EDGE;
  const bubbleLeft = Math.max(BUBBLE_EDGE, Math.min((screenW - bubbleW) / 2, limitRight - bubbleW));
  const right = bubbleLeft + bubbleW;
  const groupH = bubbleH + TAIL_DROP + box * (DOME_ABOVE + SAUCER_FOOT);
  const bubbleTop = Math.max(8, Math.min((screenH - groupH) / 2, centerBottomMax(screenH, ufoHalf) - bubbleH));
  const bottom = bubbleTop + bubbleH;
  const ufoX = Math.min(right + box * 0.18, limitRight);
  const ufoY = bottom + TAIL_DROP + box * DOME_ABOVE;
  return {
    bubbleLeft,
    bubbleTop,
    ufoX,
    ufoY,
    tail: {
      x1: right - 22, y1: bottom,          // on the bottom edge, before the corner's curve
      x2: right, y2: bottom - 14,          // on the right edge, above it
      tx: ufoX - box * 0.04,               // the tip tucks just under the canopy's top
      ty: ufoY - box * DOME_ABOVE + 3,
    },
  };
}
