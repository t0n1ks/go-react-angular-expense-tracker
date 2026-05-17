import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import TamagotchiJournalModal from './TamagotchiJournalModal';
import './TamagotchiWidget.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const GREETED_KEY     = 'tama_greeted';
const TOUR_DONE_KEY   = 'tour_v1_done';
const HIGHLIGHT_CLASS = 'tour-highlight-active';
const AUTO_DISMISS_MS = 15_000;
const MSG_SHOW_DELAY  = 3_000;

const BUBBLE_TOP_PAD = 24;
const UFO_GAP        = 8;
const UFO_HALF_H     = 9;
const HEARTS_BOTTOM  = 28;

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

// ── Audio synthesis ───────────────────────────────────────────────────────────

function playBloop(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch { /* unsupported browser */ }
}

function playMoo(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const flt = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    flt.type = 'lowpass'; flt.frequency.value = 300;
    osc.connect(flt); flt.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(200, ctx.currentTime + 0.3);
    osc.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.65);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(); osc.stop(ctx.currentTime + 0.8);
  } catch { /* ignore */ }
}

// ── Cycle-exhaustion content picker ──────────────────────────────────────────

function getNextFromCycle(items: string[], userId: string | number, type: 'fact' | 'joke'): string {
  const key = `tama_${type}_cycle_${userId}`;
  let state: { order: number[]; index: number } = { order: [], index: 0 };
  try { state = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* ignore */ }
  if (!Array.isArray(state.order) || state.index >= state.order.length) {
    const idxs = items.map((_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    state = { order: idxs, index: 0 };
  }
  const picked = state.order[state.index];
  state.index++;
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* ignore */ }
  return items[picked] ?? items[0];
}

// ── Daily discoveries (journal) ───────────────────────────────────────────────

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface Discoveries { date: string; facts: string[]; jokes: string[]; }

export function loadDiscoveries(userId: string | number): Discoveries {
  const today = getTodayKey();
  try {
    const raw = localStorage.getItem(`tama_discoveries_${userId}`);
    if (!raw) return { date: today, facts: [], jokes: [] };
    const parsed = JSON.parse(raw) as Discoveries;
    if (parsed.date !== today) return { date: today, facts: [], jokes: [] };
    return parsed;
  } catch { return { date: today, facts: [], jokes: [] }; }
}

function addDiscovery(userId: string | number, type: 'fact' | 'joke', content: string): void {
  try {
    const current = loadDiscoveries(userId);
    const list = type === 'fact' ? current.facts : current.jokes;
    if (!list.includes(content)) list.push(content);
    localStorage.setItem(`tama_discoveries_${userId}`, JSON.stringify(current));
  } catch { /* ignore */ }
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

const SpaceCowSvg: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    shapeRendering="crispEdges"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path fill="#000000" d="M1 2 H3 V3 H1 Z M0 3 H1 V6 H0 Z M3 3 H4 V6 H3 Z M1 6 H3 V7 H1 Z M4 1 H12 V2 H4 Z M4 2 H5 V7 H4 Z M11 2 H12 V7 H11 Z M4 7 H12 V8 H4 Z M5 8 H6 V11 H5 Z M7 9 H8 V12 H7 Z M8 8 H9 V11 H8 Z M10 9 H11 V12 H10 Z M12 2 H15 V3 H12 Z M13 1 H14 V4 H13 Z" />
    <path fill="#ffffff" d="M1 3 H3 V6 H1 Z M5 2 H11 V7 H5 Z" />
    <path fill="#ff8da1" d="M1 4 H2 V5 H1 Z" />
    <path fill="#8B4513" d="M6 3 H7 V4 H6 Z M9 5 H10 V6 H9 Z" />
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

type WidgetMode = 'idle' | 'greeting' | 'ai_bubble' | 'tour' | 'choice' | 'fly_to_moon';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  message: string | null;
  onDismiss: () => void;
  mood?: string;
  animationHint?: string | null;
  heartsCount?: number;
  aiServiceMode?: 'online' | 'autonomous' | 'initializing';
}

// ── Component ─────────────────────────────────────────────────────────────────

const TamagotchiWidget: React.FC<Props> = ({
  message,
  onDismiss,
  mood,
  heartsCount = 3,
  aiServiceMode,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [mode,          setMode]          = useState<WidgetMode>('idle');
  const [bubbleText,    setBubbleText]    = useState('');
  const [fromHook,      setFromHook]      = useState(false);
  const [tourStep,      setTourStep]      = useState(0);
  const [bubbleH,       setBubbleH]       = useState(0);
  const [widgetH,       setWidgetH]       = useState(0);
  const [flyPhase,      setFlyPhase]      = useState<'approach' | 'orbit' | 'return' | null>(null);
  const [rainbowStarIdx, setRainbowStarIdx] = useState<number | null>(null);
  const [cowVisible,     setCowVisible]     = useState(false);
  const [cowExiting,     setCowExiting]     = useState(false);
  const [cowTop,         setCowTop]         = useState(35);
  const [cowKey,         setCowKey]         = useState(0);
  const [showJournal,    setShowJournal]    = useState(false);

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
  const rainbowTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cowTimerRef        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cowAutoHideRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const msgsSinceHintRef   = useRef(0);
  const cowQueuedRef       = useRef(false);
  const spawnCowOrQueueRef = useRef<() => void>(() => {});

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
      msgsSinceHintRef.current += 1;
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
      msgsSinceHintRef.current += 1;
    }, 2000);
    return () => clearTimeout(tid);
  }, [mode]);

  // ── Derived mode flags ────────────────────────────────────────────────────
  const inBubble      = mode === 'greeting' || mode === 'ai_bubble';
  const inTour        = mode === 'tour';
  const showingBubble = inBubble || inTour;

  // ── Measure bubble height for dynamic UFO pushdown ───────────────────────
  useEffect(() => {
    if (!showingBubble) { setBubbleH(0); return; }
    const el = bubbleRef.current;
    if (!el) { setBubbleH(0); return; }
    const ro = new ResizeObserver(() => setBubbleH(el.offsetHeight));
    ro.observe(el);
    setBubbleH(el.offsetHeight);
    return () => ro.disconnect();
  }, [showingBubble, bubbleText, tourStep]);

  // ── Rainbow star scheduling ───────────────────────────────────────────────
  useEffect(() => {
    const schedule = () => {
      const delay = 30_000 + Math.random() * 60_000;
      rainbowTimerRef.current = setTimeout(() => {
        const idx = Math.floor(Math.random() * STARS.length);
        setRainbowStarIdx(idx);
        if (modeRef.current === 'idle' && msgsSinceHintRef.current >= 2) {
          setBubbleText(t('dashboard.tama_hint_star'));
          setFromHook(false);
          setMode('ai_bubble');
          msgsSinceHintRef.current = 0;
        }
      }, delay);
    };
    schedule();
    return () => clearTimeout(rainbowTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  // ── Space cow scheduling (collision-aware) ───────────────────────────────
  useEffect(() => {
    const spawnCowOrQueue = () => {
      const isDialogue = ['greeting', 'ai_bubble', 'tour', 'choice'].includes(modeRef.current);
      if (isDialogue) { cowQueuedRef.current = true; return; }
      setCowTop(15 + Math.random() * 40);
      setCowKey(k => k + 1);
      setCowExiting(false);
      setCowVisible(true);
      cowAutoHideRef.current = setTimeout(() => {
        setCowVisible(false);
        cowTimerRef.current = setTimeout(
          spawnCowOrQueueRef.current,
          45_000 + Math.random() * 90_000,
        );
      }, 22_000);
    };
    spawnCowOrQueueRef.current = spawnCowOrQueue;
    cowTimerRef.current = setTimeout(spawnCowOrQueueRef.current, 60_000 + Math.random() * 90_000);
    return () => {
      clearTimeout(cowTimerRef.current);
      clearTimeout(cowAutoHideRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deferred cow spawn: fires when mode returns to idle ───────────────────
  useEffect(() => {
    if (mode !== 'idle' || !cowQueuedRef.current) return;
    cowQueuedRef.current = false;
    const tid = setTimeout(() => {
      if (modeRef.current !== 'idle') { cowQueuedRef.current = true; return; }
      spawnCowOrQueueRef.current();
    }, 800);
    return () => clearTimeout(tid);
  }, [mode]);

  // ── Force-hide cow if dialogue opens while cow is mid-flight ──────────────
  useEffect(() => {
    const isDialogue = mode === 'greeting' || mode === 'ai_bubble' ||
                       mode === 'tour'     || mode === 'choice';
    if (!isDialogue || !cowVisible) return;
    clearTimeout(cowAutoHideRef.current);
    setCowVisible(false);
    cowQueuedRef.current = true;
  }, [mode, cowVisible]);

  // ── Tour ──────────────────────────────────────────────────────────────────
  const startTour = () => {
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setFlyPhase(null);
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

  // ── Dismiss bubble (✕) ───────────────────────────────────────────────────
  const dismissBubble = () => {
    clearTimeout(autoDismissRef.current);
    clearTimeout(exitTimerRef.current);
    if (fromHook) onDismiss();
    setMode('idle');
  };

  // ── Rainbow star click ────────────────────────────────────────────────────
  const handleStarClick = useCallback((idx: number) => {
    if (rainbowStarIdx !== idx) return;
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setFlyPhase(null);
    const factsPool = t('ai.facts', { returnObjects: true }) as string[];
    const fact = getNextFromCycle(factsPool, user?.id ?? 'anon', 'fact');
    addDiscovery(user?.id ?? 'anon', 'fact', fact);
    setRainbowStarIdx(null);
    playBloop();
    navigator.vibrate?.(15);
    clearTimeout(autoDismissRef.current);
    setBubbleText(fact);
    setFromHook(false);
    setMode('ai_bubble');
    clearTimeout(rainbowTimerRef.current);
    rainbowTimerRef.current = setTimeout(() => {
      const next = Math.floor(Math.random() * STARS.length);
      setRainbowStarIdx(next);
      if (modeRef.current === 'idle' && msgsSinceHintRef.current >= 2) {
        setBubbleText(t('dashboard.tama_hint_star'));
        setFromHook(false);
        setMode('ai_bubble');
        msgsSinceHintRef.current = 0;
      }
    }, 45_000);
  }, [rainbowStarIdx, t, user?.id]);

  // ── Space cow click ───────────────────────────────────────────────────────
  const handleCowClick = useCallback(() => {
    if (cowExiting) return;
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setFlyPhase(null);
    clearTimeout(cowAutoHideRef.current);
    setCowExiting(true);
    playMoo();
    navigator.vibrate?.(15);
    const jokesPool = t('ai.humor', { returnObjects: true }) as string[];
    const joke = getNextFromCycle(jokesPool, user?.id ?? 'anon', 'joke');
    addDiscovery(user?.id ?? 'anon', 'joke', joke);
    clearTimeout(autoDismissRef.current);
    setBubbleText(joke);
    setFromHook(false);
    setMode('ai_bubble');
    cowTimerRef.current = setTimeout(() => {
      setCowVisible(false);
      cowTimerRef.current = setTimeout(spawnCowOrQueueRef.current, 45_000 + Math.random() * 90_000);
    }, 1000);
  }, [cowExiting, t, user?.id]);

  // ── UFO click: open journal choice ───────────────────────────────────────
  const handleUfoClick = useCallback(() => {
    const cur = modeRef.current;
    if (cur === 'fly_to_moon' || cur === 'tour' || cur === 'choice') return;
    setBubbleText(t('dashboard.tama_journal_prompt'));
    setMode('choice');
  }, [t]);

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

  // ── Choice: Yes → open journal modal ─────────────────────────────────────
  const handleChoiceYes = useCallback(() => {
    setMode('idle');
    setShowJournal(true);
  }, []);

  // ── Cleanup all timers on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(flyTimerRef.current);
      clearTimeout(fly1Ref.current);
      clearTimeout(fly2Ref.current);
      clearTimeout(msgShowRef.current);
      clearTimeout(autoDismissRef.current);
      clearTimeout(exitTimerRef.current);
      clearTimeout(rainbowTimerRef.current);
      clearTimeout(cowTimerRef.current);
      clearTimeout(cowAutoHideRef.current);
    };
  }, []);

  // ── Dynamic layout ────────────────────────────────────────────────────────
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

  return (
    <>
    <div
      className="tama-screen"
      ref={widgetRef}
      style={screenMinH ? { minHeight: `${screenMinH}px` } : undefined}
    >

      {/* ── Corner button (tour) ── */}
      <button
        className="tama-corner-btn tama-corner-btn--tl"
        onClick={startTour}
        title={t('dashboard.tour_relaunch')}
      >?</button>

      <div className="tama-scene">

        {/* ── Persistent star field with rainbow hitboxes ── */}
        <div className="tama-stars">
          {STARS.map((s, i) => (
            <div
              key={i}
              className="tama-star-hitbox"
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              onClick={() => handleStarClick(i)}
              role={rainbowStarIdx === i ? 'button' : undefined}
              aria-label={rainbowStarIdx === i ? 'Cosmic secret' : undefined}
            >
              <div
                className={`tama-star${rainbowStarIdx === i ? ' tama-star--rainbow' : ''}`}
                style={{ animationDelay: `${s.d}s` }}
              />
            </div>
          ))}
        </div>

        {/* ── Moon (always persistent — needed as fly_to_moon target) ── */}
        <div className="tama-moon">
          <PixelMoon />
        </div>

        {/* ── Space cow ── */}
        <AnimatePresence>
          {cowVisible && (
            <motion.div
              key={cowKey}
              className={`tama-space-cow${cowExiting ? ' tama-space-cow--exiting' : ''}`}
              style={{ top: `${cowTop}%` }}
              initial={{ left: '-15%', scale: 1, opacity: 1 }}
              animate={cowExiting
                ? { left: '82%', top: '8%', scale: 0.05, opacity: 0 }
                : { left: '115%' }
              }
              transition={cowExiting
                ? { duration: 0.7, ease: [0.4, 0, 1, 1] }
                : { duration: 18, ease: 'linear' }
              }
              onAnimationComplete={() => {
                if (!cowExiting) setCowVisible(false);
              }}
              onClick={handleCowClick}
              role="button"
              aria-label="Space cow"
            >
              <SpaceCowSvg />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── UFO ── */}
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
                  const factsQ = t('dashboard.tama_journal_prompt');
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

      {/* ── AI / greeting bubble ── */}
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

    </div>

    {aiServiceMode && aiServiceMode !== 'initializing' && (
      <div className={`tama-service-status${aiServiceMode === 'autonomous' ? ' tama-service-status--off' : ''}`}>
        <span className={`tama-service-dot${aiServiceMode === 'online' ? ' tama-service-dot--on' : ' tama-service-dot--off'}`} />
        <span className="tama-service-label">
          {aiServiceMode === 'online' ? t('ai.status_online') : t('ai.status_autonomous')}
        </span>
      </div>
    )}

    <TamagotchiJournalModal
      open={showJournal}
      userId={user?.id ?? 'anon'}
      onClose={() => setShowJournal(false)}
    />
    </>
  );
};

export default TamagotchiWidget;
