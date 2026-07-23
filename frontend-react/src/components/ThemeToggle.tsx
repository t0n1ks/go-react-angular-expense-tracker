import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import './ThemeToggle.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Knob travel geometry (kept in sync with ThemeToggle.css).
const KNOB_MIN = 3;
const KNOB_MAX = 35;
const KNOB_MID = (KNOB_MIN + KNOB_MAX) / 2;

// ── Custom, simplified SVG icons (legible at ~18–22px; no fine detail) ────────

function SunIcon() {
  const rays = [
    [39, 24, 43, 24], [34.6, 34.6, 37.4, 37.4],
    [24, 39, 24, 43], [13.4, 34.6, 10.6, 37.4],
    [9, 24, 5, 24], [13.4, 13.4, 10.6, 10.6],
    [24, 9, 24, 5], [34.6, 13.4, 37.4, 10.6],
  ];
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id="ts-sun" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#fff7db" />
          <stop offset="55%" stopColor="#ffd24a" />
          <stop offset="100%" stopColor="#f5a623" />
        </radialGradient>
      </defs>
      <g stroke="#f7b733" strokeWidth="2.4" strokeLinecap="round">
        {rays.map((r, i) => <line key={i} x1={r[0]} y1={r[1]} x2={r[2]} y2={r[3]} />)}
      </g>
      <circle cx="24" cy="24" r="13" fill="#ffd24a" opacity="0.28" />
      <circle cx="24" cy="24" r="9.5" fill="url(#ts-sun)" />
    </svg>
  );
}

function BlackHoleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="ts-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd27a" />
          <stop offset="50%" stopColor="#ff7b3a" />
          <stop offset="100%" stopColor="#b46bff" />
        </linearGradient>
      </defs>
      <g transform="rotate(-20 24 24)">
        <ellipse cx="24" cy="24" rx="16" ry="6"
          fill="none" stroke="url(#ts-ring)" strokeWidth="2.6" opacity="0.55" />
        <circle cx="24" cy="24" r="9.5" fill="#05060d" />
        <path d="M8 24 A16 6 0 0 0 40 24"
          fill="none" stroke="url(#ts-ring)" strokeWidth="2.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const trackRef = useRef<HTMLSpanElement>(null);
  // Live knob offset while dragging (px); null when resting (CSS drives position).
  const [dragX, setDragX] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  // Fade the whole scene during the switch: a temporary class enables color/bg
  // transitions app-wide (see .theme-anim in index.css). Reduced motion skips it.
  const switchTo = (dark: boolean) => {
    if (dark === isDark) return;
    if (!prefersReducedMotion()) {
      const root = document.documentElement;
      root.classList.add('theme-anim');
      window.setTimeout(() => root.classList.remove('theme-anim'), 480);
    }
    toggleTheme();
  };

  const knobXFromPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return KNOB_MIN;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left - 13; // 13 = knob radius
    return Math.max(KNOB_MIN, Math.min(KNOB_MAX, x));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (prefersReducedMotion()) return; // no drag when motion is reduced — tap only
    draggingRef.current = true;
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragX(isDark ? KNOB_MAX : KNOB_MIN);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const x = knobXFromPointer(e.clientX);
    if (Math.abs(x - (isDark ? KNOB_MAX : KNOB_MIN)) > 3) movedRef.current = true;
    setDragX(x);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const x = dragX ?? (isDark ? KNOB_MAX : KNOB_MIN);
    setDragX(null); // hand position back to CSS (animates to rest)
    if (movedRef.current) {
      suppressClickRef.current = true; // don't let the trailing click double-fire
      switchTo(x > KNOB_MID); // right half = dark
    }
  };

  const onClick = () => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    switchTo(!isDark); // tap / keyboard (Enter/Space) flips
  };

  const label = isDark ? t('auth.switch_to_light') : t('auth.switch_to_dark');
  const knobStyle = dragX !== null
    ? { transform: `translateX(${dragX}px)`, transition: 'none' as const }
    : undefined;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      className="theme-slider"
      data-dark={isDark}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <span className="ts-track" ref={trackRef}>
        <span className="ts-ic ts-ic-sun"><SunIcon /></span>
        <span className="ts-ic ts-ic-bh"><BlackHoleIcon /></span>
        <span className="ts-knob" style={knobStyle} />
      </span>
    </button>
  );
}
