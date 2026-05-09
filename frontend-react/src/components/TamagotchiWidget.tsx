import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import './TamagotchiWidget.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const GREETED_KEY     = 'tama_greeted';
const TOUR_DONE_KEY   = 'tour_v1_done';
const HIGHLIGHT_CLASS = 'tour-highlight-active';
const AUTO_DISMISS_MS = 15_000;
const MSG_SHOW_DELAY  = 3_000;

const BUBBLE_TOP_PAD = 24;   // px from top of screen to bubble top edge
const UFO_GAP        = 8;    // px gap between bubble bottom and UFO center
const UFO_HALF_H     = 9;    // half UFO sprite height in px
const HEARTS_BOTTOM  = 28;   // space reserved for hearts row at bottom

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

function loadTodayFacts(): string[] {
  try {
    const today = new Date().toISOString().split('T')[0];
    const key = `tama_fact_history_${today}`;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]).slice().reverse() : [];
  } catch {
    return [];
  }
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

// ── Types ─────────────────────────────────────────────────────────────────────

type WidgetMode = 'idle' | 'greeting' | 'ai_bubble' | 'tour' | 'choice' | 'fact_page' | 'fly_to_moon';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message: string | null;
  onDismiss: () => void;
  mood?: string;
  animationHint?: string | null;
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
  const [mode,          setMode]          = useState<WidgetMode>('idle');
  const [bubbleText,    setBubbleText]    = useState('');
  const [fromHook,      setFromHook]      = useState(false);
  const [tourStep,      setTourStep]      = useState(0);
  const [bubbleH,       setBubbleH]       = useState(0);
  const [widgetH,       setWidgetH]       = useState(0);
  const [factBubbles,   setFactBubbles]   = useState<string[]>([]);
  const [factPageIndex, setFactPageIndex] = useState(0);
  const [flyPhase,      setFlyPhase]      = useState<'approach' | 'orbit' | 'return' | null>(null);

  const modeRef        = useRef<WidgetMode>('idle');
  const exitTimerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const messageRef     = useRef<string | null>(null);
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

  // ── Track widget height for dynamic UFO positioning ───────────────────────
  useEffect(() => {
    const el = widgetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidgetH(el.offsetHeight));
    ro.observe(el);
    setWidgetH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

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

  // ── Derived mode flags ────────────────────────────────────────────────────
  const inBubble     = mode === 'greeting' || mode === 'ai_bubble';
  const inTour       = mode === 'tour';
  const inFactPage   = mode === 'fact_page';
  const showingBubble = inBubble || inTour || inFactPage;

  // ── Measure bubble height for dynamic UFO pushdown (all viewports) ───────
  useEffect(() => {
    if (!showingBubble) { setBubbleH(0); return; }
    const el = bubbleRef.current;
    if (!el) { setBubbleH(0); return; }
    const ro = new ResizeObserver(() => setBubbleH(el.offsetHeight));
    ro.observe(el);
    setBubbleH(el.offsetHeight);
    return () => ro.disconnect();
  }, [showingBubble, bubbleText, tourStep, factPageIndex]);

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

  // ── Dismiss bubble (✕) — silent close, no exit phrase ───────────────────
  const dismissBubble = () => {
    clearTimeout(autoDismissRef.current);
    clearTimeout(exitTimerRef.current);
    if (fromHook) onDismiss();
    setMode('idle');
  };

  // ── Fact pagination ───────────────────────────────────────────────────────
  const handleFactNext = useCallback(() => {
    setFactPageIndex(prev => {
      const next = prev + 1;
      if (next >= factBubbles.length) {
        setMode('idle');
        return 0;
      }
      return next;
    });
  }, [factBubbles.length]);

  const handleFactSkip = useCallback(() => {
    setMode('idle');
    setFactPageIndex(0);
  }, []);

  // ── UFO click: open choice; advance page while in fact_page ──────────────
  const handleUfoClick = useCallback(() => {
    const cur = modeRef.current;
    if (cur === 'fly_to_moon' || cur === 'tour') return;
    if (cur === 'fact_page') {
      handleFactNext();
      return;
    }
    if (cur === 'idle' || cur === 'ai_bubble' || cur === 'greeting') {
      setFactBubbles(loadTodayFacts());
      setMode('choice');
    }
  }, [handleFactNext]);

  // ── Choice: No → random exit phrase → moon orbit ─────────────────────────
  const handleChoiceNo = useCallback(() => {
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    const phrases = t('ai.exit_phrases', { returnObjects: true }) as string[];
    setBubbleText(phrases[Math.floor(Math.random() * phrases.length)]);
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
          }, 5000);
        }, 5000);
      }, 5000);
    }, 1500);
  }, [t]);

  // ── Choice: Yes → paginated fact viewer ──────────────────────────────────
  const handleChoiceYes = useCallback(() => {
    if (factBubbles.length === 0) {
      setBubbleText(t('dashboard.tama_no_facts'));
      setFromHook(false);
      setMode('ai_bubble');
      return;
    }
    setFactPageIndex(0);
    setMode('fact_page');
  }, [factBubbles.length, t]);

  // ── Cleanup all timers on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(flyTimerRef.current);
      clearTimeout(fly1Ref.current);
      clearTimeout(fly2Ref.current);
      clearTimeout(msgShowRef.current);
      clearTimeout(autoDismissRef.current);
      clearTimeout(exitTimerRef.current);
    };
  }, []);

  // ── Dynamic layout: bubble height → screen min-height → UFO position ─────
  // Screen grows vertically when bubble + UFO would overflow, so hearts remain
  // visible and nothing is clipped.
  const screenMinH = showingBubble && bubbleH > 0
    ? BUBBLE_TOP_PAD + bubbleH + UFO_GAP + UFO_HALF_H * 2 + HEARTS_BOTTOM
    : undefined;

  let ufoTop: string;
  if (showingBubble && bubbleH > 0) {
    const screenH = Math.max(screenMinH ?? 0, widgetH > 0 ? widgetH : 100);
    const ufoCenter = BUBBLE_TOP_PAD + bubbleH + UFO_GAP + UFO_HALF_H;
    ufoTop = `${Math.min((ufoCenter / screenH) * 100, 90)}%`;
  } else {
    ufoTop = '44%';
  }

  const canPageNext = inFactPage && factBubbles.length > 1;

  return (
    <>
    <div
      className="tama-screen"
      ref={widgetRef}
      style={screenMinH ? { minHeight: `${screenMinH}px` } : undefined}
    >

      {/* ── Corner buttons ── */}
      <button
        className="tama-corner-btn tama-corner-btn--tl"
        onClick={startTour}
        title={t('dashboard.tour_relaunch')}
      >?</button>
      <button
        className="tama-corner-btn tama-corner-btn--tr"
        title={canPageNext ? t('tour.next') : 'Play'}
        disabled={!canPageNext}
        onClick={canPageNext ? handleFactNext : undefined}
      >▶</button>

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

        {/* ── Moon — visible during idle and fly-by ── */}
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

        {/* ── UFO — pushed down by bubble via ufoTop ── */}
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
          <div className="tama-ufo-bob">
            <UfoSvg mood={mood} />
          </div>
        </motion.div>

        {/* ── Hearts health bar ── */}
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

        {/* ── SVG thought bubble + choice zones ── */}
        <AnimatePresence>
          {mode === 'choice' && (
            <>
              <motion.div
                key="thought-bubble"
                className="tama-thought-bubble"
                style={{ x: '-50%' }}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.25 }}
              >
                {(() => {
                  const factsQ = t('dashboard.tama_wanna_facts');
                  const [qLine1, qLine2 = ''] = factsQ.split('\n');
                  return (
                    <svg viewBox="0 0 120 56" width="96" xmlns="http://www.w3.org/2000/svg" overflow="visible">
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

      </div>

      {/* ── AI / greeting bubble — positioned above UFO, contained within screen ── */}
      <AnimatePresence>
        {inBubble && (
          <motion.div
            ref={bubbleRef}
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
            ref={bubbleRef}
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

      {/* ── Fact page bubble — paginated, with Next / Skip controls ── */}
      <AnimatePresence>
        {inFactPage && (
          <motion.div
            ref={bubbleRef}
            className="tama-bubble tama-bubble--fact"
            style={{ x: '-50%' }}
            initial={{ opacity: 0, scale: 0.88, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 6 }}
            transition={{ duration: 0.2 }}
          >
            <p className="tama-bubble-text">{factBubbles[factPageIndex]}</p>
            {factBubbles.length > 1 ? (
              <div className="tama-fact-nav">
                <span className="tama-fact-counter">{factPageIndex + 1} / {factBubbles.length}</span>
                <div className="tama-fact-btns">
                  <button className="tama-fact-btn tama-fact-btn--skip" onClick={handleFactSkip}>
                    {t('tour.skip')}
                  </button>
                  <button className="tama-fact-btn tama-fact-btn--next" onClick={handleFactNext}>
                    {t('tour.next')}
                  </button>
                </div>
              </div>
            ) : (
              <button className="tama-bubble-close" onClick={handleFactSkip} aria-label="Close">✕</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
    </>
  );
};

export default TamagotchiWidget;
