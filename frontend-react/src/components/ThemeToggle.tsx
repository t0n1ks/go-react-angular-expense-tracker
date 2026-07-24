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

// Thin, single-colour line-art icons (stroke = currentColor, themed on the knob).
// Icon reflects the CURRENT theme: sun in light, black hole in dark.

function SunIcon() {
  const rays = [
    [24, 5, 24, 9], [24, 39, 24, 43], [5, 24, 9, 24], [39, 24, 43, 24],
    [11.3, 11.3, 14.1, 14.1], [33.9, 33.9, 36.7, 36.7],
    [11.3, 36.7, 14.1, 33.9], [33.9, 14.1, 36.7, 11.3],
  ];
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <circle cx="24" cy="24" r="8" />
      {rays.map((r, i) => <line key={i} x1={r[0]} y1={r[1]} x2={r[2]} y2={r[3]} />)}
    </svg>
  );
}

function BlackHoleIcon() {
  // Interstellar/Gargantua silhouette in line-art: a dark core with a thin bright
  // ring around it — the ring passes in front (below) and behind (above) the core.
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
      <g transform="rotate(-6 24 24)">
        <ellipse cx="24" cy="24" rx="16" ry="6" />
        <circle cx="24" cy="24" r="8" fill="#06070e" stroke="none" />
        <path d="M8 24 A16 6 0 0 0 40 24" />
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
        <span className="ts-knob" style={knobStyle}>
          {/* Icon reflects the CURRENT theme. */}
          {isDark ? <BlackHoleIcon /> : <SunIcon />}
        </span>
      </span>
    </button>
  );
}
