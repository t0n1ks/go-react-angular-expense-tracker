import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import './TamagotchiWidget.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const GREETED_KEY     = 'tama_greeted';
const TOUR_DONE_KEY   = 'tour_v1_done';
const HIGHLIGHT_CLASS = 'tour-highlight-active';
const IDLE_QUIET_MS   = 30_000; // mandatory idle gap before fly-by
const IDLE_JITTER_MS  = 10_000; // random extra: total quiet = 30–40 s
const AUTO_DISMISS_MS = 15_000;
const MSG_SHOW_DELAY  = 3_000;  // grace period before showing an arrived message

const BUBBLE_TOP_PAD = 24;
const UFO_GAP        = 8;
const UFO_HALF_H     = 9;

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

const MOOD_UFO_COLOR: Record<string, string> = {
  thriving:  '#10b981',
  content:   '#a78bfa',
  worried:   '#fbbf24',
  stressed:  '#fb923c',
  exhausted: '#f87171',
};

const UfoSvg: React.FC<{ mood?: string }> = ({ mood }) => {
  const bodyColor = (mood && MOOD_UFO_COLOR[mood]) ?? '#d8d8d8';
  return (
    <svg width="30" height="18" viewBox="0 0 30 18" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="15" cy="12" rx="14" ry="4.5" fill={bodyColor} stroke="#ffffff" strokeWidth="0.8"/>
      <ellipse cx="15" cy="9.5" rx="6.5" ry="5" fill="#ffffff" stroke="#c8c8c8" strokeWidth="0.5"/>
      <circle cx="6"  cy="13" r="1.6" fill="#ffd700"/>
      <circle cx="15" cy="15" r="1.6" fill="#ffd700"/>
      <circle cx="24" cy="13" r="1.6" fill="#ffd700"/>
    </svg>
  );
};

const PixelMoon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="8.5" fill="#ffd700" opacity="0.9"/>
    <circle cx="7"  cy="8"  r="2"   fill="#c9a800" opacity="0.55"/>
    <circle cx="13" cy="13" r="1.5" fill="#c9a800" opacity="0.45"/>
    <circle cx="6"  cy="13" r="1"   fill="#c9a800" opacity="0.35"/>
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

