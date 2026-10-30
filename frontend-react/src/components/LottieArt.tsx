import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { lottiePlayerOptions } from '../utils/companionUfo';

// One lazily-loaded Lottie animation for the companion's art (the UFO, the
// cow). The player (lottie-web's light SVG build, ES-module flavour — its UMD
// file trips Rollup's tree-shaker) and each animation are fetched in their own
// chunks, so the main bundle does not grow; until they arrive — or if they
// fail — `fallback` is shown. Under reduced motion it is one still frame.

type Player = { destroy: () => void };

interface Props {
  /** Dynamic import of the animation JSON (keeps it out of the main bundle). */
  load: () => Promise<{ default: unknown }>;
  /** Crop of the animation's canvas, "x y w h". */
  viewBox: string;
  /** Frame shown under prefers-reduced-motion. */
  stillFrame: number;
  /** Wrapper class: sets the box size (the SVG fills it). */
  className: string;
  /** Static stand-in while loading or after a failure. */
  fallback: React.ReactNode;
}

const LottieArt: React.FC<Props> = ({ load, viewBox, stillFrame, className, fallback }) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = !!useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let player: Player | undefined;
    let cancelled = false;
    Promise.all([import('lottie-web/build/player/esm/lottie_light.min.js'), load()])
      .then(([lottie, data]) => {
        if (cancelled || !ref.current) return;
        const opts = lottiePlayerOptions(reduceMotion, stillFrame);
        const anim = lottie.default.loadAnimation({
          container: ref.current,
          renderer: 'svg',
          loop: opts.loop,
          autoplay: opts.autoplay,
          animationData: data.default,
          rendererSettings: { viewBoxSize: viewBox, preserveAspectRatio: 'xMidYMid meet' },
        });
        if (opts.stillFrame !== null) anim.goToAndStop(opts.stillFrame, true);
        player = anim;
        setReady(true);
      })
      .catch(() => { /* keep the fallback */ });
    return () => {
      cancelled = true;
      player?.destroy();
      setReady(false);
    };
  }, [load, viewBox, stillFrame, reduceMotion]);

  return (
    <div className={`tama-lottie-art ${className}`} aria-hidden="true">
      <div ref={ref} className="tama-lottie-player" />
      {!ready && fallback}
    </div>
  );
};

export default LottieArt;
