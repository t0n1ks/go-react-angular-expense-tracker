import React from 'react';
import LottieArt from './LottieArt';
import { UFO_STILL_FRAME, UFO_VIEWBOX } from '../utils/companionUfo';

// The companion's look: one constant Lottie animation (never recoloured by
// mood — mood lives in the health bar), lazily loaded; a small static saucer
// stands in while it loads or if it fails. Still frame under reduced motion.

const loadUfo = () => import('../assets/companion/ufo-3d.json');

const CompanionUfo: React.FC = () => (
  <LottieArt
    load={loadUfo}
    viewBox={UFO_VIEWBOX}
    stillFrame={UFO_STILL_FRAME}
    className="tama-ufo-art"
    fallback={<StaticSaucer />}
  />
);

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
