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

// The sun (light theme) is the knob's own warm gradient + glow rings (pure CSS);
// only the black hole needs an inner motif. Four thick curved blades spiral into a
// dark core, filled bright (accretion colours) for strong contrast on the dark
// sphere. Few arms + bold fills so it stays legible at ~18–20px.
function VortexIcon() {
  const blade = 'M24 24 C 21 16 27 10 34 12 C 30 16 28 20 24 24 Z';
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="ts-vgrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd8a0" />
          <stop offset="55%" stopColor="#ff9d5a" />
          <stop offset="100%" stopColor="#b98cff" />
        </linearGradient>
      </defs>
      <g className="ts-vortex-arms">
        {[0, 90, 180, 270].map(a => (
          <path key={a} d={blade} transform={`rotate(${a} 24 24)`} fill="url(#ts-vgrad)" />
        ))}
      </g>
      <circle cx="24" cy="24" r="4.5" fill="#04050b" />
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
          {/* Knob reflects the CURRENT theme: black-hole vortex in dark, plain sun
              (the knob's own gradient) in light. */}
          {isDark && <VortexIcon />}
        </span>
      </span>
    </button>
  );
}
