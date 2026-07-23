import { useEffect, useRef } from 'react';

/**
 * Reactive cosmic starfield rendered on a single <canvas> behind the auth card.
 *
 * A single canvas (not hundreds of DOM nodes) keeps it cheap. Particles drift
 * gently and constantly, and are pushed away from the pointer (mouse or touch)
 * like pepper scattering on water. Two–three parallax depth layers give a sense
 * of space: far stars are small, slow and barely react; near stars are larger,
 * faster and react strongly.
 *
 * The card on top is opaque, so particles read as a subtle accent toward the
 * edges and the form stays high-contrast. The canvas is aria-hidden and never
 * captures pointer events, so it can't interfere with input focus or scrolling.
 *
 * Future option (deferred — do NOT build here): a UFO object that follows the
 * cursor and knocks stars around. This base must be confirmed smooth first.
 */
export interface StarfieldBackgroundProps {
  /** Star colours, sampled per particle. Themed per page (Login vs Register). */
  palette?: string[];
  /** Nebula glow colour as an "r, g, b" triplet — themed (cool on dark, warm on light). */
  nebulaColor?: string;
  className?: string;
}

const DEFAULT_PALETTE = ['#c7d2fe', '#a5b4fc', '#e9d5ff'];
const DEFAULT_NEBULA_COLOR = '120, 135, 210';

// Parallax depth layers: far → near. radius / drift speed / repulsion strength /
// base opacity all grow toward the viewer.
const LAYERS = [
  { r: 0.8, speed: 0.05, repel: 0.35, opacity: 0.32 }, // far
  { r: 1.4, speed: 0.13, repel: 0.9, opacity: 0.55 },  // mid
  { r: 2.2, speed: 0.24, repel: 1.6, opacity: 0.8 },   // near
];

const REPEL_RADIUS = 120; // px around the pointer within which stars scatter
const PUSH_FRICTION = 0.9; // per-frame decay of the scatter impulse

// Faint nebula glow for depth — colour is themed via the nebulaColor prop (cool
// indigo on the dark sky, warm peach on the light sky). Peak opacity is
// deliberately tiny — a hint, not a cloud.
const NEBULA_ALPHA = 0.16;

interface Particle {
  x: number; y: number;
  vx: number; vy: number;     // constant gentle drift
  pushx: number; pushy: number; // transient pointer-repulsion impulse (decays)
  r: number;
  repel: number;
  opacity: number;
  color: string;
}

