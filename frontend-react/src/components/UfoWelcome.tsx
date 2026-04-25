import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Tag, ArrowLeftRight, BarChart2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './UfoWelcome.css';

type Phase = 'flyIn' | 'showText' | 'hideText' | 'showTiles' | 'touring' | 'flyOut' | 'done';

interface TileDef {
  key: string;
  navKey: string;
  Icon: LucideIcon;
}

const TILES: TileDef[] = [
  { key: 'categories', navKey: 'nav.categories', Icon: Tag },
  { key: 'transactions', navKey: 'nav.transactions', Icon: ArrowLeftRight },
  { key: 'statistics', navKey: 'nav.statistics', Icon: BarChart2 },
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
    {/* Dome */}
    <ellipse cx="32" cy="20" rx="13" ry="10" fill="#475569" stroke="#64748b" strokeWidth="1.5" />
    {/* Window */}
    <ellipse cx="32" cy="18" rx="7" ry="6" fill="#38bdf8" opacity="0.9" />
    {/* Disc */}
    <ellipse cx="32" cy="28" rx="29" ry="8.5" fill="#334155" stroke="#475569" strokeWidth="1.5" />
    {/* Lights */}
    <circle cx="16" cy="29" r="2.5" fill="#fbbf24" />
    <circle cx="32" cy="32" r="2.5" fill="#fbbf24" />
    <circle cx="48" cy="29" r="2.5" fill="#fbbf24" />
  </svg>
);

const UfoWelcome: React.FC = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [phase, setPhase] = useState<Phase>('flyIn');
  const [showText, setShowText] = useState(false);
  const [showTiles, setShowTiles] = useState(false);
  const [activeTile, setActiveTile] = useState(-1);
  const [showBubble, setShowBubble] = useState(false);
  const ufoControls = useAnimation();
  const generation = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (el) setContainerWidth(el.offsetWidth);
  }, []);

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
      setPhase('done');
    },
    [ufoControls]
  );

  useEffect(() => {
    if (containerWidth > 0) runSequence(containerWidth);
    return () => {
      generation.current++;
    };
  }, [containerWidth, runSequence]);

  const handleReplay = () => {
    if (phase !== 'done') return;
    ufoControls.set({ x: -100, y: 10 });
    runSequence(containerWidth);
  };

  return (
    <div
      ref={containerRef}
      className={`ufo-welcome${phase === 'done' ? ' ufo-welcome--clickable' : ''}`}
      onClick={handleReplay}
    >
      {/* UFO unit */}
      <motion.div
        className="ufo-ship"
        initial={{ x: -100, y: 10 }}
        animate={ufoControls}
      >
        {/* Speech bubble */}
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

        {/* UFO with infinite bob */}
        <motion.div
          animate={{ y: [0, -5, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        >
          <UfoSvg beamVisible={activeTile >= 0} />
        </motion.div>
      </motion.div>

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

      {/* Section tiles */}
      <div className="ufo-tiles">
        {TILES.map((tile, i) => (
          <motion.div
            key={tile.key}
            className={`ufo-tile${activeTile === i ? ' ufo-tile--active' : ''}`}
            initial={{ opacity: 0, y: 20 }}
            animate={showTiles ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ delay: showTiles ? i * 0.15 : 0, duration: 0.4 }}
          >
            <tile.Icon size={20} className="ufo-tile-icon" />
            <span>{t(tile.navKey)}</span>
          </motion.div>
        ))}
      </div>

      {/* Replay hint */}
      <AnimatePresence>
        {phase === 'done' && (
          <motion.span
            className="ufo-replay-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            {t('dashboard.ufo_replay')}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UfoWelcome;
