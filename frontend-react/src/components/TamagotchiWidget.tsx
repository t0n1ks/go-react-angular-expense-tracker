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
const IDLE_QUIET_MS   = 30_000; // mandatory hover gap between sequences
const IDLE_JITTER_MS  = 10_000; // random extra: total quiet = 30–40 s
const AUTO_DISMISS_MS = 15_000;

// ── Animation deck ────────────────────────────────────────────────────────────

type AnimType = 'cow' | 'coin' | 'radar' | 'spin' | 'fly_by';
const ANIM_DECK: AnimType[] = ['cow', 'coin', 'radar', 'spin', 'fly_by'];

function shuffleDeck(arr: AnimType[]): AnimType[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const BUBBLE_TOP_PAD = 24;
const UFO_GAP = 8;
const UFO_HALF_H = 9;

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

const PixelCow: React.FC = () => (
  <svg width="30" height="18" viewBox="0 0 30 18" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">
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
  <svg width="14" height="14" viewBox="0 0 14 14" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">
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

// 12 coins at varied horizontal positions; delay staggers arrivals across ~13 s
const COINS = [
  { left: '14%', delay: 0    },
  { left: '26%', delay: 1.1  },
  { left: '38%', delay: 2.2  },
  { left: '50%', delay: 3.3  },
  { left: '62%', delay: 4.4  },
  { left: '74%', delay: 5.5  },
  { left: '82%', delay: 6.6  },
  { left: '20%', delay: 7.7  },
  { left: '44%', delay: 8.8  },
  { left: '68%', delay: 9.9  },
  { left: '32%', delay: 11.0 },
  { left: '56%', delay: 12.1 },
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

// ── Types & helpers ───────────────────────────────────────────────────────────

type IdlePhase  = 'hover' | 'cow' | 'coin' | 'radar' | 'spin';
type WidgetMode = 'idle' | 'greeting' | 'ai_bubble' | 'tour' | 'choice' | 'fact_scatter' | 'fly_to_moon';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message: string | null;
  onDismiss: () => void;
  mood?: string;
  smartNudge?: string;
  animationHint?: string | null;
  heartsCount?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

const TamagotchiWidget: React.FC<Props> = ({
  message,
  onDismiss,
  mood,
  smartNudge,
  animationHint,
  heartsCount = 3,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [mode,         setMode]        = useState<WidgetMode>('idle');
  const [idlePhase,    setIdlePhase]   = useState<IdlePhase>('hover');
  const [bubbleText,   setBubbleText]  = useState('');
  const [fromHook,     setFromHook]    = useState(false);
  const [tourStep,     setTourStep]    = useState(0);
  const [bubbleH,      setBubbleH]     = useState(0);
  const [factBubbles,  setFactBubbles] = useState<string[]>([]);
  // null = cow not visible; 5-phase cinematic abduction sequence (~15 s)
  const [cowPhase, setCowPhase] = useState<'entry' | 'glow' | 'beam' | 'lift' | 'done' | null>(null);
  // null = not flying; 3-phase moon orbit (~15 s)
  const [flyPhase, setFlyPhase] = useState<'approach' | 'orbit' | 'return' | null>(null);

  const modeRef          = useRef<WidgetMode>('idle');
  const idlePhaseRef     = useRef<IdlePhase>('hover');
  const messageRef       = useRef<string | null>(null);
  const inactRef         = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimerRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoDismissRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flyTimerRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fly1Ref          = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fly2Ref          = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deckRef          = useRef<AnimType[]>([]);
  const pendingHookMsg   = useRef(false); // message arrived during animation — show on hover resume
  const widgetRef        = useRef<HTMLDivElement>(null);
  const bubbleRef        = useRef<HTMLDivElement>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { idlePhaseRef.current = idlePhase; }, [idlePhase]);
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

  // ── Deck-based idle animation sequencer ──────────────────────────────────
  // Draws from a shuffled deck of 5 animations so every variety plays before
  // any repeats. A mandatory 20–30 s hover gap sits between each sequence.
  const scheduleNext = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    const quietMs = IDLE_QUIET_MS + Math.random() * IDLE_JITTER_MS;
    idleTimerRef.current = setTimeout(() => {
      if (modeRef.current !== 'idle') { scheduleNext(); return; }
      if (deckRef.current.length === 0) {
        deckRef.current = shuffleDeck([...ANIM_DECK]);
      }
      const anim = deckRef.current.pop()!;

      if (anim === 'cow') {
        setIdlePhase('cow');
        setCowPhase('entry');
        setTimeout(() => setCowPhase('glow'),  2000);
        setTimeout(() => setCowPhase('beam'),  5000);
        setTimeout(() => setCowPhase('lift'),  8000);
        setTimeout(() => setCowPhase('done'),  12000);
        setTimeout(() => { setCowPhase(null); setIdlePhase('hover'); scheduleNext(); }, 15000);
      } else if (anim === 'coin') {
        setIdlePhase('coin');
        setTimeout(() => { setIdlePhase('hover'); scheduleNext(); }, 16500);
      } else if (anim === 'radar') {
        setIdlePhase('radar');
        setTimeout(() => { setIdlePhase('hover'); scheduleNext(); }, 9000);
      } else if (anim === 'spin') {
        setIdlePhase('spin');
        setTimeout(() => { setIdlePhase('hover'); scheduleNext(); }, 12000);
      } else {
        // fly_by: autonomous moon orbit, no farewell bubble
        setFlyPhase('approach');
        setMode('fly_to_moon');
        fly1Ref.current = setTimeout(() => setFlyPhase('orbit'), 5000);
        fly2Ref.current = setTimeout(() => setFlyPhase('return'), 10000);
        flyTimerRef.current = setTimeout(() => {
          setFlyPhase(null);
          setMode('idle');
          setIdlePhase('hover');
          scheduleNext();
        }, 15000);
      }
    }, quietMs);
  }, []);

  useEffect(() => {
    scheduleNext();
    return () => clearTimeout(idleTimerRef.current);
  }, [scheduleNext]);

  // ── Auto-dismiss fact/joke bubbles ────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'ai_bubble' || fromHook) {
      clearTimeout(autoDismissRef.current);
      return;
    }
    clearTimeout(autoDismissRef.current);
    const delay = AUTO_DISMISS_MS + Math.random() * 5_000;
    autoDismissRef.current = setTimeout(() => {
      setMode('idle');
      resetInact();
    }, delay);
    return () => clearTimeout(autoDismissRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fromHook]);

  // ── 10-second user-inactivity bubble ──────────────────────────────────────
  const resetInact = useCallback(() => {
    clearTimeout(inactRef.current);
    inactRef.current = setTimeout(() => {
      if (modeRef.current !== 'idle' || idlePhaseRef.current !== 'hover') return;
      const hookMsg = messageRef.current;
      if (!hookMsg) return;
      setBubbleText(hookMsg);
      setFromHook(true);
      setMode('ai_bubble');
    }, INACTIVITY_MS);
  }, []);

  useEffect(() => {
    resetInact();
    const evts = ['mousemove', 'click', 'keydown', 'touchstart'] as const;
    evts.forEach(e => window.addEventListener(e, resetInact));
    return () => {
      clearTimeout(inactRef.current);
      evts.forEach(e => window.removeEventListener(e, resetInact));
    };
  }, [resetInact]);

  // ── animationHint integration ─────────────────────────────────────────────
  useEffect(() => {
    if (!message || !animationHint || modeRef.current !== 'idle' || idlePhase !== 'hover') return;
    if (animationHint === 'COW_ABDUCTION') {
      setIdlePhase('cow');
      setCowPhase('entry');
      const t1 = setTimeout(() => setCowPhase('glow'),  2000);
      const t2 = setTimeout(() => setCowPhase('beam'),  5000);
      const t3 = setTimeout(() => setCowPhase('lift'),  8000);
      const t4 = setTimeout(() => setCowPhase('done'),  12000);
      const t5 = setTimeout(() => { setCowPhase(null); setIdlePhase('hover'); }, 15000);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
    }
    if (animationHint === 'COIN_COLLECT') {
      setIdlePhase('coin');
      const t1 = setTimeout(() => setIdlePhase('hover'), 16500);
      return () => clearTimeout(t1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, animationHint]);

  // ── Priority message handling ─────────────────────────────────────────────
  // If a hook message arrives while an animation is running, flag it so it
  // surfaces quickly when hover resumes instead of waiting for the inactivity timer.
  useEffect(() => {
    if (!message) return;
    if (modeRef.current !== 'idle' || idlePhaseRef.current !== 'hover') {
      pendingHookMsg.current = true;
    }
  }, [message]);

  useEffect(() => {
    if (idlePhase !== 'hover' || mode !== 'idle') return;
    if (!pendingHookMsg.current || !messageRef.current) return;
    pendingHookMsg.current = false;
    const tid = setTimeout(() => {
      if (modeRef.current !== 'idle' || idlePhaseRef.current !== 'hover') return;
      if (!messageRef.current) return;
      setBubbleText(messageRef.current);
      setFromHook(true);
      setMode('ai_bubble');
    }, 2000);
    return () => clearTimeout(tid);
  }, [idlePhase, mode]);

  // ── Mobile: measure bubble height ─────────────────────────────────────────
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
    resetInact();
  };

  // ── Dismiss bubble ────────────────────────────────────────────────────────
  const dismissBubble = () => {
    clearTimeout(autoDismissRef.current);
    if (fromHook) onDismiss();
    setMode('idle');
    resetInact();
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

  // ── Choice: No → farewell bubble → fly to moon ───────────────────────────
  const handleChoiceNo = useCallback(() => {
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setBubbleText(t('dashboard.tama_farewell'));
    setFromHook(false);
    setMode('ai_bubble');
    // After farewell bubble: approach moon (5 s) → orbit (5 s) → return (5 s) = 15 s
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
            setIdlePhase('hover');
            scheduleNext();
          }, 5000);
        }, 5000);
      }, 5000);
    }, 1500);
  }, [scheduleNext, t]);

  // ── Choice: Yes → show scattered facts or info bubble ────────────────────
  const handleChoiceYes = useCallback(() => {
    setMode(prev => {
      if (prev !== 'choice') return prev;
      return 'fact_scatter';
    });
    // If no facts yet, show a localized info bubble
    setFactBubbles(prev => {
      if (prev.length === 0) {
        setBubbleText(t('dashboard.tama_no_facts'));
        setFromHook(false);
        setMode('ai_bubble');
      }
      return prev;
    });
  }, [t]);

  useEffect(() => {
    return () => {
      clearTimeout(flyTimerRef.current);
      clearTimeout(fly1Ref.current);
      clearTimeout(fly2Ref.current);
    };
  }, []);

  // ── Compute UFO vertical position & responsive animation distances ────────
  const inBubble = mode === 'greeting' || mode === 'ai_bubble';
  const inTour   = mode === 'tour';
  const mob      = isMob();

  // Responsive y-travel computed from live widget height so motion scales with
  // any screen size instead of relying on hardcoded pixel offsets.
  const widgetH   = widgetRef.current?.offsetHeight ?? 140;
  // Cow center (bottom:12%) → UFO center (top:46%): ≈32% of widget height
  const cowLiftY  = -(widgetH * 0.32);
  // Coin center (bottom:18%) → UFO center (top:30%): ≈50% of widget height
  const coinLiftY = -(widgetH * 0.50);

  let ufoTop: string;
  if (inBubble || inTour || mode === 'choice') {
    if (mob && bubbleH > 0 && widgetRef.current) {
      const widgetH  = widgetRef.current.offsetHeight;
      const ufoCenter = BUBBLE_TOP_PAD + bubbleH + UFO_GAP + UFO_HALF_H;
      ufoTop = `${Math.min((ufoCenter / widgetH) * 100, 90)}%`;
    } else {
      ufoTop = mob ? '78%' : '72%';
    }
  } else if (mode === 'fact_scatter') {
    ufoTop = '44%';
  } else {
    ufoTop = idlePhase === 'coin' ? '30%' : idlePhase === 'cow' ? '46%' : '44%';
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

        {/* ── Moon (hover phase + fly_to_moon so UFO can fly toward it) ── */}
        <AnimatePresence>
          {((mode === 'idle' && idlePhase === 'hover') || mode === 'fly_to_moon') && (
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

        {/* ── Cow abduction (5-phase, ~15 s cinematic) ── */}
        <AnimatePresence>
          {mode === 'idle' && idlePhase === 'cow' && (
            <motion.div
              key="cow-event"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              {/* Tractor beam: grows in during beam phase, persists through lift */}
              <AnimatePresence>
                {(cowPhase === 'beam' || cowPhase === 'lift') && (
                  <motion.div
                    key="tractor-beam"
                    className="tama-tractor-beam"
                    initial={{ opacity: 0, scaleY: 0 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    exit={{ opacity: 0, scaleY: 0 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                )}
              </AnimatePresence>
              {/* UFO glow ring: soft pulse from glow phase through lift */}
              <AnimatePresence>
                {(cowPhase === 'glow' || cowPhase === 'beam' || cowPhase === 'lift') && (
                  <motion.div
                    key="ufo-glow-pulse"
                    className="tama-ufo-glow-ring"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ scale: [1, 1.3, 1, 1.3, 1], opacity: [0.45, 0.85, 0.55, 0.85, 0.45] }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 3.0, repeat: Infinity }}
                  />
                )}
              </AnimatePresence>
              {/* Final conclusion flash: bright burst as UFO departs */}
              <AnimatePresence>
                {cowPhase === 'done' && (
                  <motion.div
                    key="ufo-glow-done"
                    className="tama-ufo-glow-ring"
                    initial={{ scale: 0.8, opacity: 0.9 }}
                    animate={{ scale: 4.5, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 2.0, ease: 'easeOut' }}
                  />
                )}
              </AnimatePresence>
              {/* Cow: entry walk → soft glow → bright beam → float to UFO → gone.
                  x:'-50%' centers the 30px sprite at left:50% (matches UFO center). */}
              <motion.div
                className="tama-cow"
                style={{ x: '-50%', transformOrigin: 'center center' }}
                initial={{ left: '-8%', y: 0, opacity: 1, scale: 1 }}
                animate={
                  (cowPhase === 'lift' || cowPhase === 'done')
                    ? { left: '50%', y: cowLiftY, opacity: 0, scale: 0 }
                    : cowPhase === 'beam'
                      ? { left: '50%', y: 0, opacity: 1, scale: 1.1, filter: 'brightness(2.5)' }
                      : cowPhase === 'glow'
                        ? { left: '50%', y: 0, opacity: 1, scale: 1.05, filter: 'brightness(1.5)' }
                        : { left: '50%', y: 0, opacity: 1, scale: 1, filter: 'brightness(1)' }
                }
                transition={
                  cowPhase === 'lift'
                    ? { duration: 4.0, ease: [0.5, 0.0, 0.75, 1] }
                    : cowPhase === 'done'
                      ? { duration: 0 }
                      : cowPhase === 'beam'
                        ? { duration: 0.8, ease: 'easeOut' }
                        : cowPhase === 'glow'
                          ? { duration: 1.2, ease: 'easeInOut' }
                          : { duration: 2.0, ease: 'easeInOut' }
                }
              >
                <PixelCow />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Coin collection: coins float slowly up to UFO center ── */}
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
                <motion.div
                  key={i}
                  className="tama-coin"
                  style={{ left: c.left, transformOrigin: 'center center' }}
                  initial={{ y: 0, opacity: 0, scale: 1.1 }}
                  animate={{ y: coinLiftY, opacity: [0, 1, 1, 0], scale: [1.1, 1.1, 0.7, 0.05] }}
                  transition={{
                    delay: c.delay,
                    duration: 4.0,
                    times: [0, 0.08, 0.75, 1],
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                >
                  <PixelCoin />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Radar scan: 3 slow deep-scan pulses (6 s total) ── */}
        <AnimatePresence>
          {mode === 'idle' && idlePhase === 'radar' && (
            <motion.div
              key="radar-event"
              className="tama-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="tama-radar-ring"
                  style={{ transformOrigin: 'center center' }}
                  initial={{ scale: 0.3, opacity: 0.85 }}
                  animate={{ scale: 5, opacity: 0 }}
                  transition={{ delay: i * 2, duration: 4.0, ease: 'easeOut' }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── UFO — springs to computed position, flies to moon on choice No ── */}
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
          <motion.div
            style={{ transformOrigin: 'center center' }}
            animate={idlePhase === 'spin'
              ? { y: [0, -8, 2, -8, 2, -5, 0], rotate: [-5, 5, -5, 5, -3, 3, 0] }
              : { y: [0, -3, 0], rotate: [-1.2, 1.2, -1.2] }}
            transition={idlePhase === 'spin'
              ? { duration: 10, ease: 'easeInOut' }
              : { repeat: Infinity, duration: 5.0, ease: 'easeInOut' }}
          >
            <UfoSvg mood={mood} />
          </motion.div>
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
    {smartNudge && (
      <p className="tama-smart-nudge">{smartNudge}</p>
    )}
    </>
  );
};

export default TamagotchiWidget;
