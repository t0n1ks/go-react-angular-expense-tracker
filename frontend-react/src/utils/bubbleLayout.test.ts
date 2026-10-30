import { describe, expect, it } from 'vitest';
import { centerBubbleTop, HEALTH_ROOM, IDLE_Y, maxSink, placeBubble, RECEDE_SCALE } from './bubbleLayout';
import { readingMs } from '../hooks/useAutoScroll';

const PHONE = { screenW: 332, screenH: 200, ufoHalf: 22 };
const TABLET = { screenW: 700, screenH: 300, ufoHalf: 28 };

describe('speech bubble placement', () => {
  it('keeps the saucer where it rests when the bubble fits above', () => {
    const p = placeBubble({ ...TABLET, bubbleH: 60 });
    expect(p.kind).toBe('above');
    expect(p.ufoY).toBe(TABLET.screenH * IDLE_Y);
    expect(p.ufoX).toBe(TABLET.screenW / 2);
  });

  it('lets the saucer sink only a little before taking centre stage', () => {
    const idle = TABLET.screenH * IDLE_Y;
    const room = idle - TABLET.ufoHalf - 8 - 24;
    const small = placeBubble({ ...TABLET, bubbleH: room + maxSink(TABLET.screenH) });
    expect(small.kind).toBe('above');
    expect(small.ufoY - idle).toBeLessThanOrEqual(maxSink(TABLET.screenH));
    expect(placeBubble({ ...TABLET, bubbleH: room + maxSink(TABLET.screenH) + 1 }).kind).toBe('center');
  });

  it('centres a tall bubble and sends the saucer back, aside and up, fully on screen', () => {
    const p = placeBubble({ ...PHONE, bubbleH: 90 });
    expect(p.kind).toBe('center');
    if (p.kind !== 'center') return;
    expect(p.ufoX).toBeLessThan(PHONE.screenW / 2);
    expect(p.ufoX - PHONE.ufoHalf * RECEDE_SCALE).toBeGreaterThanOrEqual(14);
    expect(p.ufoY).toBeLessThan(PHONE.screenH * IDLE_Y);
    expect(p.bubbleMaxH).toBe(PHONE.screenH - 16 - HEALTH_ROOM);
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

  it('centres the focus bubble in the room above the health bar', () => {
    expect(centerBubbleTop(70, 200)).toBe(50);
    expect(centerBubbleTop(190, 200)).toBe(8);
  });
});

describe('autoscroll reading time', () => {
  it('gives longer text more time, within calm bounds', () => {
    expect(readingMs('Hi')).toBe(2500);
    expect(readingMs('word '.repeat(20))).toBe(5600);
    expect(readingMs('word '.repeat(100))).toBe(9000);
  });
});
