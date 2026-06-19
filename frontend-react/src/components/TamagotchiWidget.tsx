import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import TamagotchiJournalModal from './TamagotchiJournalModal';
import { fetchBrainContent } from '../utils/brainContent';
import { addDiscovery } from '../utils/tamaStorage';
import {
  buildItem,
  resolveItemText,
  CONTENT_KEYS,
  type ContentKind,
  type SavedItem,
} from '../data/tamaContent';
import cowSpriteUrl from '../assets/pixelcow.png';
import './TamagotchiWidget.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const GREETED_KEY     = 'tama_greeted';
const TOUR_DONE_KEY   = 'tour_v1_done';
const HIGHLIGHT_CLASS = 'tour-highlight-active';
const AUTO_DISMISS_MS = 15_000;
const MSG_SHOW_DELAY  = 3_000;

// Global entity spawner pacing — one entity (cow OR calendar) at a time, with a
// long cooldown between spawns so the scene stays calm and non-intrusive.
const ENTITY_SPAWN_MIN_MS = 35_000;
const ENTITY_SPAWN_VAR_MS = 35_000; // → 35–70s between spawns
// Proactive cycle-week countdown hint: surfaced at most once per window per user.
const PROACTIVE_CYCLE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3h

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

// ── Cycle-exhaustion content picker ──────────────────────────────────────────

// Non-repeating cycle over the registry keys for a kind: shuffles the full key
// set, returns one key per call, reshuffles once exhausted. Returns a stable key
// (e.g. "joke_045") so the journal/favorites resolve to the active UI language.
function getNextKeyFromCycle(kind: ContentKind, userId: string | number): string {
  const keys = CONTENT_KEYS[kind];
  const storeKey = `tama_${kind}_cycle_${userId}`;
  let state: { order: number[]; index: number } = { order: [], index: 0 };
  try { state = JSON.parse(localStorage.getItem(storeKey) ?? '{}'); } catch { /* ignore */ }
  // Reshuffle when missing, exhausted, or the pool size changed (content grew).
  if (!Array.isArray(state.order) || state.order.length !== keys.length || state.index >= state.order.length) {
    const idxs = keys.map((_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    state = { order: idxs, index: 0 };
  }
  const picked = state.order[state.index];
  state.index++;
  try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch { /* ignore */ }
  return keys[picked] ?? keys[0];
}

// ── Daily discoveries (journal) ───────────────────────────────────────────────

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Parse a friendly first name from a display name that may be an email.
//   "Yohans.Ingerma@x" → "Yohans"   (split on '.')
//   "YohansIngerma@x"  → "YohansIngerma" (split on '@' only)
//   "nik"              → "Nik"
// Capitalizes the first letter; truncates names longer than 14 chars with '…'.
function parseDisplayName(raw: string | undefined | null): string {
  const base = (raw ?? '').trim();
  if (!base) return '';
  const local = base.split('@')[0];          // drop any email domain
  let name = local.split('.')[0] || local;   // first dotted segment
  name = name.charAt(0).toUpperCase() + name.slice(1);
  if (name.length > 14) name = name.slice(0, 13) + '…';
  return name;
}

// Daily-discovery + favorites persistence now lives in utils/tamaStorage.ts,
// storing stable keyed SavedItems (language-resolved at render) instead of raw
// localized strings — see addDiscovery import above.

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

const PixelCalendar: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2"   y="3"   width="14"  height="13" rx="2"   fill="#0c0c0c" stroke="#ffd700" strokeWidth="1"/>
    <rect x="2"   y="3"   width="14"  height="4"  rx="2"   fill="#ffd700"/>
    <rect x="5"   y="1.4" width="1.6" height="3"  rx="0.8" fill="#ffd700"/>
    <rect x="11.4" y="1.4" width="1.6" height="3" rx="0.8" fill="#ffd700"/>
    <rect x="4.5" y="9"   width="2"   height="2"  fill="#7dd3fc"/>
    <rect x="8"   y="9"   width="2"   height="2"  fill="#7dd3fc"/>
    <rect x="11.5" y="9"  width="2"   height="2"  fill="#7dd3fc"/>
    <rect x="4.5" y="12"  width="2"   height="2"  fill="#7dd3fc"/>
    <rect x="8"   y="12"  width="2"   height="2"  fill="#7dd3fc"/>
  </svg>
);

// ── Cycle-week countdown helpers ──────────────────────────────────────────────

// A "cycle week" is a 7-day window from the cycle start. The next week begins at
// cycle_start + (current_week_index + 1) * 7 days. Server-authoritative inputs —
// no client budget math, just a date offset.
function getNextCycleWeekStart(cycleStartISO: string, currentWeekIndex: number): Date | null {
  const start = new Date(cycleStartISO);
  if (isNaN(start.getTime())) return null;
  const next = new Date(start);
  next.setDate(next.getDate() + (currentWeekIndex + 1) * 7);
  return next;
}

const DAY_MS = 86_400_000;

// >24h → "N days left"; <24h → live HH:MM:SS; elapsed → fresh-week message.
function formatCycleCountdown(target: Date, now: Date, t: (k: string, o?: Record<string, unknown>) => string): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return t('dashboard.tama_cal_new_week');
  if (ms > DAY_MS) return t('dashboard.tama_cal_days', { days: Math.ceil(ms / DAY_MS) });
  const totalSec = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hms = `${pad(Math.floor(totalSec / 3600))}:${pad(Math.floor((totalSec % 3600) / 60))}:${pad(totalSec % 60)}`;
  return t('dashboard.tama_cal_hms', { time: hms });
}


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
  savingsBalance?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

