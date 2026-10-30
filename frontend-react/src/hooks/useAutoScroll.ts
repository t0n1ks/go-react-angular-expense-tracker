import { useEffect, useRef, type RefObject } from 'react';

// Gentle autoscroll for a speech bubble's text: after a short pause it glides
// to the end at a calm reading pace, then reports that the whole text has
// been shown — the widget waits for that before an exit flight or an
// auto-dismiss. Any touch, wheel or press hands control to the user (the
// text is theirs to scroll; reaching the end still counts). Under reduced
// motion nothing moves: "shown" comes after an estimated reading time, or
// when the user scrolls to the end.

/** Pause before scrolling starts — time to read the first lines. */
export const AUTOSCROLL_START_MS = 1800;
/** Reading pace: ~0.7 rows a second at the bubble's 1.4 line height. */
export const AUTOSCROLL_PX_PER_S = 12;

/** A calm reading time for text the user reads (or scrolls) on their own. */
export function readingMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(9000, Math.max(2500, words * 280));
}

/**
 * @param key   a new key restarts the scroll (the text shown); null = idle
 * @param onDone called once per key: scrolled = the text needed scrolling
 */
export function useAutoScroll(
  ref: RefObject<HTMLElement | null>,
  key: string | null,
  reduceMotion: boolean,
  onDone?: (key: string, scrolled: boolean) => void,
): void {
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    const el = ref.current;
    if (key === null || !el) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    let userScrolls = false;
    let pos = 0;
    let last = 0;

    const atEnd = () => el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const finish = (scrolled: boolean) => {
      if (finished) return;
      finished = true;
      doneRef.current?.(key, scrolled);
    };
    const step = (now: number) => {
      pos += ((now - last) / 1000) * AUTOSCROLL_PX_PER_S;
      last = now;
      el.scrollTop = pos;
      if (atEnd()) { finish(true); return; }
      raf = requestAnimationFrame(step);
    };
    const start = () => {
      // Only text that really overflows gets a scrollbar (CSS keys off this)
      // and the autoscroll; a sub-pixel spill does not count.
      const overflows = el.scrollHeight - el.clientHeight > 3;
      el.dataset.overflow = String(overflows);
      if (!overflows) { finish(false); return; }
      if (reduceMotion) { timer = setTimeout(() => finish(true), readingMs(el.textContent ?? '')); return; }
      timer = setTimeout(() => {
        pos = el.scrollTop;
        last = performance.now();
        raf = requestAnimationFrame(step);
      }, AUTOSCROLL_START_MS);
    };
    const takeOver = () => {
      if (userScrolls || finished) return;
      userScrolls = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      // If they stop before the end, still let things move on in time.
      timer = setTimeout(() => finish(true), readingMs(el.textContent ?? ''));
    };
    const onScroll = () => { if (userScrolls && atEnd()) finish(true); };

    el.scrollTop = 0;
    el.dataset.overflow = 'false';
    el.addEventListener('pointerdown', takeOver);
    el.addEventListener('wheel', takeOver, { passive: true });
    el.addEventListener('touchstart', takeOver, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    // Wait one frame so the bubble's size caps are laid out.
    raf = requestAnimationFrame(start);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      el.removeEventListener('pointerdown', takeOver);
      el.removeEventListener('wheel', takeOver);
      el.removeEventListener('touchstart', takeOver);
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref, key, reduceMotion]);
}
