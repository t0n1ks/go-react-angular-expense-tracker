import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTour } from '../context/TourContext';
import './TamagotchiWidget.css';

// ── SVG assets ─────────────────────────────────────────────────────────────────

const UfoSvg: React.FC = () => (
  <svg width="52" height="36" viewBox="0 0 64 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="32" cy="20" rx="13" ry="10" fill="#475569" stroke="#64748b" strokeWidth="1.5"/>
    <ellipse cx="32" cy="18" rx="7" ry="6" fill="#38bdf8" opacity="0.9"/>
    <ellipse cx="32" cy="28" rx="29" ry="8.5" fill="#334155" stroke="#475569" strokeWidth="1.5"/>
    <circle cx="16" cy="29" r="2.5" fill="#fbbf24"/>
    <circle cx="32" cy="32" r="2.5" fill="#fbbf24"/>
    <circle cx="48" cy="29" r="2.5" fill="#fbbf24"/>
  </svg>
);

const PixelCow: React.FC = () => (
  <svg width="36" height="22" viewBox="0 0 36 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4"  y="8"  width="20" height="9"  rx="2" fill="#e2e8f0"/>
    <rect x="7"  y="10" width="5"  height="4"  rx="1" fill="#334155"/>
    <rect x="17" y="10" width="3"  height="3"  rx="1" fill="#334155"/>
    <rect x="22" y="5"  width="10" height="9"  rx="2" fill="#e2e8f0"/>
    <rect x="29" y="8"  width="5"  height="3"  rx="1.5" fill="#fca5a5"/>
    <rect x="24" y="7"  width="2"  height="2"  fill="#0f172a"/>
    <rect x="24" y="3"  width="2"  height="3"  rx="1" fill="#fbbf24"/>
    <rect x="28" y="3"  width="2"  height="3"  rx="1" fill="#fbbf24"/>
    <rect x="0"  y="9"  width="4"  height="2"  rx="1" fill="#e2e8f0"/>
    <rect x="6"  y="16" width="3"  height="5"  rx="1" fill="#cbd5e1"/>
    <rect x="11" y="16" width="3"  height="5"  rx="1" fill="#cbd5e1"/>
    <rect x="17" y="16" width="3"  height="5"  rx="1" fill="#cbd5e1"/>
    <rect x="22" y="16" width="3"  height="5"  rx="1" fill="#cbd5e1"/>
  </svg>
);

const PixelCoin: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7" fill="#fbbf24" stroke="#d97706" strokeWidth="1"/>
    <text x="8" y="12.5" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#78350f" fontFamily="monospace">$</text>
  </svg>
);

// ── Scene overlays ──────────────────────────────────────────────────────────────

const STAR_POSITIONS = [
  { x: 14, y: 25, delay: 0    },
  { x: 78, y: 32, delay: 0.6  },
  { x: 22, y: 70, delay: 1.15 },
  { x: 85, y: 68, delay: 0.3  },
  { x: 10, y: 55, delay: 0.9  },
  { x: 70, y: 18, delay: 0.45 },
];

