import React from 'react';
import LottieArt from './LottieArt';
import cowSpriteUrl from '../assets/pixelcow.png';
import { COW_ART, COW_STILL_FRAME, COW_VIEWBOX } from '../utils/companionArt';

// The space cow's look, picked by COW_ART (utils/companionArt.ts): the Lottie
// cow drinking milk (lazy, own chunk; still frame under reduced motion) or the
// original pixel sprite — which also stands in while the Lottie loads or if it
// fails. Purely visual: catching is handled by the widget's wrapper.

const loadCow = () => import('../assets/companion/cow-drink-milk.json');

const PixelCow: React.FC<{ className?: string }> = ({ className }) => (
  <img
    src={cowSpriteUrl}
    className={className}
    width="24"
    height="24"
    alt=""
    style={{ imageRendering: 'pixelated', display: 'block' }}
  />
);

const CompanionCow: React.FC = () =>
  COW_ART === 'lottie' ? (
    <LottieArt
      load={loadCow}
      viewBox={COW_VIEWBOX}
      stillFrame={COW_STILL_FRAME}
      className="tama-cow-art"
      fallback={<PixelCow className="tama-cow-fallback" />}
    />
  ) : (
    <PixelCow />
  );

export default CompanionCow;
