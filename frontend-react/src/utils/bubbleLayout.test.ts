import { describe, expect, it } from 'vitest';
import { CENTER_MAX_W, CENTER_MIN_W, centerLayout, DOME_ABOVE, domeGap, HEALTH_ROOM, IDLE_Y, maxSink, placeBubble, RECEDE_SCALE, saucerReach, TAIL_OUT } from './bubbleLayout';
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

  it('centres a compact bubble; its corner triangle points at the dome with a 2–4% gap', () => {
    const p = placeBubble({ ...TABLET, bubbleH: 200 });
    if (p.kind !== 'center') throw new Error('expected centre');
    expect(p.bubbleMaxW).toBe(CENTER_MAX_W);
    const f = centerLayout({ ...TABLET, bubbleW: p.bubbleMaxW, bubbleH: 90 });
    const right = (TABLET.screenW + p.bubbleMaxW) / 2;
    const bottom = f.bubbleTop + 90;
    const tip = { x: right + TAIL_OUT, y: bottom + TAIL_OUT };            // 45° off the corner
    const dome = { x: f.ufoX, y: f.ufoY - TABLET.ufoHalf * 2 * RECEDE_SCALE * DOME_ABOVE };
    const gap = Math.hypot(dome.x - tip.x, dome.y - tip.y);
    expect(gap).toBeCloseTo(domeGap(TABLET.screenH), 5);
    expect(gap / TABLET.screenH).toBeGreaterThanOrEqual(0.02);
    expect(gap / TABLET.screenH).toBeLessThanOrEqual(0.04);
    expect(f.ufoY + TABLET.ufoHalf * RECEDE_SCALE).toBeLessThanOrEqual(TABLET.screenH - 8);
  });

  it("stays centred and narrows (never slides) to keep the saucer left of the moon's left edge", () => {
    const moonLeft = 272;                                            // a 344px phone
    const p = placeBubble({ ...PHONE, bubbleH: 100, moonLeft });
    if (p.kind !== 'center') throw new Error('expected centre');
    expect(p.bubbleMaxW).toBeLessThan(CENTER_MAX_W);                 // narrowed…
    const f = centerLayout({ ...PHONE, bubbleW: p.bubbleMaxW, bubbleH: 90, moonLeft });
    expect(f.ufoX).toBeLessThanOrEqual(moonLeft + 0.5);              // …so the saucer meets the line at most
    expect((PHONE.screenW + p.bubbleMaxW) / 2 + saucerReach(PHONE.screenH)).toBeLessThanOrEqual(moonLeft + 0.5);
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
