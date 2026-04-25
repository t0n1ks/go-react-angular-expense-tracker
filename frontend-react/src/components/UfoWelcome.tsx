import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Tag, ArrowLeftRight, BarChart2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './UfoWelcome.css';

const SEEN_KEY = 'ufo_intro_seen';

type Phase = 'flyIn' | 'showText' | 'hideText' | 'showTiles' | 'touring' | 'flyOut' | 'done';

interface TileDef {
  key: string;
  navKey: string;
  path: string;
  Icon: LucideIcon;
}

const TILES: TileDef[] = [
  { key: 'categories', navKey: 'nav.categories', path: '/categories', Icon: Tag },
  { key: 'transactions', navKey: 'nav.transactions', path: '/transactions', Icon: ArrowLeftRight },
  { key: 'statistics', navKey: 'nav.statistics', path: '/statistics', Icon: BarChart2 },
];

const TILE_DESC_KEYS = [
  'dashboard.ufo_cat_desc',
  'dashboard.ufo_tx_desc',
  'dashboard.ufo_stats_desc',
] as const;

interface UfoSvgProps {
  beamVisible: boolean;
}

const UfoSvg: React.FC<UfoSvgProps> = ({ beamVisible }) => (
  <svg
    width="64"
    height="44"
    viewBox="0 0 64 44"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ overflow: 'visible' }}
  >
    <defs>
      <linearGradient id="ufo-beam-grad" x1="0.5" y1="0" x2="0.5" y2="1">
        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
      </linearGradient>
    </defs>
    {beamVisible && (
      <polygon points="22,36 42,36 50,116 14,116" fill="url(#ufo-beam-grad)" />
    )}
    <ellipse cx="32" cy="20" rx="13" ry="10" fill="#475569" stroke="#64748b" strokeWidth="1.5" />
    <ellipse cx="32" cy="18" rx="7" ry="6" fill="#38bdf8" opacity="0.9" />
    <ellipse cx="32" cy="28" rx="29" ry="8.5" fill="#334155" stroke="#475569" strokeWidth="1.5" />
    <circle cx="16" cy="29" r="2.5" fill="#fbbf24" />
    <circle cx="32" cy="32" r="2.5" fill="#fbbf24" />
    <circle cx="48" cy="29" r="2.5" fill="#fbbf24" />
  </svg>
);

