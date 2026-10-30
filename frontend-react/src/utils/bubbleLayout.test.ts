import { describe, expect, it } from 'vitest';
import { CENTER_MIN_W, centerLayout, CORNER_INSET, HEALTH_ROOM, IDLE_Y, LONG_MAX_W, maxSink, placeBubble, RECEDE_SCALE } from './bubbleLayout';
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

  it('centres a tall bubble; the saucer steps back to its lower-right corner, below the tail', () => {
    const p = placeBubble({ ...PHONE, bubbleH: 90, moonX: 284 });
    expect(p.kind).toBe('center');
    if (p.kind !== 'center') return;
    const f = centerLayout({ ...PHONE, bubbleW: p.bubbleMaxW, bubbleH: 90, moonX: 284 });
    const bubbleRight = PHONE.screenW / 2 + p.bubbleMaxW / 2;
    expect(f.ufoX).toBe(bubbleRight - CORNER_INSET);
    expect(f.ufoY).toBeGreaterThan(f.bubbleTop + 90);
    expect(f.ufoY + PHONE.ufoHalf * RECEDE_SCALE).toBeLessThanOrEqual(PHONE.screenH - 8);
    expect(f.tailRight).toBeGreaterThanOrEqual(8);
  });

  it("never lets the saucer pass the moon's vertical line: the bubble narrows instead", () => {
    const wide = placeBubble({ ...TABLET, bubbleH: 200 });
    const bounded = placeBubble({ ...TABLET, bubbleH: 200, moonX: 420 });
    if (wide.kind !== 'center' || bounded.kind !== 'center') throw new Error('expected centre');
    expect(wide.bubbleMaxW).toBe(LONG_MAX_W);
    expect(bounded.bubbleMaxW).toBeLessThan(LONG_MAX_W);
    const f = centerLayout({ ...TABLET, bubbleW: bounded.bubbleMaxW, bubbleH: 120, moonX: 420 });
    expect(f.ufoX).toBeLessThanOrEqual(420);
    const tight = placeBubble({ ...TABLET, bubbleH: 200, moonX: 360 });
    if (tight.kind !== 'center') throw new Error('expected centre');
    expect(tight.bubbleMaxW).toBe(CENTER_MIN_W);
    expect(centerLayout({ ...TABLET, bubbleW: CENTER_MIN_W, bubbleH: 120, moonX: 360 }).ufoX).toBeLessThanOrEqual(360);
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
    const f = centerLayout({ ...PHONE, bubbleW: 200, bubbleH: 400, moonX: 284 });
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
