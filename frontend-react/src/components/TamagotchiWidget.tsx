import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import './TamagotchiWidget.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const GREETED_KEY     = 'tama_greeted';
const TOUR_DONE_KEY   = 'tour_v1_done';
const HIGHLIGHT_CLASS = 'tour-highlight-active';
const INACTIVITY_MS   = 10_000;
const IDLE_BASE_MS    = 12_000;
const EVENT_CHANCE    = 0.20;

// ── Tour steps ────────────────────────────────────────────────────────────────

const STEPS = [
  { desktop: '[data-tour-id="home"]',         mobile: '[data-tour-id="home-m"]',         title: 'tour.home_title',         text: 'tour.home_text' },
  { desktop: '[data-tour-id="categories"]',   mobile: '[data-tour-id="categories-m"]',   title: 'tour.categories_title',   text: 'tour.categories_text' },
  { desktop: '[data-tour-id="transactions"]', mobile: '[data-tour-id="transactions-m"]', title: 'tour.transactions_title', text: 'tour.transactions_text' },
  { desktop: '[data-tour-id="statistics"]',   mobile: '[data-tour-id="statistics-m"]',   title: 'tour.statistics_title',   text: 'tour.statistics_text' },
  { desktop: '[data-tour-id="settings"]',     mobile: '[data-tour-id="settings-m"]',     title: 'tour.settings_title',     text: 'tour.settings_text' },
];

function isMob(): boolean {
  return window.matchMedia('(max-width: 1024px)').matches;
}

function applyHighlight(step: typeof STEPS[0]): void {
  clearHighlights();
  const el = document.querySelector<HTMLElement>(isMob() ? step.mobile : step.desktop);
  el?.classList.add(HIGHLIGHT_CLASS);
}

function clearHighlights(): void {
  document.querySelectorAll<HTMLElement>(`.${HIGHLIGHT_CLASS}`)
    .forEach(el => el.classList.remove(HIGHLIGHT_CLASS));
}

// ── SVG sprites ───────────────────────────────────────────────────────────────

const UfoSvg: React.FC = () => (
  <svg width="30" height="18" viewBox="0 0 30 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="15" cy="12" rx="14" ry="4.5" fill="#d8d8d8" stroke="#ffffff" strokeWidth="0.8"/>
    <ellipse cx="15" cy="9.5" rx="6.5" ry="5" fill="#ffffff" stroke="#c8c8c8" strokeWidth="0.5"/>
    <circle cx="6"  cy="13" r="1.6" fill="#ffd700"/>
    <circle cx="15" cy="15" r="1.6" fill="#ffd700"/>
    <circle cx="24" cy="13" r="1.6" fill="#ffd700"/>
  </svg>
);

const PixelMoon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="8.5" fill="#ffd700" opacity="0.9"/>
    <circle cx="7"  cy="8"  r="2"   fill="#c9a800" opacity="0.55"/>
    <circle cx="13" cy="13" r="1.5" fill="#c9a800" opacity="0.45"/>
    <circle cx="6"  cy="13" r="1"   fill="#c9a800" opacity="0.35"/>
  </svg>
);

const PixelCow: React.FC = () => (
  <svg width="30" height="18" viewBox="0 0 30 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3"  y="5"  width="16" height="8"  rx="2" fill="#efefef"/>
    <rect x="5"  y="6"  width="4"  height="3"  rx="1" fill="#555"/>
    <rect x="13" y="6"  width="3"  height="3"  rx="1" fill="#555"/>
    <rect x="17" y="2"  width="10" height="8"  rx="2" fill="#efefef"/>
    <rect x="23" y="5"  width="4"  height="2.5" rx="1" fill="#fca5a5"/>
    <rect x="18" y="4"  width="2"  height="1.5" fill="#222"/>
    <rect x="18" y="1"  width="1.5" height="2.5" rx="0.75" fill="#ffd700"/>
    <rect x="21" y="1"  width="1.5" height="2.5" rx="0.75" fill="#ffd700"/>
    <rect x="0"  y="6"  width="3.5" height="1.5" rx="0.75" fill="#efefef"/>
    <rect x="5"  y="12" width="2.5" height="5"  rx="0.75" fill="#d0d0d0"/>
    <rect x="9"  y="12" width="2.5" height="5"  rx="0.75" fill="#d0d0d0"/>
    <rect x="13" y="12" width="2.5" height="5"  rx="0.75" fill="#d0d0d0"/>
    <rect x="17" y="12" width="2.5" height="5"  rx="0.75" fill="#d0d0d0"/>
  </svg>
);

