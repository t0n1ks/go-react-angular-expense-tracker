import { describe, expect, it } from 'vitest';
import { HEALTH_ROOM, IDLE_Y, maxSink, placeBubble, sideBubbleTop } from './bubbleLayout';

const PHONE = { screenW: 332, screenH: 200, ufoHalf: 22 };
const TABLET = { screenW: 700, screenH: 300, ufoHalf: 28 };

describe('speech bubble placement', () => {
  it('keeps the saucer where it rests when the bubble fits above', () => {
    const p = placeBubble({ ...TABLET, bubbleH: 60 });
    expect(p.kind).toBe('above');
    expect(p.ufoY).toBe(TABLET.screenH * IDLE_Y);
    expect(p.ufoX).toBe(TABLET.screenW / 2);
  });

  it('lets the saucer sink only a little before going beside', () => {
    const idle = TABLET.screenH * IDLE_Y;
    const room = idle - TABLET.ufoHalf - 8 - 24;
    const small = placeBubble({ ...TABLET, bubbleH: room + maxSink(TABLET.screenH) });
    expect(small.kind).toBe('above');
    expect(small.ufoY - idle).toBeLessThanOrEqual(maxSink(TABLET.screenH));
    expect(placeBubble({ ...TABLET, bubbleH: room + maxSink(TABLET.screenH) + 1 }).kind).toBe('side');
  });

  it('puts a message with votes beside the saucer on a phone, saucer at its height', () => {
    const p = placeBubble({ ...PHONE, bubbleH: 70 });
    expect(p.kind).toBe('side');
    if (p.kind !== 'side') return;
    expect(p.ufoY).toBe(PHONE.screenH * IDLE_Y);
    expect(p.ufoX).toBeLessThan(PHONE.screenW / 2);
    expect(p.ufoX - PHONE.ufoHalf).toBeGreaterThanOrEqual(14);
    expect(p.bubbleLeft).toBeGreaterThan(p.ufoX + PHONE.ufoHalf);
    expect(p.bubbleLeft + p.bubbleMaxW).toBeLessThanOrEqual(PHONE.screenW - 14);
  });

  it('keeps a side bubble inside the screen and clear of the health bar', () => {
    const ufoY = 88;
    expect(sideBubbleTop(ufoY, 40, 200)).toBe(68);
    expect(sideBubbleTop(ufoY, 190, 200)).toBe(8);
    const tall = 150;
    expect(sideBubbleTop(ufoY, tall, 200) + tall).toBeLessThanOrEqual(200 - HEALTH_ROOM);
  });
});
