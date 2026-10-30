// Where the companion's speech bubble goes, keeping the saucer steady.
//
// The saucer rests at IDLE_Y of the screen. The decision is by HEIGHT: a
// bubble whose rendered height fits above the resting saucer (or makes it
// sink only a little) sits above, tail down. A taller one takes the centre of
// the screen (always centred) and the saucer steps back below its lower-right
// corner — slightly smaller, still opaque, the bubble's tail pointing at its
// dome. The bubble never passes the moon's left edge (it narrows instead, and
// its text autoscrolls). Short lines (exit lines, greetings, the moon's
// status) stay above. All values are px within
// the screen; the bubble's width and text height are capped in CSS
// (.tama-bubble max-width, .tama-bubble-text max-height) and the text scrolls.

export const IDLE_Y = 0.44;            // the saucer's resting centre (share of screen height)
export const BUBBLE_TOP_MIN = 24;      // the bubble never rises above this
export const BUBBLE_GAP = 8;           // bubble ↔ saucer (above)
export const RECEDE_SCALE = 0.8;       // a receded saucer: a step back, not a fade
export const TAIL_H = 7;               // the bubble's triangle tail (CSS .tama-bubble::after)
export const TAIL_W = 12;
export const TAIL_RIGHT = 12;          // the tail's offset from a centred bubble's right edge
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
  // Focus: the bubble stays centred on the screen; the saucer steps back
  // below its lower-right corner (see centerLayout). If the centred bubble's
  // right edge would pass the moon's left edge, the bubble narrows (its text
  // grows taller and autoscrolls) — it never slides off centre.
  const moonLimit = moonLeft === undefined ? Infinity : 2 * (moonLeft - screenW / 2);
  return {
    kind: 'center',
    bubbleMaxW: Math.round(Math.max(CENTER_MIN_W, Math.min(LONG_MAX_W, screenW * 0.82, moonLimit))),
    bubbleMaxH: Math.round(centerBottomMax(screenH, ufoHalf) - 8),
  };
}

/** The receded saucer's box (its art is square). */
const recededBox = (ufoHalf: number) => ufoHalf * 2 * RECEDE_SCALE;

/** The small gap between the tail's tip and the dome: ~1.5% of the screen. */
export function tailGap(screenH: number): number {
  return Math.min(5, Math.max(2, Math.round(screenH * 0.015)));
}

/** The lowest a centred bubble's bottom may sit: tail + gap + receded saucer fit below. */
function centerBottomMax(screenH: number, ufoHalf: number): number {
  const box = recededBox(ufoHalf);
  return screenH - 8 - box * SAUCER_FOOT - box * DOME_ABOVE - tailGap(screenH) - TAIL_H;
}

export interface CenterFrame { bubbleTop: number; ufoX: number; ufoY: number }

/**
 * Where a centred bubble (its rendered size) and the receded saucer go: the
 * group sits mid-screen; the saucer's centre is right under the bubble's
 * tail (TAIL_RIGHT from its right edge), its dome a small gap below the
 * tail's tip, and never right of the moon's left edge.
 */
export function centerLayout(
  { screenW, screenH, bubbleW, bubbleH, ufoHalf, moonLeft }:
  { screenW: number; screenH: number; bubbleW: number; bubbleH: number; ufoHalf: number; moonLeft?: number },
): CenterFrame {
  const box = recededBox(ufoHalf);
  const groupH = bubbleH + TAIL_H + tailGap(screenH) + box * (DOME_ABOVE + SAUCER_FOOT);
  const bubbleTop = Math.max(8, Math.min((screenH - groupH) / 2, centerBottomMax(screenH, ufoHalf) - bubbleH));
  const right = (screenW + bubbleW) / 2;
  return {
    bubbleTop,
    ufoX: Math.min(right - TAIL_RIGHT - TAIL_W / 2, moonLeft ?? Infinity),
    ufoY: bubbleTop + bubbleH + TAIL_H + tailGap(screenH) + box * DOME_ABOVE,
  };
}
