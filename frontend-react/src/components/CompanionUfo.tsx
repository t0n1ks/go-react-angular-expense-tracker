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
      import('../assets/companion/ufo-3d.json'),
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

// Placeholder while the animation loads or if it fails: a flat drawing of the
// same saucer (grey belly, cyan rim, pale dome) in the same footprint.
const StaticSaucer: React.FC = () => (
  <svg className="tama-ufo-static" viewBox="0 0 30 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="15" cy="14.5" rx="6.5" ry="3.3" fill="#c8c8c8" stroke="#2a2f3a" strokeWidth="0.6" />
    <ellipse cx="15" cy="12" rx="14" ry="4.2" fill="#5ff5f5" stroke="#2a2f3a" strokeWidth="0.7" />
    <path d="M8 11.5 C8 1 22 1 22 11.5 Z" fill="#d6fbff" stroke="#2a2f3a" strokeWidth="0.6" />
    <path d="M17 3.6 C21 5 21.6 9 20.4 11.2 L15.5 11.4 C18.4 9.8 18.6 6.4 17 3.6 Z" fill="#7b86ff" />
  </svg>
);

export default CompanionUfo;