// 8-slot positions (% of widget) arranged in a circle around UFO center (50%, 44%)
const FACT_POSITIONS = [
  { x: 50, y: 10 },
  { x: 77, y: 18 },
  { x: 88, y: 44 },
  { x: 77, y: 70 },
  { x: 50, y: 78 },
  { x: 23, y: 70 },
  { x: 12, y: 44 },
  { x: 23, y: 18 },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type WidgetMode = 'idle' | 'greeting' | 'ai_bubble' | 'tour' | 'choice' | 'fact_scatter' | 'fly_to_moon';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message: string | null;
  onDismiss: () => void;
  mood?: string;

  animationHint?: string | null; // kept for API compat — no longer drives idle animations
  heartsCount?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

const TamagotchiWidget: React.FC<Props> = ({
  message,
  onDismiss,
  mood,
  heartsCount = 3,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [mode,        setMode]        = useState<WidgetMode>('idle');
  const [bubbleText,  setBubbleText]  = useState('');
  const [fromHook,    setFromHook]    = useState(false);
  const [tourStep,    setTourStep]    = useState(0);
  const [bubbleH,     setBubbleH]     = useState(0);
  const [factBubbles, setFactBubbles] = useState<string[]>([]);
  const [flyPhase,    setFlyPhase]    = useState<'approach' | 'orbit' | 'return' | null>(null);

  const modeRef        = useRef<WidgetMode>('idle');
  const messageRef     = useRef<string | null>(null);
  const idleTimerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flyTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fly1Ref        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fly2Ref        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const msgShowRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingHookMsg = useRef(false);
  const widgetRef      = useRef<HTMLDivElement>(null);
  const bubbleRef      = useRef<HTMLDivElement>(null);

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

  // ── Fly-by sequencer: quiet 30–40 s → 15 s moon orbit → repeat ──────────
  const scheduleNext = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    const quietMs = IDLE_QUIET_MS + Math.random() * IDLE_JITTER_MS;
    idleTimerRef.current = setTimeout(() => {
      if (modeRef.current !== 'idle') { scheduleNext(); return; }
      setFlyPhase('approach');
      setMode('fly_to_moon');
      fly1Ref.current = setTimeout(() => setFlyPhase('orbit'),  5000);
      fly2Ref.current = setTimeout(() => setFlyPhase('return'), 10000);
      flyTimerRef.current = setTimeout(() => {
        setFlyPhase(null);
        setMode('idle');
        scheduleNext();
      }, 15000);
    }, quietMs);
  }, []);

  useEffect(() => {
    scheduleNext();
    return () => clearTimeout(idleTimerRef.current);
  }, [scheduleNext]);

  // ── Auto-dismiss non-hook bubbles ─────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'ai_bubble' || fromHook) {
      clearTimeout(autoDismissRef.current);
      return;
    }
    clearTimeout(autoDismissRef.current);
    const delay = AUTO_DISMISS_MS + Math.random() * 5_000;
    autoDismissRef.current = setTimeout(() => setMode('idle'), delay);
    return () => clearTimeout(autoDismissRef.current);
  }, [mode, fromHook]);

  // ── Immediate message display ─────────────────────────────────────────────
  // When a message arrives from the hook, show it in the bubble after a brief
  // grace period. If an animation is running, defer to idle resume.
  useEffect(() => {
    clearTimeout(msgShowRef.current);
    if (!message) return;
    if (modeRef.current !== 'idle') {
      pendingHookMsg.current = true;
      return;
    }
    msgShowRef.current = setTimeout(() => {
      if (modeRef.current !== 'idle') { pendingHookMsg.current = true; return; }
      if (!messageRef.current) return;
      setBubbleText(messageRef.current);
      setFromHook(true);
      setMode('ai_bubble');
    }, MSG_SHOW_DELAY);
    return () => clearTimeout(msgShowRef.current);
  }, [message]);

  // ── Deferred message: show after fly-by completes ────────────────────────
  useEffect(() => {
    if (mode !== 'idle') return;
    if (!pendingHookMsg.current || !messageRef.current) return;
    pendingHookMsg.current = false;
    const tid = setTimeout(() => {
      if (modeRef.current !== 'idle') return;
      if (!messageRef.current) return;
      setBubbleText(messageRef.current);
      setFromHook(true);
      setMode('ai_bubble');
    }, 2000);
    return () => clearTimeout(tid);
  }, [mode]);

  // ── Mobile: measure bubble height for UFO positioning ────────────────────
  const showingBubble = mode === 'greeting' || mode === 'ai_bubble' || mode === 'tour' || mode === 'choice';
  useEffect(() => {
    if (!isMob() || !showingBubble) { setBubbleH(0); return; }
    const el = bubbleRef.current;
    if (!el) { setBubbleH(0); return; }
    const ro = new ResizeObserver(() => setBubbleH(el.offsetHeight));
    ro.observe(el);
    setBubbleH(el.offsetHeight);
    return () => ro.disconnect();
  }, [showingBubble, bubbleText, tourStep]);

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
  };

  // ── Dismiss bubble ────────────────────────────────────────────────────────
  const dismissBubble = () => {
    clearTimeout(autoDismissRef.current);
    if (fromHook) onDismiss();
    setMode('idle');
  };

  // ── UFO click: open choice or collapse scatter ────────────────────────────
  const handleUfoClick = useCallback(() => {
    const cur = modeRef.current;
    if (cur === 'fly_to_moon' || cur === 'tour') return;
    if (cur === 'fact_scatter') {
      setMode('idle');
      return;
    }
    if (cur === 'idle' || cur === 'ai_bubble' || cur === 'greeting') {
      const key = `tama_fact_history_${new Date().toISOString().split('T')[0]}`;
      try {
        const raw = localStorage.getItem(key);
        setFactBubbles(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        setFactBubbles([]);
      }
      setMode('choice');
    }
  }, []);

  // ── Choice: No → farewell bubble → 15 s moon orbit ───────────────────────
  const handleChoiceNo = useCallback(() => {
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setBubbleText(t('dashboard.tama_farewell'));
    setFromHook(false);
    setMode('ai_bubble');
    flyTimerRef.current = setTimeout(() => {
      setFlyPhase('approach');
      setMode('fly_to_moon');
      fly1Ref.current = setTimeout(() => {
        setFlyPhase('orbit');
        fly2Ref.current = setTimeout(() => {
          setFlyPhase('return');
          flyTimerRef.current = setTimeout(() => {
            setFlyPhase(null);
            setMode('idle');
            scheduleNext();
          }, 5000);
        }, 5000);
      }, 5000);
    }, 1500);
  }, [scheduleNext, t]);

  // ── Choice: Yes → show scattered facts or info bubble ────────────────────
  const handleChoiceYes = useCallback(() => {
    setMode(prev => (prev !== 'choice' ? prev : 'fact_scatter'));
    setFactBubbles(prev => {
      if (prev.length === 0) {
        setBubbleText(t('dashboard.tama_no_facts'));
        setFromHook(false);
        setMode('ai_bubble');
      }
      return prev;
    });
  }, [t]);

  // ── Cleanup all timers on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(flyTimerRef.current);
      clearTimeout(fly1Ref.current);
      clearTimeout(fly2Ref.current);
      clearTimeout(msgShowRef.current);
      clearTimeout(idleTimerRef.current);
      clearTimeout(autoDismissRef.current);
    };
  }, []);

  // ── Compute UFO vertical position ─────────────────────────────────────────
  const inBubble = mode === 'greeting' || mode === 'ai_bubble';
  const inTour   = mode === 'tour';
  const mob      = isMob();

  let ufoTop: string;
  if (inBubble || inTour || mode === 'choice') {
    if (mob && bubbleH > 0 && widgetRef.current) {
      const widgetH   = widgetRef.current.offsetHeight;
      const ufoCenter = BUBBLE_TOP_PAD + bubbleH + UFO_GAP + UFO_HALF_H;
      ufoTop = `${Math.min((ufoCenter / widgetH) * 100, 90)}%`;
    } else {
      ufoTop = mob ? '78%' : '72%';
    }
  } else {
    ufoTop = '44%';
  }

  const mobileBubbleStyle = mob ? { top: BUBBLE_TOP_PAD, bottom: 'auto' } : {};

  return (
    <>
    <div className="tama-screen" ref={widgetRef}>

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

        {/* ── Moon — static anchor in top-right; visible during idle and fly-by ── */}
        <AnimatePresence>
          {(mode === 'idle' || mode === 'fly_to_moon') && (
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

        {/* ── UFO — Framer Motion handles position; CSS handles zero-G bob ── */}
        <motion.div
          className="tama-ufo"
          style={{ x: '-50%', y: '-50%', cursor: mode === 'fly_to_moon' ? 'default' : 'pointer' }}
          initial={{ left: '50%', top: '44%' }}
          animate={
            mode !== 'fly_to_moon'
              ? { left: '50%', top: ufoTop, scale: 1 }
              : flyPhase === 'orbit'
                ? { left: '88%', top: '8%', scale: 0.14 }
                : flyPhase === 'return'
                  ? { left: '50%', top: '44%', scale: 1 }
                  : { left: '82%', top: '13%', scale: 0.18 }
          }
          transition={
            mode !== 'fly_to_moon'
              ? { type: 'spring', stiffness: 80, damping: 18 }
              : flyPhase === 'orbit'
                ? { duration: 5.0, ease: 'easeInOut' }
                : flyPhase === 'return'
                  ? { duration: 5.0, ease: [0.42, 0, 0.58, 1] }
                  : { duration: 5.0, ease: [0.25, 0.1, 0.25, 1] }
          }
          onClick={handleUfoClick}
        >
          {/* CSS infinite bob — pure compositor animation, zero JS overhead */}
          <div className="tama-ufo-bob">
            <UfoSvg mood={mood} />
          </div>
        </motion.div>

        {/* ── Hearts health bar (only renders earned hearts) ── */}
        <div className="tama-hearts">
          {Array.from({ length: Math.min(heartsCount, 5) }, (_, i) => (
            <svg key={i} width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M5 8.5C5 8.5 1 5.8 1 3.2C1 1.8 2.2 0.8 3.5 1.6C4.1 1.9 5 2.9 5 2.9C5 2.9 5.9 1.9 6.5 1.6C7.8 0.8 9 1.8 9 3.2C9 5.8 5 8.5 5 8.5Z"
                fill="#f87171"
                stroke="#ef4444"
                strokeWidth="0.4"
              />
            </svg>
          ))}
        </div>

        {/* ── AI / greeting bubble ── */}
        <AnimatePresence>
          {inBubble && (
            <motion.div
              ref={bubbleRef}
              className="tama-bubble"
              style={{ x: '-50%', ...mobileBubbleStyle }}
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
              ref={bubbleRef}
              className="tama-bubble tama-bubble--tour"
              style={{ x: '-50%', ...mobileBubbleStyle }}
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

        {/* ── SVG thought bubble + choice zones ── */}
        <AnimatePresence>
          {mode === 'choice' && (
            <>
              <motion.div
                key="thought-bubble"
                className="tama-thought-bubble"
                style={{ x: '-50%', ...mobileBubbleStyle }}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.25 }}
              >
                {(() => {
                  const factsQ = t('dashboard.tama_wanna_facts');
                  const [qLine1, qLine2 = ''] = factsQ.split('\n');
                  return (
                    <svg viewBox="0 0 120 56" width="140" xmlns="http://www.w3.org/2000/svg" overflow="visible">
                      <circle cx="57" cy="54" r="3" fill="#0c0c0c" stroke="rgba(255,215,0,0.4)" strokeWidth="1"/>
                      <circle cx="59" cy="48" r="4.5" fill="#0c0c0c" stroke="rgba(255,215,0,0.4)" strokeWidth="1"/>
                      <rect x="4" y="4" width="112" height="38" rx="10"
                        fill="#0c0c0c" stroke="rgba(255,215,0,0.45)" strokeWidth="1.5"/>
                      <text x="60" y="20" textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.85)" fontFamily="'Courier New', monospace">{qLine1}</text>
                      <text x="60" y="32" textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.85)" fontFamily="'Courier New', monospace">{qLine2}</text>
                    </svg>
                  );
                })()}
              </motion.div>

              <motion.div
                key="choice-zones"
                style={{ position: 'absolute', inset: 0 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="tama-zone tama-zone--red" onClick={handleChoiceNo}>
                  <span>✗ No</span>
                </div>
                <div className="tama-zone tama-zone--green" onClick={handleChoiceYes}>
                  <span>✓ Yes</span>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Fact scatter bubbles ── */}
        <AnimatePresence>
          {mode === 'fact_scatter' && factBubbles.map((fact, i) => {
            const pos = FACT_POSITIONS[i % FACT_POSITIONS.length];
            return (
              <motion.div
                key={i}
                className="tama-fact-mini-bubble"
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, x: '-50%', y: '-50%' }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0 }}
                transition={{ delay: i * 0.1, duration: 0.3 }}
              >
                <p className="tama-fact-mini-text">{fact}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>

      </div>
    </div>
    </>
  );
};

export default TamagotchiWidget;
