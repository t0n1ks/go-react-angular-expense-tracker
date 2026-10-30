import { describe, expect, it } from 'vitest';
import { BUBBLE_EDGE, CENTER_MIN_W, centerLayout, HEALTH_ROOM, IDLE_Y, LONG_MAX_W, maxSink, placeBubble, RECEDE_SCALE } from './bubbleLayout';
import { readingMs } from '../hooks/useAutoScroll';

const PHONE = { screenW: 332, screenH: 200, ufoHalf: 22 };
const TABLET = { screenW: 700, screenH: 300, ufoHalf: 28 };

describe('speech bubble placement', () => {
  it('keeps the saucer where it rests when the bubble fits above', () => {
    const p = placeBubble({ ...TABLET, bubbleH: 60 });
    expect(p.kind).toBe('above');
    if (p.kind !== 'above') return;
    expect(p.ufoY).toBe(TABLET.screenH * IDLE_Y);
    expect(p.ufoX).toBe(TABLET.screenW / 2);
  });

  it('lets the saucer sink only a little before taking centre stage', () => {
    const idle = TABLET.screenH * IDLE_Y;
    const room = idle - TABLET.ufoHalf - 8 - 24;
    const small = placeBubble({ ...TABLET, bubbleH: room + maxSink(TABLET.screenH) });
    expect(small.kind).toBe('above');
    if (small.kind !== 'above') return;
    expect(small.ufoY - idle).toBeLessThanOrEqual(maxSink(TABLET.screenH));
    expect(placeBubble({ ...TABLET, bubbleH: room + maxSink(TABLET.screenH) + 1 }).kind).toBe('center');
  });

  it('centres a tall bubble; the saucer steps back below its lower-right corner, the tail onto its dome', () => {
    const moonLeft = 272;
    const p = placeBubble({ ...PHONE, bubbleH: 90, moonLeft });
    expect(p.kind).toBe('center');
    if (p.kind !== 'center') return;
    const f = centerLayout({ ...PHONE, bubbleW: p.bubbleMaxW, bubbleH: 90, moonLeft });
    const right = f.bubbleLeft + p.bubbleMaxW;
    expect(f.ufoY).toBeGreaterThan(f.bubbleTop + 90);
    expect(f.ufoY + PHONE.ufoHalf * RECEDE_SCALE).toBeLessThanOrEqual(PHONE.screenH - 8);
    // tail: from the corner (bottom and right edges) down to the dome, under the saucer's centre
    expect(f.tail.x2).toBe(right);
    expect(f.tail.y1).toBe(f.bubbleTop + 90);
    expect(f.tail.ty).toBeGreaterThan(f.tail.y1);
    expect(f.tail.ty).toBeLessThan(f.ufoY);
    expect(Math.abs(f.tail.tx - f.ufoX)).toBeLessThan(PHONE.ufoHalf * RECEDE_SCALE);
  });

  it("keeps the bubble left of the moon's left edge and the saucer at most half across it", () => {
    const moonLeft = 272;
    const f = centerLayout({ ...PHONE, bubbleW: 240, bubbleH: 100, moonLeft });
    expect(f.bubbleLeft + 240).toBeLessThanOrEqual(moonLeft);     // slid left instead of narrowing
    expect(f.bubbleLeft).toBeGreaterThanOrEqual(BUBBLE_EDGE);
    expect(f.ufoX).toBeLessThanOrEqual(moonLeft);                 // centre on the line at most → ≤ half crosses
    const p = placeBubble({ ...PHONE, bubbleH: 100, moonLeft });
    if (p.kind !== 'center') throw new Error('expected centre');
    expect(p.bubbleMaxW).toBe(LONG_MAX_W);                        // 240 still fits on a phone
  });

  it('narrows the bubble only when sliding left is not enough', () => {
    const tight = placeBubble({ ...TABLET, bubbleH: 200, moonLeft: 200 });
    if (tight.kind !== 'center') throw new Error('expected centre');
    expect(tight.bubbleMaxW).toBe(200 - BUBBLE_EDGE);
    const tiny = placeBubble({ ...TABLET, bubbleH: 200, moonLeft: 100 });
    if (tiny.kind !== 'center') throw new Error('expected centre');
    expect(tiny.bubbleMaxW).toBe(CENTER_MIN_W);
  });

  it('decides by height only: a wide but short bubble stays above', () => {
    expect(placeBubble({ ...TABLET, screenW: 1400, bubbleH: 30 }).kind).toBe('above');
    expect(placeBubble({ ...PHONE, bubbleH: 30 }).kind).toBe('above');
  });

  it('keeps exit lines and greetings above, scrolling whatever does not fit', () => {
    const p = placeBubble({ ...PHONE, bubbleH: 120, aboveOnly: true });
    expect(p.kind).toBe('above');
    if (p.kind !== 'above') return;
    expect(p.ufoX).toBe(PHONE.screenW / 2);
    expect(p.ufoY + PHONE.ufoHalf + HEALTH_ROOM).toBeLessThanOrEqual(PHONE.screenH);
    expect(p.bubbleMaxH).toBeGreaterThan(0);
    expect(p.bubbleTop + (p.bubbleMaxH ?? 0)).toBeLessThanOrEqual(p.ufoY - PHONE.ufoHalf);
  });

  it('keeps the centred group on screen even for the tallest bubble', () => {
    const f = centerLayout({ ...PHONE, bubbleW: 200, bubbleH: 400, moonLeft: 272 });
    expect(f.bubbleTop).toBe(8);
  });
});

describe('autoscroll reading time', () => {
  it('gives longer text more time, within calm bounds', () => {
    expect(readingMs('Hi')).toBe(2500);
    expect(readingMs('word '.repeat(20))).toBe(5600);
    expect(readingMs('word '.repeat(100))).toBe(9000);
  });
});
