import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ufoPlayerOptions, UFO_VIEWBOX } from '../utils/companionUfo';

// The companion's look: one constant Lottie animation (never recoloured by
// mood — mood lives in the health bar). The player (lottie-web's light SVG
// build, ES-module flavour — its UMD file trips Rollup's tree-shaker) and the
// animation are loaded lazily in their own chunk, so the main
// bundle does not grow; until they arrive — or if they fail — a small static
// saucer is shown. Under reduced motion the animation is a still frame.

type Player = { destroy: () => void };

const CompanionUfo: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = !!useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let player: Player | undefined;
    let cancelled = false;
    Promise.all([
      import('lottie-web/build/player/esm/lottie_light.min.js'),
      import('../assets/companion/UFO_404.json'),
    ])
      .then(([lottie, data]) => {
        if (cancelled || !ref.current) return;
        const opts = ufoPlayerOptions(reduceMotion);
        const anim = lottie.default.loadAnimation({
          container: ref.current,
          renderer: 'svg',
          loop: opts.loop,
          autoplay: opts.autoplay,
          animationData: data.default,
          rendererSettings: { viewBoxSize: UFO_VIEWBOX, preserveAspectRatio: 'xMidYMid meet' },
        });
        if (opts.stillFrame !== null) anim.goToAndStop(opts.stillFrame, true);
        player = anim;
        setReady(true);
      })
      .catch(() => { /* keep the static saucer */ });
    return () => {
      cancelled = true;
      player?.destroy();
      setReady(false);
    };
  }, [reduceMotion]);

  return (
    <div className="tama-ufo-art" aria-hidden="true">
      <div ref={ref} className="tama-ufo-lottie" />
      {!ready && <StaticSaucer />}
    </div>
  );
};

// Placeholder while the animation loads (same footprint, neutral colours).
const StaticSaucer: React.FC = () => (
  <svg className="tama-ufo-static" viewBox="0 0 30 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="15" cy="12" rx="14" ry="4.5" fill="#d8d8d8" stroke="#ffffff" strokeWidth="0.8" />
    <ellipse cx="15" cy="9.5" rx="6.5" ry="5" fill="#ffffff" stroke="#c8c8c8" strokeWidth="0.5" />
    <circle cx="6" cy="13" r="1.6" fill="#ffd700" />
    <circle cx="15" cy="15" r="1.6" fill="#ffd700" />
    <circle cx="24" cy="13" r="1.6" fill="#ffd700" />
  </svg>
);

export default CompanionUfo;
