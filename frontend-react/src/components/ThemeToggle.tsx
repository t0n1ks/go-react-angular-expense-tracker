import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import './ThemeToggle.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Custom, simplified SVG icons (legible at ~44px; no fine detail) ───────────

function SunIcon() {
  // Eight short rays around a warm glowing disc + soft corona.
  const rays = [
    [39, 24, 43, 24], [34.6, 34.6, 37.4, 37.4],
    [24, 39, 24, 43], [13.4, 34.6, 10.6, 37.4],
    [9, 24, 5, 24], [13.4, 13.4, 10.6, 10.6],
    [24, 9, 24, 5], [34.6, 13.4, 37.4, 10.6],
  ];
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id="tt-sun" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#fff7db" />
          <stop offset="55%" stopColor="#ffd24a" />
          <stop offset="100%" stopColor="#f5a623" />
        </radialGradient>
      </defs>
      <g stroke="#f7b733" strokeWidth="2.2" strokeLinecap="round">
        {rays.map((r, i) => <line key={i} x1={r[0]} y1={r[1]} x2={r[2]} y2={r[3]} />)}
      </g>
      <circle cx="24" cy="24" r="12" fill="#ffd24a" opacity="0.28" />
      <circle cx="24" cy="24" r="9" fill="url(#tt-sun)" />
    </svg>
  );
}

function BlackHoleIcon() {
  // Dark disc with a thin bright accretion ring, slightly tilted. The front
  // (lower) half of the ring is drawn over the disc so it reads as wrapping it.
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="tt-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffd27a" />
          <stop offset="50%" stopColor="#ff7b3a" />
          <stop offset="100%" stopColor="#b46bff" />
        </linearGradient>
      </defs>
      <g className="bh-tilt" transform="rotate(-20 24 24)">
        <ellipse cx="24" cy="24" rx="16" ry="6"
          fill="none" stroke="url(#tt-ring)" strokeWidth="2.4" opacity="0.55" />
        <circle cx="24" cy="24" r="9" fill="#05060d" />
        <path d="M8 24 A16 6 0 0 0 40 24"
          fill="none" stroke="url(#tt-ring)" strokeWidth="2.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const btnRef = useRef<HTMLButtonElement>(null);
  // Transition effect: a full-screen light overlay that blooms out of / collapses
  // into the button. phase 'bloom' = going light, 'absorb' = going dark.
  const [fx, setFx] = useState<{ phase: 'bloom' | 'absorb'; x: number; y: number } | null>(null);
  const [fxReady, setFxReady] = useState(false);
  const doneRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return; // idempotent (transitionend + fallback timer)
    doneRef.current = true;
    const phase = fx?.phase;
    setFx(null);
    setFxReady(false);
    if (phase === 'bloom') toggleTheme(); // reveal the now-light page beneath
  };

  // Kick the CSS transition one frame after the overlay mounts at its start state.
  useEffect(() => {
    if (!fx) return;
    doneRef.current = false;
    const raf = requestAnimationFrame(() => setFxReady(true));
    const fallback = window.setTimeout(finish, 700); // in case transitionend is missed
    return () => { cancelAnimationFrame(raf); window.clearTimeout(fallback); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);

  const handleClick = () => {
    if (fx) return; // ignore clicks mid-transition
    const el = btnRef.current;
    if (!el || prefersReducedMotion()) { toggleTheme(); return; }
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (isDark) {
      // → light: bloom outward; theme flips when the bloom completes
      setFx({ phase: 'bloom', x, y });
    } else {
      // → dark: flip now so the dark page sits beneath, then the light overlay
      // collapses into the button ("light being absorbed")
      toggleTheme();
      setFx({ phase: 'absorb', x, y });
    }
  };

  const label = isDark ? t('auth.switch_to_light') : t('auth.switch_to_dark');

  let clip = '';
  if (fx) {
    const full = `circle(150% at ${fx.x}px ${fx.y}px)`;
    const zero = `circle(0px at ${fx.x}px ${fx.y}px)`;
    clip = fx.phase === 'bloom' ? (fxReady ? full : zero) : (fxReady ? zero : full);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="theme-toggle"
        onClick={handleClick}
        aria-label={label}
        title={label}
      >
        <span className="theme-toggle-icon">
          {isDark ? <SunIcon /> : <BlackHoleIcon />}
        </span>
      </button>
      {fx && (
        <div
          className="theme-fx"
          style={{
            clipPath: clip,
            WebkitClipPath: clip,
            transition: fxReady ? 'clip-path 520ms ease-in-out' : 'none',
          }}
          onTransitionEnd={finish}
        />
      )}
    </>
  );
}