const UfoWelcome: React.FC = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const alreadySeen = useRef(localStorage.getItem(SEEN_KEY) === 'true');
  const [containerWidth, setContainerWidth] = useState(0);
  const [phase, setPhase] = useState<Phase>(alreadySeen.current ? 'done' : 'flyIn');
  const [showText, setShowText] = useState(false);
  const [showTiles, setShowTiles] = useState(alreadySeen.current);
  const [activeTile, setActiveTile] = useState(-1);
  const [showBubble, setShowBubble] = useState(false);
  const ufoControls = useAnimation();
  const generation = useRef(0);

  // Measure container; if already seen, position UFO off-screen immediately
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    setContainerWidth(w);
    if (alreadySeen.current) {
      ufoControls.set({ x: w + 80, y: 10 });
    }
  }, [ufoControls]);

  const runSequence = useCallback(
    async (width: number) => {
      const gen = ++generation.current;
      const alive = () => gen === generation.current;
      const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      const UFO_HALF = 32;
      const centerX = width / 2 - UFO_HALF;
      const tileX = (i: number) => (width / 3) * i + width / 6 - UFO_HALF;

      setPhase('flyIn');
      setShowText(false);
      setShowTiles(false);
      setActiveTile(-1);
      setShowBubble(false);

      await ufoControls.start({ x: centerX, y: 10, transition: { duration: 1.3, ease: 'easeOut' } });
      if (!alive()) return;

      setShowText(true);
      setPhase('showText');
      await wait(2600);
      if (!alive()) return;

      setShowText(false);
      setPhase('hideText');
      await wait(500);
      if (!alive()) return;

      setShowTiles(true);
      setPhase('showTiles');
      await wait(750);
      if (!alive()) return;

      setPhase('touring');
      for (let i = 0; i < 3; i++) {
        if (!alive()) return;
        await ufoControls.start({
          x: tileX(i),
          y: 95,
          transition: { duration: 0.85, ease: 'easeInOut' },
        });
        if (!alive()) return;
        setActiveTile(i);
        setShowBubble(true);
        await wait(2400);
        if (!alive()) return;
        setShowBubble(false);
        setActiveTile(-1);
        await wait(250);
      }
      if (!alive()) return;

      setPhase('flyOut');
      await ufoControls.start({
        x: width + 80,
        y: 10,
        transition: { duration: 0.9, ease: 'easeIn' },
      });
      if (!alive()) return;

      localStorage.setItem(SEEN_KEY, 'true');
      setPhase('done');
    },
    [ufoControls]
  );

  // Only auto-start the animation on first-ever visit
  useEffect(() => {
    if (containerWidth > 0 && !alreadySeen.current) {
      runSequence(containerWidth);
    }
    return () => {
      generation.current++;
    };
  }, [containerWidth, runSequence]);

  const handleSkip = () => {
    generation.current++; // cancels the running async chain
    setShowText(false);
    setShowBubble(false);
    setActiveTile(-1);
    setShowTiles(true);
    ufoControls.set({ x: containerWidth + 80, y: 10 });
    localStorage.setItem(SEEN_KEY, 'true');
    setPhase('done');
  };

  const handleReplay = () => {
    ufoControls.set({ x: -100, y: 10 });
    runSequence(containerWidth);
  };

  const isDone = phase === 'done';

  return (
    <div ref={containerRef} className="ufo-welcome">
      {/* UFO unit */}
      <motion.div className="ufo-ship" initial={{ x: -100, y: 10 }} animate={ufoControls}>
        <AnimatePresence>
          {showBubble && activeTile >= 0 && (
            <motion.div
              className="ufo-bubble"
              key={`bubble-${activeTile}`}
              initial={{ opacity: 0, scale: 0.85, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 6 }}
              transition={{ duration: 0.22 }}
            >
              {t(TILE_DESC_KEYS[activeTile])}
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        >
          <UfoSvg beamVisible={activeTile >= 0} />
        </motion.div>
      </motion.div>

      {/* Corner controls */}
      <div className="ufo-controls">
        <AnimatePresence>
          {!isDone && containerWidth > 0 && (
            <motion.button
              className="ufo-btn"
              onClick={handleSkip}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.8 }}
            >
              {t('dashboard.ufo_skip')}
            </motion.button>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isDone && (
            <motion.button
              className="ufo-btn"
              onClick={handleReplay}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.3 }}
            >
              {t('dashboard.ufo_replay')}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Intro text */}
      <AnimatePresence>
        {showText && (
          <motion.p
            className="ufo-intro-text"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            {t('dashboard.ufo_intro')}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Section tiles — become clickable links once animation is done */}
      <div className={`ufo-tiles${isDone ? ' ufo-tiles--active' : ''}`}>
        {TILES.map((tile, i) => (
          <Link
            key={tile.key}
            to={tile.path}
            className="ufo-tile-link"
            tabIndex={isDone ? 0 : -1}
          >
            <motion.div
              className={`ufo-tile${activeTile === i ? ' ufo-tile--active' : ''}`}
              initial={{ opacity: 0, y: 20 }}
              animate={showTiles ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              whileHover={isDone ? { y: -3 } : undefined}
              transition={{ delay: showTiles ? i * 0.15 : 0, duration: 0.4 }}
            >
              <tile.Icon size={20} className="ufo-tile-icon" />
              <span>{t(tile.navKey)}</span>
            </motion.div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default UfoWelcome;