export default function StarfieldBackground({ palette = DEFAULT_PALETTE, nebulaColor = DEFAULT_NEBULA_COLOR, className }: StarfieldBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the latest palette/nebula without re-running the effect (which owns the loop).
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const nebulaColorRef = useRef(nebulaColor);
  nebulaColorRef.current = nebulaColor;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0, height = 0;
    let rectLeft = 0, rectTop = 0;
    let particles: Particle[] = [];
    let nebula: CanvasGradient | null = null; // cached; rebuilt on resize
    let raf = 0;
    let lastT = performance.now();
    const pointer = { x: -9999, y: -9999, active: false };

    // Accessibility: honour the OS "reduce motion" setting — no drift/repulsion,
    // just a calm static field.
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motionMq.matches;

    // Focus-dim: while an input is focused (entering credentials) the field
    // eases toward dimmer + slower so it never distracts. `dim` glides toward
    // `targetDim` each frame for a smooth, non-abrupt transition.
    let dim = 0;
    let targetDim = 0;
    const DIM_SPEED_FACTOR = 0.7;   // at full dim, drift runs at 30% speed
    const DIM_OPACITY_FACTOR = 0.5; // …and at 50% opacity

    // Density scales with screen area, always clamped so we never jank.
    // On narrow (phone) viewports the form fills the middle, leaving only thin
    // top/bottom bands of visible sky — so pack those denser (own divisor + cap)
    // to keep them alive. Desktop density is unchanged.
    const NARROW_MAX = 640;
    const particleCount = () => {
      const area = width * height;
      if (width < NARROW_MAX) return Math.max(40, Math.min(80, Math.round(area / 6500)));
      return Math.max(18, Math.min(110, Math.round(area / 14000)));
    };

    const makeParticles = () => {
      const pal = paletteRef.current.length ? paletteRef.current : DEFAULT_PALETTE;
      particles = Array.from({ length: particleCount() }, () => {
        const layer = LAYERS[Math.floor(Math.random() * LAYERS.length)];
        const angle = Math.random() * Math.PI * 2;
        const speed = layer.speed * (0.5 + Math.random());
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          pushx: 0, pushy: 0,
          r: layer.r * (0.7 + Math.random() * 0.6),
          repel: layer.repel,
          opacity: layer.opacity * (0.6 + Math.random() * 0.4),
          color: pal[Math.floor(Math.random() * pal.length)],
        };
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      rectLeft = rect.left; rectTop = rect.top;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap DPR for perf
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Soft radial nebula anchored toward one corner, sized to the viewport.
      const cx = width * 0.22, cy = height * 0.18;
      const radius = Math.max(width, height) * 0.6;
      nebula = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      nebula.addColorStop(0, `rgba(${nebulaColorRef.current}, 0.6)`);
      nebula.addColorStop(1, `rgba(${nebulaColorRef.current}, 0)`);
      makeParticles();
      if (reduced) drawStatic(); // running loop redraws itself; static field won't
    };

    // Very faint depth glow, drawn behind the stars. Alpha folds in the focus-dim
    // multiplier so it calms while typing, just like the stars.
    const drawNebula = (opacityMul: number) => {
      if (!nebula) return;
      ctx.globalAlpha = NEBULA_ALPHA * opacityMul;
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    };

    // Cache the canvas offset so pointermove doesn't force a layout read each move.
    const syncRect = () => {
      const rect = canvas.getBoundingClientRect();
      rectLeft = rect.left; rectTop = rect.top;
    };

    // Pointer Events unify mouse, touch-drag and pen. Listeners are passive
    // (we never preventDefault) so touch scrolling and focus are unaffected.
    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX - rectLeft;
      pointer.y = e.clientY - rectTop;
      pointer.active = true;
    };
    const onPointerLeave = () => { pointer.active = false; pointer.x = -9999; pointer.y = -9999; };

    // Draw every particle at its current position — used for the reduced-motion
    // static field (no drift, no repulsion).
    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      drawNebula(1);
      for (const p of particles) {
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      const dt = Math.min(50, now - lastT) / 16.6667; // normalize to ~60fps steps
      lastT = now;

      dim += (targetDim - dim) * 0.08; // ease toward the focus-dim target
      const speedMul = 1 - dim * DIM_SPEED_FACTOR;
      const opacityMul = 1 - dim * DIM_OPACITY_FACTOR;

      ctx.clearRect(0, 0, width, height);
      drawNebula(opacityMul);
      for (const p of particles) {
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < REPEL_RADIUS * REPEL_RADIUS && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = (1 - d / REPEL_RADIUS) * p.repel;
            p.pushx += (dx / d) * f;
            p.pushy += (dy / d) * f;
          }
        }

        p.x += (p.vx + p.pushx) * dt * speedMul;
        p.y += (p.vy + p.pushy) * dt * speedMul;
        p.pushx *= PUSH_FRICTION;
        p.pushy *= PUSH_FRICTION;

        // Toroidal wrap keeps the field evenly populated forever.
        if (p.x < -5) p.x = width + 5; else if (p.x > width + 5) p.x = -5;
        if (p.y < -5) p.y = height + 5; else if (p.y > height + 5) p.y = -5;

        ctx.globalAlpha = p.opacity * opacityMul;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (raf) return; // already running
      if (reduced) { drawStatic(); return; } // calm static field, no RAF
      lastT = performance.now(); // avoid a dt jump after a pause
      raf = requestAnimationFrame(frame);
    };
    const stopLoop = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    // Focus-dim: dim while a text input has focus, restore when focus leaves.
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && el.matches('input, textarea, select');
    const onFocusIn = (e: FocusEvent) => { if (isField(e.target)) targetDim = 1; };
    const onFocusOut = (e: FocusEvent) => { if (isField(e.target)) targetDim = 0; };

    // Page Visibility: pause when the tab is hidden, resume on return.
    const onVisibility = () => { if (document.hidden) stopLoop(); else startLoop(); };

    // React to the OS reduce-motion setting changing live.
    const onMotionChange = () => {
      reduced = motionMq.matches;
      stopLoop();
      startLoop();
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', syncRect, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('visibilitychange', onVisibility);
    motionMq.addEventListener('change', onMotionChange);
    startLoop();

    return () => {
      stopLoop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', syncRect);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', onVisibility);
      motionMq.removeEventListener('change', onMotionChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
