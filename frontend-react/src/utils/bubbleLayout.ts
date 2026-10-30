// Where the companion's speech bubble goes, keeping the saucer steady.
//
// The saucer rests at IDLE_Y of the screen. The decision is by HEIGHT: a
// bubble whose rendered height fits above the resting saucer (or makes it
// sink only a little) sits above, tail down. A taller one takes the centre of
// the screen and the saucer steps back to the bubble's lower-right corner —
// slightly smaller, still opaque, the tail pointing at it — never right of
// the moon's vertical line (the bubble narrows instead). Short lines (exit
// lines, greetings, the moon's status) always stay above. All values are px within
// the screen; the bubble's width and text height are capped in CSS
// (.tama-bubble max-width, .tama-bubble-text max-height) and the text scrolls.

export const IDLE_Y = 0.44;            // the saucer's resting centre (share of screen height)
export const BUBBLE_TOP_MIN = 24;      // the bubble never rises above this
export const BUBBLE_GAP = 8;           // bubble ↔ saucer (above)
export const RECEDE_SCALE = 0.8;       // a receded saucer: a step back, not a fade
export const TAIL_H = 7;               // the bubble's tail
export const CORNER_INSET = 14;        // receded saucer's centre, inside the bubble's right edge
export const LONG_MAX_W = 240;         // long text's widest box (as in CSS .tama-bubble--long)
export const CENTER_MIN_W = 150;       // a centred bubble never narrows below this
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
  /** The moon's centre x: a receded saucer never goes right of it. */
  moonX?: number;
}

export function placeBubble({ screenW, screenH, bubbleH, ufoHalf, aboveOnly = false, moonX }: BubbleLayoutInput): BubblePlacement {
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
  // to the bubble's lower-right corner (see centerLayout). Its width gives way
  // so the saucer never passes the moon's vertical line.
  const moonLimit = moonX === undefined ? Infinity : 2 * (moonX + CORNER_INSET - screenW / 2);
  return {
    kind: 'center',
    bubbleMaxW: Math.round(Math.max(CENTER_MIN_W, Math.min(LONG_MAX_W, screenW * 0.82, moonLimit))),
    bubbleMaxH: Math.round(centerBottomMax(screenH, ufoHalf) - 8),
  };
}

// The receded saucer below the bubble's corner: from the tail's tip down to
// the saucer's centre (its art has headroom), and from there to its foot.
const saucerDrop = (ufoHalf: number) => ufoHalf * RECEDE_SCALE * 0.45;
const saucerFoot = (ufoHalf: number) => ufoHalf * RECEDE_SCALE;

/** The lowest a centred bubble's bottom may sit: tail + receded saucer fit below. */
function centerBottomMax(screenH: number, ufoHalf: number): number {
  return screenH - 8 - saucerFoot(ufoHalf) - saucerDrop(ufoHalf) - TAIL_H;
}

export interface CenterFrame { bubbleTop: number; ufoX: number; ufoY: number; tailRight: number }

/**
 * Where a centred bubble (its rendered size) and the receded saucer go: the
 * bubble + tail + saucer group sits mid-screen, the saucer just inside the
 * bubble's right edge, below its tail — never right of the moon's line.
 */
export function centerLayout(
  { screenW, screenH, bubbleW, bubbleH, ufoHalf, moonX }:
  { screenW: number; screenH: number; bubbleW: number; bubbleH: number; ufoHalf: number; moonX?: number },
): CenterFrame {
  const groupH = bubbleH + TAIL_H + saucerDrop(ufoHalf) + saucerFoot(ufoHalf);
  const bubbleTop = Math.max(8, Math.min((screenH - groupH) / 2, centerBottomMax(screenH, ufoHalf) - bubbleH));
  const bubbleRight = screenW / 2 + bubbleW / 2;
  const ufoX = Math.min(bubbleRight - CORNER_INSET, moonX ?? Infinity);
  return {
    bubbleTop,
    ufoX,
    ufoY: bubbleTop + bubbleH + TAIL_H + saucerDrop(ufoHalf),
    // the tail sits right above the saucer (its 12px base centred on it)
    tailRight: Math.max(8, bubbleRight - ufoX - 6),
  };
}