const HoveringOverlay: React.FC = () => (
  <>
    {STAR_POSITIONS.map((s, i) => (
      <div
        key={i}
        className="tama-star"
        style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.delay}s` }}
      />
    ))}
  </>
);

const AbductionOverlay: React.FC = () => (
  <>
    <div className="tama-beam" />
    <div className="tama-cow"><PixelCow /></div>
  </>
);

const COIN_CONFIGS = [
  { left: '30%', delay: '0s'    },
  { left: '48%', delay: '0.65s' },
  { left: '66%', delay: '1.3s'  },
];

const CoinsOverlay: React.FC = () => (
  <>
    {COIN_CONFIGS.map((c, i) => (
      <div key={i} className="tama-coin" style={{ left: c.left, animationDelay: c.delay }}>
        <PixelCoin />
      </div>
    ))}
  </>
);

// ── Helpers ─────────────────────────────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslation>['t'];

function pickRandomMessage(t: TFunc): string {
  const humor = t('ai.humor', { returnObjects: true }) as unknown as string[];
  const facts  = t('ai.facts',  { returnObjects: true }) as unknown as string[];
  const tips   = t('ai.tips',   { returnObjects: true }) as unknown as string[];
  const pool = [
    ...(Array.isArray(humor) ? humor : []),
    ...(Array.isArray(facts)  ? facts  : []),
    ...(Array.isArray(tips)   ? tips   : []),
  ];
  if (!pool.length) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Types ───────────────────────────────────────────────────────────────────────

type SceneState = 'hovering' | 'abduction' | 'coins';

const SCENES: SceneState[] = ['hovering', 'abduction', 'coins'];

const UFO_POS: Record<SceneState, { left: string; top: string }> = {
  hovering: { left: '50%', top: '44%' },
  abduction: { left: '50%', top: '22%' },
  coins:     { left: '62%', top: '22%' },
};

const SCENE_MS      = 5_600;
const INACTIVITY_MS = 10_000;

// ── Main component ──────────────────────────────────────────────────────────────

interface Props {
  message: string | null;
  onDismiss: () => void;
}

const TamagotchiWidget: React.FC<Props> = ({ message, onDismiss }) => {
  const { t } = useTranslation();
  const { startTour } = useTour();

  const [scene, setScene]           = useState<SceneState>('hovering');
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleText, setBubbleText] = useState('');
  const [fromHook, setFromHook]     = useState(false);

  // Stable refs so timers don't stale-close over state
  const sceneIdxRef    = useRef(0);
  const showBubbleRef  = useRef(false);
  const messageRef     = useRef<string | null>(null);
  const inactivityRef  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { showBubbleRef.current = showBubble; }, [showBubble]);
  useEffect(() => { messageRef.current = message; }, [message]);

  // ── Scene cycling ──────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (showBubbleRef.current) return;
      sceneIdxRef.current = (sceneIdxRef.current + 1) % SCENES.length;
      setScene(SCENES[sceneIdxRef.current]);
    }, SCENE_MS);
    return () => clearInterval(id);
  }, []);

  // ── Inactivity → speech bubble ─────────────────────────────────────────────
  const resetInactivity = useCallback(() => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      if (showBubbleRef.current) return;
      const hookMsg = messageRef.current;
      if (hookMsg) {
        setBubbleText(hookMsg);
        setFromHook(true);
      } else {
        const rnd = pickRandomMessage(t);
        if (!rnd) return;
        setBubbleText(rnd);
        setFromHook(false);
      }
      setShowBubble(true);
      setScene('hovering');
    }, INACTIVITY_MS);
  }, [t]);

  useEffect(() => {
    resetInactivity();
    const events: (keyof WindowEventMap)[] = ['mousemove', 'click', 'keydown', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetInactivity));
    return () => {
      clearTimeout(inactivityRef.current);
      events.forEach(e => window.removeEventListener(e, resetInactivity));
    };
  }, [resetInactivity]);

  const dismissBubble = () => {
    setShowBubble(false);
    if (fromHook) onDismiss();
    resetInactivity();
  };

  const ufoTarget = showBubble ? { left: '50%', top: '38%' } : UFO_POS[scene];

  return (
    <div className="tama-screen">
      {/* Corner buttons */}
      <button
        className="tama-corner-btn tama-corner-btn--tl"
        onClick={startTour}
        title={t('dashboard.tour_relaunch')}
      >?</button>
      <button
        className="tama-corner-btn tama-corner-btn--tr"
        title="Play"
        disabled
      >▶</button>

      <div className="tama-scene">

        {/* Scene overlays — fade in/out on change */}
        <AnimatePresence mode="wait">
          {!showBubble && scene === 'hovering' && (
            <motion.div
              key="hovering"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55 }}
            >
              <HoveringOverlay />
            </motion.div>
          )}
          {!showBubble && scene === 'abduction' && (
            <motion.div
              key="abduction"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55 }}
            >
              <AbductionOverlay />
            </motion.div>
          )}
          {!showBubble && scene === 'coins' && (
            <motion.div
              key="coins"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55 }}
            >
              <CoinsOverlay />
            </motion.div>
          )}
        </AnimatePresence>

        {/* UFO — springs between positions as scene changes */}
        <motion.div
          className="tama-ufo"
          style={{ x: '-50%', y: '-50%' }}
          initial={{ left: '50%', top: '44%' }}
          animate={{ left: ufoTarget.left, top: ufoTarget.top }}
          transition={{ type: 'spring', stiffness: 72, damping: 16 }}
        >
          {/* Continuous bob */}
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}
          >
            <UfoSvg />
          </motion.div>
        </motion.div>

        {/* Speech bubble */}
        <AnimatePresence>
          {showBubble && (
            <motion.div
              className="tama-bubble"
              initial={{ opacity: 0, scale: 0.84, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.84, y: 10 }}
              transition={{ duration: 0.22 }}
            >
              <p className="tama-bubble-text">{bubbleText}</p>
              <button
                className="tama-bubble-close"
                onClick={dismissBubble}
                aria-label="Close"
              >✕</button>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default TamagotchiWidget;