const TamagotchiWidget: React.FC<Props> = ({
  message,
  onDismiss,
  mood,
  heartsCount = 3,
  aiServiceMode,
  savingsBalance,
}) => {
  const { t, i18n } = useTranslation();
  const { user, axiosInstance } = useAuth();
  const { currentCycle, cycleStats } = useSettings();
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
  const [calVisible,     setCalVisible]     = useState(false);
  const [calTop,         setCalTop]         = useState(50);
  const [calKey,         setCalKey]         = useState(0);
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
  const msgsSinceHintRef   = useRef(0);
  const pendingJokeRef     = useRef<SavedItem | null>(null);
  const starCooldownRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calTickRef         = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  // ── Global entity spawner: one drifting entity (cow OR calendar) at a time ──
  const entityActiveRef    = useRef(false);
  const spawnTimerRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleSpawnRef   = useRef<() => void>(() => {});
  const doSpawnRef         = useRef<() => void>(() => {});

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

  // ── Daily greeting — once per 24h per user (localStorage date, no DB call) ─
  useEffect(() => {
    if (!user?.id) return; // wait until the user is loaded before greeting
    const key = `${GREETED_KEY}_${user.id}`;
    const today = getTodayKey();
    let last: string | null = null;
    try { last = localStorage.getItem(key); } catch { /* ignore */ }
    if (last === today) return;
    const name = parseDisplayName(user.username);
    const t0 = setTimeout(() => {
      if (modeRef.current !== 'idle') return;
      setBubbleText(t('dashboard.tama_greeting', { name }));
      setFromHook(false);
      setMode('greeting');
      try { localStorage.setItem(key, today); } catch { /* ignore */ }
    }, 1200);
    return () => clearTimeout(t0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Proactive savings milestone tip ──────────────────────────────────────
  useEffect(() => {
    if (!savingsBalance || savingsBalance <= 0 || !user?.id) return;
    const todayKey = getTodayKey();
    const shownKey = `tama_savings_tip_${user.id}_${todayKey}`;
    if (localStorage.getItem(shownKey)) return;

    const SAVINGS_TIP_THRESHOLD = 300;
    if (savingsBalance < SAVINGS_TIP_THRESHOLD) return;

    const tips: Record<string, string[]> = {
      en: [
        `🚀 You've stacked ${savingsBalance.toFixed(0)}! Ever thought about investing? 📈`,
        `💰 ${savingsBalance.toFixed(0)} saved! A solid emergency fund start!`,
        `✨ ${savingsBalance.toFixed(0)} banked — maybe treat yourself to a trip? 🌍`,
      ],
      ru: [
        `🚀 Накоплено ${savingsBalance.toFixed(0)}! Может, пора инвестировать? 📈`,
        `💰 ${savingsBalance.toFixed(0)} в копилке! Хороший резервный фонд!`,
        `✨ ${savingsBalance.toFixed(0)} отложено — может, в путешествие? 🌍`,
      ],
      de: [
        `🚀 ${savingsBalance.toFixed(0)} angespart! Zeit zu investieren? 📈`,
        `💰 ${savingsBalance.toFixed(0)} zurückgelegt! Super Notgroschen!`,
        `✨ ${savingsBalance.toFixed(0)} gespart — wie wäre eine Reise? 🌍`,
      ],
      uk: [
        `🚀 Накопичено ${savingsBalance.toFixed(0)}! Час інвестувати? 📈`,
        `💰 ${savingsBalance.toFixed(0)} у скарбничці! Чудовий резервний фонд!`,
        `✨ ${savingsBalance.toFixed(0)} відкладено — може, в подорож? 🌍`,
      ],
    };
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase();
    const pool = tips[lang] || tips.en;
    const tip = pool[Math.floor(Math.random() * pool.length)];

    const t0 = setTimeout(() => {
      if (modeRef.current !== 'idle') return;
      setBubbleText(tip);
      setFromHook(false);
      setMode('ai_bubble');
      try { localStorage.setItem(shownKey, '1'); } catch { /* ignore */ }
    }, 8_000);
    return () => clearTimeout(t0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savingsBalance, user?.id]);

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

  // ── Proactive cycle-week countdown hint (rare, cooldowned) ────────────────
  // Defined fresh each render so it closes over the latest cycle data/translator.
  const maybeProactiveCycleHint = () => {
    if (modeRef.current !== 'idle' || msgsSinceHintRef.current < 2) return;
    const uid = user?.id ?? 'anon';
    const key = `tama_cycle_proactive_${uid}`;
    try {
      const last = Number(localStorage.getItem(key) || 0);
      if (Date.now() - last < PROACTIVE_CYCLE_COOLDOWN_MS) return;
    } catch { /* ignore */ }
    if (!currentCycle?.cycle_start_at || cycleStats?.current_week_index == null) return;
    const target = getNextCycleWeekStart(currentCycle.cycle_start_at, cycleStats.current_week_index);
    if (!target) return;
    const ms = target.getTime() - Date.now();
    if (ms <= 0) return;
    const days = Math.max(1, Math.ceil(ms / DAY_MS));
    setBubbleText(t('dashboard.tama_cal_proactive', { days }));
    setFromHook(false);
    setMode('ai_bubble');
    msgsSinceHintRef.current = 0;
    try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
  };

  // ── Global entity spawner ─────────────────────────────────────────────────
  // One drifting entity (cow OR calendar) at a time. doSpawnRef is reassigned
  // every render so it always sees the latest closures without re-arming the
  // timer; the recursive scheduler lives in a stable, empty-deps effect.
  doSpawnRef.current = () => {
    // Collision avoidance: never spawn over an active entity or an open dialog.
    if (entityActiveRef.current || modeRef.current !== 'idle') {
      scheduleSpawnRef.current(); // retry after another cooldown
      return;
    }
    entityActiveRef.current = true;
    if (Math.random() < 0.5) {
      setCowTop(15 + Math.random() * 40);
      setCowKey(k => k + 1);
      setCowExiting(false);
      setCowVisible(true);
    } else {
      setCalTop(20 + Math.random() * 45);
      setCalKey(k => k + 1);
      setCalVisible(true);
      maybeProactiveCycleHint();
    }
  };

  useEffect(() => {
    const scheduleSpawn = () => {
      clearTimeout(spawnTimerRef.current);
      spawnTimerRef.current = setTimeout(
        () => doSpawnRef.current(),
        ENTITY_SPAWN_MIN_MS + Math.random() * ENTITY_SPAWN_VAR_MS,
      );
    };
    scheduleSpawnRef.current = scheduleSpawn;
    scheduleSpawn();
    return () => clearTimeout(spawnTimerRef.current);
  }, []);

  // Released when the active entity finishes (drifts off or is dismissed); arms
  // the next spawn. Idempotent so a click + animation-end can't double-schedule.
  const endEntity = useCallback(() => {
    if (!entityActiveRef.current) return;
    entityActiveRef.current = false;
    scheduleSpawnRef.current();
  }, []);

  // ── Live countdown ticker lives only while a calendar bubble is open ──────
  useEffect(() => {
    if (mode !== 'ai_bubble') clearInterval(calTickRef.current);
  }, [mode]);

  // ── Calendar click → dismiss entity + open cycle-week countdown bubble ────
  const handleCalendarClick = useCallback(() => {
    // Click-to-dismiss: terminate the drift and remove the calendar from the DOM
    // immediately, then release the spawner — regardless of widget state.
    setCalVisible(false);
    endEntity();
    if (modeRef.current !== 'idle') return; // don't stack over an open dialog/tour
    clearTimeout(autoDismissRef.current);

    const cycleStart = currentCycle?.cycle_start_at;
    const weekIdx = cycleStats?.current_week_index;
    if (!cycleStart || weekIdx == null) {
      setBubbleText(t('dashboard.tama_cal_no_cycle'));
      setFromHook(false);
      setMode('ai_bubble');
      return;
    }
    const target = getNextCycleWeekStart(cycleStart, weekIdx);
    if (!target) return;

    const tick = () => setBubbleText(formatCycleCountdown(target, new Date(), t));
    tick();
    setFromHook(false);
    setMode('ai_bubble');
    // Live HH:MM:SS under 24h; harmless 1s refresh when showing "N days" too.
    clearInterval(calTickRef.current);
    calTickRef.current = setInterval(tick, 1000);
  }, [currentCycle, cycleStats, t, endEntity]);

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

  // ── Rainbow star click → FACT (AI-first, local fallback) ──────────────────
  const handleStarClick = useCallback(async (idx: number) => {
    if (rainbowStarIdx !== idx) return;
    if (starCooldownRef.current || mode !== 'idle') return;
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setFlyPhase(null);

    // Instant click feedback: clear the star + arm the cooldown synchronously.
    setRainbowStarIdx(null);
    navigator.vibrate?.(50);
    starCooldownRef.current = setTimeout(() => { starCooldownRef.current = null; }, 30_000);

    // AI-first within a short charge window; fall back to the local pool. Computing
    // the local pick only on miss avoids burning a shuffled item when AI wins.
    const ai = await fetchBrainContent(axiosInstance, 'fact', i18n.language, { aiServiceMode, timeoutMs: 1000 });
    const item: SavedItem = ai
      ? buildItem('fact', { text: ai.text, translations: ai.translations })
      : buildItem('fact', { key: getNextKeyFromCycle('fact', user?.id ?? 'anon') });

    // The user may have started another interaction during the await.
    if (modeRef.current !== 'idle') return;

    addDiscovery(user?.id ?? 'anon', 'fact', item);
    clearTimeout(autoDismissRef.current);
    setBubbleText(resolveItemText(item, i18n.language));
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
  }, [rainbowStarIdx, t, i18n.language, user?.id, mode, axiosInstance, aiServiceMode]);

  // ── Space cow click → JOKE (AI-first, local fallback) ─────────────────────
  const handleCowClick = useCallback(() => {
    if (cowExiting || mode !== 'idle') return;
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setFlyPhase(null);
    setCowExiting(true);
    navigator.vibrate?.(200);

    // Local pick first — the guaranteed fallback shown when the cow finishes its
    // ~3s exit animation. The brain fetch runs during that window and overwrites
    // pendingJokeRef if it wins; the joke is only displayed in onAnimationComplete,
    // so there is a single bubble render and zero added latency. The spawner is
    // released in onAnimationComplete via endEntity().
    pendingJokeRef.current = buildItem('joke', { key: getNextKeyFromCycle('joke', user?.id ?? 'anon') });
    fetchBrainContent(axiosInstance, 'joke', i18n.language, { aiServiceMode })
      .then(res => { if (res) pendingJokeRef.current = buildItem('joke', { text: res.text, translations: res.translations }); })
      .catch(() => { /* keep local fallback */ });
  }, [cowExiting, i18n.language, user?.id, mode, axiosInstance, aiServiceMode]);

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
      if (starCooldownRef.current) clearTimeout(starCooldownRef.current);
      clearTimeout(spawnTimerRef.current);
      clearInterval(calTickRef.current);
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

        {/* ── Background comets (pure CSS — survive tab throttling) ── */}
        <div className="tama-comets" aria-hidden="true">
          <span className="tama-comet tama-comet--a" />
          <span className="tama-comet tama-comet--b" />
          <span className="tama-comet tama-comet--c" />
        </div>

        {/* ── Persistent star field with rainbow hitboxes ── */}
        <div className="tama-stars">
          {STARS.map((s, i) => (
            <div
              key={i}
              className="tama-star-hitbox"
              style={{ left: `${s.x}%`, top: `${s.y}%` }}
              onClick={() => { void handleStarClick(i); }}
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
                ? { left: '82%', top: '8%', scale: [1, 1.2, 0.05], opacity: [1, 1, 0] }
                : { left: '115%' }
              }
              transition={cowExiting
                ? {
                    duration: 3.0,
                    times: [0, 0.033, 1],
                    left: { delay: 0.1, duration: 2.9, ease: [0.4, 0, 1, 1] },
                    top:  { delay: 0.1, duration: 2.9, ease: [0.4, 0, 1, 1] },
                  }
                : { duration: 18, ease: 'linear' }
              }
              onAnimationComplete={() => {
                if (cowExiting && pendingJokeRef.current) {
                  const jokeItem = pendingJokeRef.current;
                  clearTimeout(autoDismissRef.current);
                  addDiscovery(user?.id ?? 'anon', 'joke', jokeItem);
                  setBubbleText(resolveItemText(jokeItem, i18n.language));
                  setFromHook(false);
                  setMode('ai_bubble');
                  pendingJokeRef.current = null;
                }
                setCowVisible(false);
                endEntity();
              }}
              onClick={handleCowClick}
              role="button"
              aria-label="Space cow"
            >
              <img
                src={cowSpriteUrl}
                width="24"
                height="24"
                alt=""
                style={{ imageRendering: 'pixelated', display: 'block' }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Floating cycle calendar (drifts right→left, distinct from cow) ── */}
        <AnimatePresence>
          {calVisible && (
            <motion.div
              key={`cal-${calKey}`}
              className="tama-calendar"
              style={{ top: `${calTop}%` }}
              initial={{ right: '-15%' }}
              animate={{ right: '115%' }}
              transition={{ duration: 24, ease: 'linear' }}
              onAnimationComplete={() => {
                setCalVisible(false);
                endEntity();
              }}
              onClick={handleCalendarClick}
              role="button"
              aria-label="Cycle calendar"
            >
              <PixelCalendar />
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
