import { describe, expect, it } from 'vitest';
import { CENTER_MIN_W, centerLayout, DOME_ABOVE, HEALTH_ROOM, IDLE_Y, LONG_MAX_W, maxSink, placeBubble, RECEDE_SCALE, TAIL_H, TAIL_RIGHT, TAIL_W, tailGap } from './bubbleLayout';
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

  it('centres a tall bubble; the saucer sits under its tail, the dome a small gap below the tip', () => {
    const p = placeBubble({ ...TABLET, bubbleH: 200 });
    if (p.kind !== 'center') throw new Error('expected centre');
    const f = centerLayout({ ...TABLET, bubbleW: p.bubbleMaxW, bubbleH: 120 });
    const right = (TABLET.screenW + p.bubbleMaxW) / 2;
    expect(f.ufoX).toBe(right - TAIL_RIGHT - TAIL_W / 2);           // right under the tail
    const tip = f.bubbleTop + 120 + TAIL_H;
    const domeTop = f.ufoY - TABLET.ufoHalf * 2 * RECEDE_SCALE * DOME_ABOVE;
    expect(domeTop - tip).toBe(tailGap(TABLET.screenH));            // a small gap, not touching
    expect(domeTop - tip).toBeGreaterThanOrEqual(2);
    expect(f.ufoY + TABLET.ufoHalf * RECEDE_SCALE).toBeLessThanOrEqual(TABLET.screenH - 8);
  });

  it("stays centred and narrows (never slides) to keep left of the moon's left edge", () => {
    const moonLeft = 272;                                            // a 344px phone
    const p = placeBubble({ ...PHONE, bubbleH: 100, moonLeft });
    if (p.kind !== 'center') throw new Error('expected centre');
    expect(p.bubbleMaxW).toBeLessThan(LONG_MAX_W);                   // narrowed…
    expect((PHONE.screenW + p.bubbleMaxW) / 2).toBeLessThanOrEqual(moonLeft); // …so the centred box ends at the line
    const f = centerLayout({ ...PHONE, bubbleW: p.bubbleMaxW, bubbleH: 140, moonLeft });
    expect(f.ufoX).toBeLessThanOrEqual(moonLeft);
    const tiny = placeBubble({ ...TABLET, bubbleH: 200, moonLeft: 380 });
    if (tiny.kind !== 'center') throw new Error('expected centre');
    expect(tiny.bubbleMaxW).toBe(CENTER_MIN_W);                      // the floor
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