const PixelCoin: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="7" r="6" fill="#ffd700" stroke="#c9a800" strokeWidth="0.8"/>
    <text x="7" y="10.5" textAnchor="middle" fontSize="7" fontWeight="bold" fill="#6b4000" fontFamily="monospace">$</text>
  </svg>
);

// ── Static layout data ────────────────────────────────────────────────────────

const STARS = [
  { x: 11, y: 20, d: 0.0  },
  { x: 81, y: 28, d: 0.55 },
  { x: 19, y: 66, d: 1.1  },
  { x: 87, y: 64, d: 0.3  },
  { x:  7, y: 48, d: 0.85 },
  { x: 73, y: 15, d: 0.45 },
  { x: 46, y: 78, d: 1.4  },
  { x: 61, y: 10, d: 0.7  },
];

const COINS = [
  { left: '34%', delay: '0s'    },
  { left: '52%', delay: '0.55s' },
  { left: '70%', delay: '1.1s'  },
];

// ── Types & helpers ───────────────────────────────────────────────────────────

type IdlePhase  = 'hover' | 'cow' | 'coin';
type WidgetMode = 'idle' | 'greeting' | 'ai_bubble' | 'tour';
type TFunc      = ReturnType<typeof useTranslation>['t'];

function pickRandom(t: TFunc): string {
  const pool: string[] = [
    ...((t('ai.humor', { returnObjects: true }) as string[]) ?? []),
    ...((t('ai.facts',  { returnObjects: true }) as string[]) ?? []),
    ...((t('ai.tips',   { returnObjects: true }) as string[]) ?? []),
  ].filter(Boolean);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message: string | null;
  onDismiss: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const TamagotchiWidget: React.FC<Props> = ({ message, onDismiss }) => {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [mode,       setMode]      = useState<WidgetMode>('idle');
  const [idlePhase,  setIdlePhase] = useState<IdlePhase>('hover');
  const [bubbleText, setBubbleText] = useState('');
  const [fromHook,   setFromHook]  = useState(false);
  const [tourStep,   setTourStep]  = useState(0);

  const modeRef      = useRef<WidgetMode>('idle');
  const messageRef   = useRef<string | null>(null);
  const inactRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { messageRef.current = message; }, [message]);

  // ── First-login greeting ──────────────────────────────────────────────────
  useEffect(() => {
    if (localStorage.getItem(GREETED_KEY)) return;
    const t0 = setTimeout(() => {
      if (modeRef.current !== 'idle') return;
      setBubbleText(t('dashboard.tama_greeting', { name: user?.username ?? '' }));
      setFromHook(false);
      setMode('greeting');
      localStorage.setItem(GREETED_KEY, '1');
    }, 1200);
    return () => clearTimeout(t0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Randomised idle event scheduler ──────────────────────────────────────
  const scheduleNext = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    const delay = IDLE_BASE_MS + Math.random() * 8000; // 12–20 s
    idleTimerRef.current = setTimeout(() => {
      if (modeRef.current !== 'idle') { scheduleNext(); return; }
      if (Math.random() < EVENT_CHANCE) {
        const ev: IdlePhase = Math.random() < 0.5 ? 'cow' : 'coin';
        setIdlePhase(ev);
        const dur = ev === 'cow' ? 5600 : 2800;
        setTimeout(() => { setIdlePhase('hover'); scheduleNext(); }, dur);
      } else {
        scheduleNext();
      }
    }, delay);
  }, []);

  useEffect(() => {
    scheduleNext();
    return () => clearTimeout(idleTimerRef.current);
  }, [scheduleNext]);

  // ── Inactivity bubble ─────────────────────────────────────────────────────
  const resetInact = useCallback(() => {
    clearTimeout(inactRef.current);
    inactRef.current = setTimeout(() => {
      if (modeRef.current !== 'idle') return;
      const hookMsg = messageRef.current;
      if (hookMsg) {
        setBubbleText(hookMsg);
        setFromHook(true);
      } else {
        const rnd = pickRandom(t as TFunc);
        if (!rnd) return;
        setBubbleText(rnd);
        setFromHook(false);
      }
      setMode('ai_bubble');
    }, INACTIVITY_MS);
  }, [t]);

  useEffect(() => {
    resetInact();
    const evts = ['mousemove', 'click', 'keydown', 'touchstart'] as const;
    evts.forEach(e => window.addEventListener(e, resetInact));
    return () => {
      clearTimeout(inactRef.current);
      evts.forEach(e => window.removeEventListener(e, resetInact));
    };
  }, [resetInact]);

  // ── Tour ──────────────────────────────────────────────────────────────────
  const startTour = () => {
    clearHighlights();
    setTourStep(0);
    setMode('tour');
    applyHighlight(STEPS[0]);
  };

  const tourNext = () => {
    const nxt = tourStep + 1;
    if (nxt >= STEPS.length) {
      endTour();
    } else {
      clearHighlights();
      setTourStep(nxt);
      applyHighlight(STEPS[nxt]);
    }
  };

  const endTour = () => {
    clearHighlights();
    localStorage.setItem(TOUR_DONE_KEY, '1');
    setMode('idle');
    resetInact();
  };

  // ── Dismiss AI / greeting bubble ──────────────────────────────────────────
  const dismissBubble = () => {
    if (fromHook) onDismiss();
    setMode('idle');
    resetInact();
  };

  // ── Derived position values ───────────────────────────────────────────────
  const inBubble = mode === 'greeting' || mode === 'ai_bubble';
  const inTour   = mode === 'tour';
  // UFO moves lower when a bubble is shown so the bubble can sit above it
  const ufoTop = (inBubble || inTour)
    ? (isMob() ? '78%' : '72%')
    : idlePhase === 'coin' ? '30%' : '44%';

  return (
    <div className="tama-screen">

      {/* ── Corner buttons ── */}
      <button
        className="tama-corner-btn tama-corner-btn--tl"
        onClick={startTour}
        title={t('dashboard.tour_relaunch')}
      >?</button>
      <button className="tama-corner-btn tama-corner-btn--tr" title="Play" disabled>▶</button>

      <div className="tama-scene">

        {/* ── Persistent star field ── */}
        <div className="tama-stars">
          {STARS.map((s, i) => (
            <div
              key={i}
              className="tama-star"
              style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }}
            />
          ))}
        </div>

        {/* ── Moon (hover phase only) ── */}
        <AnimatePresence>
          {mode === 'idle' && idlePhase === 'hover' && (
            <motion.div
              key="moon"
              className="tama-moon"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7 }}
            >
              <PixelMoon />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Cow abduction event ── */}
        <AnimatePresence>
          {mode === 'idle' && idlePhase === 'cow' && (
            <motion.div
              key="cow-event"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="tama-beam" />
              <div className="tama-cow"><PixelCow /></div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Coin event ── */}
        <AnimatePresence>
          {mode === 'idle' && idlePhase === 'coin' && (
            <motion.div
              key="coin-event"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {COINS.map((c, i) => (
                <div key={i} className="tama-coin" style={{ left: c.left, animationDelay: c.delay }}>
                  <PixelCoin />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── UFO — springs between positions ── */}
        <motion.div
          className="tama-ufo"
          style={{ x: '-50%', y: '-50%' }}
          initial={{ left: '50%', top: '44%' }}
          animate={{ left: '50%', top: ufoTop }}
          transition={{ type: 'spring', stiffness: 80, damping: 18 }}
        >
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 2.8, ease: 'easeInOut' }}
          >
            <UfoSvg />
          </motion.div>
        </motion.div>

        {/* ── AI / greeting bubble ── */}
        <AnimatePresence>
          {inBubble && (
            <motion.div
              className="tama-bubble"
              style={{ x: '-50%' }}
              initial={{ opacity: 0, scale: 0.88, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 6 }}
              transition={{ duration: 0.2 }}
            >
              <p className="tama-bubble-text">{bubbleText}</p>
              <button className="tama-bubble-close" onClick={dismissBubble} aria-label="Close">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Tour bubble ── */}
        <AnimatePresence>
          {inTour && (
            <motion.div
              className="tama-bubble tama-bubble--tour"
              style={{ x: '-50%' }}
              initial={{ opacity: 0, scale: 0.88, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 6 }}
              transition={{ duration: 0.2 }}
            >
              <p className="tama-bubble-title">{t(STEPS[tourStep].title)}</p>
              <p className="tama-bubble-text">{t(STEPS[tourStep].text)}</p>
              <div className="tama-tour-footer">
                <span className="tama-tour-dots">
                  {STEPS.map((_, i) => (
                    <span key={i} className={`tama-tour-dot${i === tourStep ? ' active' : ''}`} />
                  ))}
                </span>
                <div className="tama-tour-actions">
                  <button className="tama-tour-btn-skip" onClick={endTour}>{t('tour.skip')}</button>
                  <button className="tama-tour-btn-next" onClick={tourNext}>
                    {tourStep === STEPS.length - 1 ? t('tour.done') : t('tour.next')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default TamagotchiWidget;
