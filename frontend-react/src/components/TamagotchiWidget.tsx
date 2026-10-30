import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import TamagotchiJournalModal from './TamagotchiJournalModal';
import CompanionHealthMeter from './CompanionHealthMeter';
import CompanionUfo from './CompanionUfo';
import {
  countsForQuest,
  pickExitLine,
  type CatchKind,
  type CompanionInteraction,
  type CompanionMood,
  type MessageAction,
} from '../utils/companion';
import { fetchBrainContent } from '../utils/brainContent';
import { addDiscovery } from '../utils/tamaStorage';
import {
  buildItem,
  resolveItemText,
  CONTENT_KEYS,
  type ContentKind,
  type SavedItem,
} from '../data/tamaContent';
import calendarPngUrl from '../assets/companion/calendar.png';
import CompanionCow from './CompanionCow';
import { placeBubble, sideBubbleTop } from '../utils/bubbleLayout';
import { CALENDAR_ART } from '../utils/companionArt';
import './TamagotchiWidget.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const GREETED_KEY     = 'tama_greeted';
const TOUR_DONE_KEY   = 'tour_v1_done';
const HIGHLIGHT_CLASS = 'tour-highlight-active';
const AUTO_DISMISS_MS = 15_000;
const EXIT_LINE_WAIT_MS = 600; // pool exit line, else the built-in one
// Bubble width by amount of text: up to this many characters (≈12–15 words)
// a line gets the wider, balanced 1–2 row box; longer text the narrow one
// that scrolls. Exit lines, greetings and the moon's status are always short.
const SHORT_BUBBLE_CHARS = 90;
const MSG_SHOW_DELAY  = 3_000;

// Global entity spawner pacing — one entity (cow OR calendar) at a time, with a
// long cooldown between spawns so the scene stays calm and non-intrusive.
const ENTITY_SPAWN_MIN_MS = 35_000;
const ENTITY_SPAWN_VAR_MS = 35_000; // → 35–70s between spawns
// Proactive cycle-week countdown hint: surfaced at most once per window per user.
const PROACTIVE_CYCLE_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3h

const BUBBLE_TOP_PAD = 24;
const UFO_GAP        = 8;
const UFO_HALF_H     = 22; // half the Lottie UFO's box (44 px; re-measured — it scales per breakpoint)
const HEARTS_BOTTOM  = 30; // room for the health bar under the UFO

// The flight round the moon (seconds per leg): out, a short orbit, back —
// lively but smooth (it was 5 s per leg, 15 s in all).
const FLY_APPROACH_S = 2.2;
const FLY_ORBIT_S    = 2.6;
const FLY_RETURN_S   = 2.4;

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

// The moon with craters. Their faint glow tells the AI service's state —
// green on duty, red asleep, none while still checking (colour comes from
// .tama-moon--<status> in CSS; the button's label says it in words).
const MOON_CRATERS: Array<[number, number, number]> = [[7, 8, 2], [13, 13, 1.5], [6, 13, 1], [12.6, 6.4, 1.1]];

const CraterMoon: React.FC = () => {
  const blurId = `moonglow${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg viewBox="0 0 20 20" preserveAspectRatio="xMidYMid meet" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id={blurId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
      <circle cx="10" cy="10" r="8.5" fill="#ffd700" opacity="0.9" />
      <g className="tama-craters">
        {MOON_CRATERS.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
      </g>
      <g className="tama-crater-glow" filter={`url(#${blurId})`}>
        {MOON_CRATERS.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r * 0.8} />)}
      </g>
    </svg>
  );
};

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

// The calendar's look, picked by CALENDAR_ART (utils/companionArt.ts): the PNG
// (512 px source drawn at 18 px — crisp on any density) or the pixel SVG above.
const CalendarArt: React.FC = () =>
  CALENDAR_ART === 'png'
    ? <img src={calendarPngUrl} width="18" height="18" alt="" draggable={false} style={{ display: 'block' }} />
    : <PixelCalendar />;

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
  // Set while the shown message is a companion message: 👍 / 👎 / ✕ go here
  // (✕ is neutral — no vote). Other bubbles just close via onDismiss.
  onMessageAction?: (action: MessageAction) => void;
  mood?: CompanionMood;
  animationHint?: string | null;
  aiServiceMode?: 'online' | 'autonomous' | 'initializing';
  // Companion health (server-decided): value, the plain-language reason, and a
  // one-off note to show when it has just dropped.
  health?: number;
  reasonText?: string;
  healthNote?: string | null;
  // The weekly quest is open: make sure a catchable star shows up soon.
  questOpen?: boolean;
  onCatch?: (kind: CatchKind) => void;
  // 'stack': full-width block that grows with its bubble (mobile, laptop,
  // Lite). 'cell': a fixed-height dashboard grid cell — the screen never grows
  // (its neighbours would jump); a long bubble scrolls instead.
  layout?: 'stack' | 'cell';
}

// ── Component ─────────────────────────────────────────────────────────────────

const TamagotchiWidget: React.FC<Props> = ({
  message,
  onDismiss,
  onMessageAction,
  mood,
  aiServiceMode,
  health,
  reasonText,
  healthNote,
  questOpen,
  onCatch,
  layout = 'stack',
}) => {
  const reduceMotion = useReducedMotion();
  const { t, i18n } = useTranslation();
  const { user, axiosInstance } = useAuth();
  const { currentCycle, cycleStats } = useSettings();
  const [mode,          setMode]          = useState<WidgetMode>('idle');
  const [bubbleText,    setBubbleText]    = useState('');
  const [fromHook,      setFromHook]      = useState(false);
  const [tourStep,      setTourStep]      = useState(0);
  const [bubbleH,       setBubbleH]       = useState(0);
  const [widgetH,       setWidgetH]       = useState(0);
  const [widgetW,       setWidgetW]       = useState(0);
  // A text bubble's height laid out above the saucer (its natural width),
  // measured once per text — the input that decides above vs beside.
  const [naturalBubble, setNaturalBubble] = useState<{ text: string; h: number } | null>(null);
  // Short lines that always sit above the saucer (exit line, moon status).
  const [aboveOnlyText, setAboveOnlyText] = useState<string | null>(null);
  // Restarts the moon's ripple each time it is tapped.
  const [moonRipple, setMoonRipple] = useState(0);
  const [ufoHalf,       setUfoHalf]       = useState(UFO_HALF_H);
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
  const moonTimerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fly1Ref        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fly2Ref        = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const msgShowRef     = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingHookMsg = useRef(false);
  const widgetRef      = useRef<HTMLDivElement>(null);
  const bubbleRef      = useRef<HTMLDivElement>(null);
  const rainbowTimerRef    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const msgsSinceHintRef   = useRef(0);
  const pendingJokeRef     = useRef<SavedItem | null>(null);
  const pendingQuotaRef    = useRef<string | null>(null);
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
    // The UFO's box scales per breakpoint (CSS --tama-ufo); its half-height
    // feeds the bubble/UFO layout below.
    const measure = () => {
      setWidgetH(el.offsetHeight);
      setWidgetW(el.offsetWidth);
      const art = el.querySelector<HTMLElement>('.tama-ufo-art');
      if (art?.offsetHeight) setUfoHalf(art.offsetHeight / 2);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
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

  // ── Measure a new text bubble's natural height before it is painted ───────
  // (until measured it renders in the default place above the saucer).
  useLayoutEffect(() => {
    if (!inBubble || naturalBubble?.text === bubbleText) return;
    const el = bubbleRef.current;
    if (el) setNaturalBubble({ text: bubbleText, h: el.offsetHeight });
  }, [inBubble, bubbleText, naturalBubble]);

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

  // ── Quest open: a catchable star within seconds, not minutes ─────────────
  useEffect(() => {
    if (!questOpen || rainbowStarIdx !== null) return;
    const id = setTimeout(() => {
      setRainbowStarIdx(Math.floor(Math.random() * STARS.length));
    }, 4_000);
    return () => clearTimeout(id);
  }, [questOpen, rainbowStarIdx]);

  // ── Health explanations ──────────────────────────────────────────────────
  const showNote = useCallback((text: string) => {
    if (modeRef.current !== 'idle' || !text) return;
    clearTimeout(autoDismissRef.current);
    setBubbleText(text);
    setFromHook(false);
    setMode('ai_bubble');
  }, []);

  // Health just dropped: say why, once.
  useEffect(() => {
    if (!healthNote) return;
    const id = setTimeout(() => showNote(healthNote), 1_500);
    return () => clearTimeout(id);
  }, [healthNote, showNote]);

  const explainHealth = useCallback(() => {
    if (health !== undefined && reasonText) {
      showNote(t('companion.health_now', { value: Math.round(health), reason: reasonText }));
    }
  }, [health, reasonText, showNote, t]);

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

  // ── Health-neutral by design ───────────────────────────────────────────────
  // Only catching the star or the cow is reported (it answers the weekly
  // quest). Prompts, jokes, finds and closing any bubble never reach the
  // server, so they can never cost health.
  const reportInteraction = useCallback((interaction: CompanionInteraction) => {
    if (countsForQuest(interaction)) onCatch?.(interaction);
  }, [onCatch]);

  // ── A short line, then the UFO flies a lap round the moon ────────────────
  const flyOffWithLine = useCallback(async () => {
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    clearTimeout(autoDismissRef.current);
    const pooled = await fetchBrainContent(axiosInstance, 'exit', i18n.language, { aiServiceMode, timeoutMs: EXIT_LINE_WAIT_MS });
    if (modeRef.current !== 'idle' && modeRef.current !== 'choice') return; // something else took the stage
    const line = pooled?.text ?? pickExitLine(t);
    setBubbleText(line);
    setAboveOnlyText(line);
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
          }, FLY_RETURN_S * 1000);
        }, FLY_ORBIT_S * 1000);
      }, FLY_APPROACH_S * 1000);
    }, 1500);
  }, [t, axiosInstance, i18n.language, aiServiceMode]);

  // ── Dismiss bubble (✕) — never a vote, never a health effect ─────────────
  const dismissBubble = () => {
    clearTimeout(autoDismissRef.current);
    clearTimeout(exitTimerRef.current);
    if (fromHook && onMessageAction) {
      onMessageAction('close');
      setMode('idle');
      void flyOffWithLine();
      return;
    }
    if (fromHook) onDismiss();
    setMode('idle');
  };

  // ── 👍 / 👎 on a companion message ────────────────────────────────────────
  const voteOnMessage = (action: 'like' | 'dislike') => {
    clearTimeout(autoDismissRef.current);
    onMessageAction?.(action);
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
    reportInteraction('star');
    starCooldownRef.current = setTimeout(() => { starCooldownRef.current = null; }, 30_000);

    // AI-first within a short charge window; fall back to the local pool. Computing
    // the local pick only on miss avoids burning a shuffled item when AI wins.
    const ai = await fetchBrainContent(axiosInstance, 'fact', i18n.language, { aiServiceMode, timeoutMs: 1000 });
    if (ai?.quota) {
      if (modeRef.current !== 'idle') return;
      clearTimeout(autoDismissRef.current);
      setBubbleText(ai.text);
      setFromHook(false);
      setMode('ai_bubble');
      return;
    }
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
  }, [rainbowStarIdx, t, i18n.language, user?.id, mode, axiosInstance, aiServiceMode, reportInteraction]);

  // ── Space cow click → JOKE (AI-first, local fallback) ─────────────────────
  const handleCowClick = useCallback(() => {
    if (cowExiting || mode !== 'idle') return;
    clearTimeout(flyTimerRef.current);
    clearTimeout(fly1Ref.current);
    clearTimeout(fly2Ref.current);
    setFlyPhase(null);
    setCowExiting(true);
    navigator.vibrate?.(200);
    reportInteraction('cow');

    // Local pick first — the guaranteed fallback shown when the cow finishes its
    // ~3s exit animation. The brain fetch runs during that window and overwrites
    // pendingJokeRef if it wins; the joke is only displayed in onAnimationComplete,
    // so there is a single bubble render and zero added latency. The spawner is
    // released in onAnimationComplete via endEntity().
    pendingJokeRef.current = buildItem('joke', { key: getNextKeyFromCycle('joke', user?.id ?? 'anon') });
    pendingQuotaRef.current = null;
    fetchBrainContent(axiosInstance, 'joke', i18n.language, { aiServiceMode })
      .then(res => {
        if (!res) return;
        if (res.quota) pendingQuotaRef.current = res.text;
        else pendingJokeRef.current = buildItem('joke', { text: res.text, translations: res.translations });
      })
      .catch(() => { /* keep local fallback */ });
  }, [cowExiting, i18n.language, user?.id, mode, axiosInstance, aiServiceMode, reportInteraction]);

  // ── Moon tap: ripple, then the saucer tells the AI status ────────────────
  // The moon is also the flight target. The two never meet: the flight runs
  // on the saucer's own timers and positions, and a tap while the saucer is
  // flying (or touring / asking) is ignored, so a status line can't cut in.
  const moonStatus: 'online' | 'offline' | 'checking' =
    aiServiceMode === 'online' ? 'online' : aiServiceMode === 'autonomous' ? 'offline' : 'checking';
  const handleMoonTap = useCallback(() => {
    const busy = () => ['fly_to_moon', 'tour', 'choice'].includes(modeRef.current);
    if (busy()) return;
    setMoonRipple(n => n + 1);
    if (moonStatus === 'checking') return; // nothing to tell yet; the label says "checking"
    clearTimeout(moonTimerRef.current);
    moonTimerRef.current = setTimeout(() => {
      if (busy()) return;
      const line = t(moonStatus === 'online' ? 'companion.moon_online' : 'companion.moon_offline');
      setBubbleText(line);
      setAboveOnlyText(line);
      setFromHook(false);
      setMode('ai_bubble');
    }, reduceMotion ? 150 : 700);
  }, [moonStatus, t, reduceMotion]);

  // ── UFO click: open journal choice ───────────────────────────────────────
  const handleUfoClick = useCallback(() => {
    const cur = modeRef.current;
    if (cur === 'fly_to_moon' || cur === 'tour' || cur === 'choice') return;
    setBubbleText(t('dashboard.tama_journal_prompt'));
    setMode('choice');
  }, [t]);

  // ── Choice: No → short line → moon orbit (health-neutral) ────────────────
  const handleChoiceNo = useCallback(() => {
    reportInteraction('journal_no');
    void flyOffWithLine();
  }, [reportInteraction, flyOffWithLine]);

  // ── Choice: Yes → open journal modal ─────────────────────────────────────
  const handleChoiceYes = useCallback(() => {
    reportInteraction('journal_yes');
    setMode('idle');
    setShowJournal(true);
  }, [reportInteraction]);

  // ── Cleanup all timers on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(flyTimerRef.current);
      clearTimeout(fly1Ref.current);
      clearTimeout(fly2Ref.current);
      clearTimeout(moonTimerRef.current);
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
  const isCell = layout === 'cell';
  // Text bubbles keep the saucer steady (utils/bubbleLayout.ts): above it when
  // that costs at most a small sink, else beside it — saucer left, bubble right.
  const aboveOnly = mode === 'greeting' || aboveOnlyText === bubbleText;
  const placement = inBubble && naturalBubble?.text === bubbleText && widgetW > 0 && widgetH > 0
    ? placeBubble({ screenW: widgetW, screenH: widgetH, bubbleH: naturalBubble.h, ufoHalf, aboveOnly })
    : null;
  // The onboarding tour keeps the 2.23 behaviour: the stacked screen grows to
  // fit it; in a grid cell its text scrolls in the room above the saucer.
  const screenMinH = !isCell && inTour && bubbleH > 0
    ? BUBBLE_TOP_PAD + bubbleH + UFO_GAP + ufoHalf * 2 + HEARTS_BOTTOM
    : undefined;
  const tourMax = isCell && inTour && widgetH > 0
    ? Math.max(40, widgetH - (BUBBLE_TOP_PAD + UFO_GAP + ufoHalf * 2 + HEARTS_BOTTOM))
    : undefined;
  const bubbleMax = placement?.bubbleMaxH ?? tourMax;

  let ufoLeft = '50%';
  let ufoTop = '44%';
  if (placement) {
    ufoLeft = `${(placement.ufoX / widgetW) * 100}%`;
    ufoTop = `${(placement.ufoY / widgetH) * 100}%`;
  } else if (inTour && bubbleH > 0) {
    const screenH = Math.max(screenMinH ?? 0, widgetH > 0 ? widgetH : 100);
    const ufoCenter = BUBBLE_TOP_PAD + Math.min(bubbleH, tourMax ?? bubbleH) + UFO_GAP + ufoHalf;
    ufoTop = `${Math.min((ufoCenter / screenH) * 100, 90)}%`;
  }

  // The text bubble's place and tail: above (tail down, centred) or beside —
  // to the saucer's left, tail pointing right at the saucer's centre.
  let bubbleClass = 'tama-bubble';
  let bubbleStyle: Record<string, string | number> = { x: '-50%' };
  bubbleClass += aboveOnly || bubbleText.length <= SHORT_BUBBLE_CHARS ? ' tama-bubble--short' : ' tama-bubble--long';
  if (placement?.kind === 'above') {
    bubbleStyle = { x: '-50%', top: placement.bubbleTop };
  } else if (placement?.kind === 'side') {
    const h = bubbleH || naturalBubble?.h || 0;
    const top = sideBubbleTop(placement.ufoY, h, widgetH);
    const tailY = Math.max(14, Math.min(placement.ufoY - top, h - 14));
    bubbleClass += ' tama-bubble--side';
    bubbleStyle = { x: 0, left: 'auto', right: widgetW - placement.bubbleRight, top, maxWidth: placement.bubbleMaxW, '--tama-tail-y': `${tailY}px` };
  }

  const screenStyle: React.CSSProperties & Record<'--tama-bubble-max', string | undefined> = {
    minHeight: screenMinH ? `${screenMinH}px` : undefined,
    '--tama-bubble-max': bubbleMax ? `${bubbleMax}px` : undefined,
  };

  return (
    <>
    {/* The device: a card with the cosmos screen set into it (bezel, glass). */}
    <div className={`tama-device tama-device--${layout}`}>
    <div
      className="tama-screen"
      ref={widgetRef}
      style={screenStyle}
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
              tabIndex={rainbowStarIdx === i ? 0 : undefined}
              aria-label={rainbowStarIdx === i ? t('companion.catch_star') : undefined}
              onKeyDown={rainbowStarIdx === i ? (ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); void handleStarClick(i); }
              }) : undefined}
            >
              <div
                className={`tama-star${rainbowStarIdx === i ? ' tama-star--rainbow' : ''}`}
                style={{ animationDelay: `${s.d}s` }}
              />
            </div>
          ))}
        </div>

        {/* ── Moon (always persistent — the fly_to_moon target). Tapping it
             sends a soft ripple and the saucer tells the AI's status. ── */}
        <div className={`tama-moon tama-moon--${moonStatus}`}>
          <button
            type="button"
            className="tama-moon-btn"
            onClick={handleMoonTap}
            aria-label={t(`companion.moon_aria_${moonStatus}`)}
          >
            <CraterMoon />
          </button>
          {moonRipple > 0 && (
            <span key={moonRipple} className="tama-moon-ripples" aria-hidden="true">
              <span /><span />
            </span>
          )}
        </div>

        {/* ── Space cow ── */}
        <AnimatePresence>
          {cowVisible && (
            <motion.div
              key={cowKey}
              className={`tama-space-cow${cowExiting ? ' tama-space-cow--exiting' : ''}`}
              style={{ top: `${cowTop}%` }}
              initial={reduceMotion ? { left: '68%', opacity: 0 } : { left: '-15%', scale: 1, opacity: 1 }}
              animate={reduceMotion
                ? (cowExiting ? { opacity: 0 } : { opacity: [0, 1, 1, 0] })
                : cowExiting
                  ? { left: '82%', top: '8%', scale: [1, 1.2, 0.05], opacity: [1, 1, 0] }
                  : { left: '115%' }
              }
              transition={reduceMotion
                ? (cowExiting ? { duration: 0.3 } : { duration: 18, times: [0, 0.03, 0.95, 1] })
                : cowExiting
                  ? {
                      duration: 3.0,
                      times: [0, 0.033, 1],
                      left: { delay: 0.1, duration: 2.9, ease: [0.4, 0, 1, 1] },
                      top:  { delay: 0.1, duration: 2.9, ease: [0.4, 0, 1, 1] },
                    }
                  : { duration: 18, ease: 'linear' }
              }
              onAnimationComplete={() => {
                if (cowExiting && pendingQuotaRef.current) {
                  // Today's two jokes are done: the cow says so (not a find).
                  clearTimeout(autoDismissRef.current);
                  setBubbleText(pendingQuotaRef.current);
                  setFromHook(false);
                  setMode('ai_bubble');
                  pendingQuotaRef.current = null;
                  pendingJokeRef.current = null;
                } else if (cowExiting && pendingJokeRef.current) {
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
              tabIndex={cowExiting ? -1 : 0}
              aria-label={t('companion.catch_cow')}
              onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleCowClick(); }
              }}
            >
              <CompanionCow />
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
              tabIndex={0}
              aria-label={t('dashboard.tama_cal_label')}
              onKeyDown={ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleCalendarClick(); }
              }}
            >
              <CalendarArt />
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
              ? { left: ufoLeft, top: ufoTop, scale: 1 }
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
                ? { duration: FLY_ORBIT_S, ease: 'easeInOut' }
                : flyPhase === 'return'
                  ? { duration: FLY_RETURN_S, ease: [0.42, 0, 0.58, 1] }
                  : { duration: FLY_APPROACH_S, ease: [0.25, 0.1, 0.25, 1] }
          }
          onClick={handleUfoClick}
        >
          <div className="tama-ufo-bob">
            <CompanionUfo />
          </div>
        </motion.div>

        {/* ── Health: bar + % + mood in words; tap explains why ── */}
        {health !== undefined && mood && (
          <CompanionHealthMeter health={health} mood={mood} reason={reasonText ?? ''} onExplain={explainHealth} />
        )}

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
                {/* HTML, not SVG text: it wraps and stays readable at any size. */}
                <p className="tama-thought-text">{t('dashboard.tama_journal_prompt')}</p>
              </motion.div>

              <motion.div
                key="choice-zones"
                style={{ position: 'absolute', inset: 0 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div
                  className="tama-zone tama-zone--red"
                  onClick={handleChoiceNo}
                  role="button"
                  tabIndex={0}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleChoiceNo(); } }}
                >
                  <span><span aria-hidden="true">✗ </span>{t('dashboard.tama_choice_no')}</span>
                </div>
                <div
                  className="tama-zone tama-zone--green"
                  onClick={handleChoiceYes}
                  role="button"
                  tabIndex={0}
                  onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handleChoiceYes(); } }}
                >
                  <span><span aria-hidden="true">✓ </span>{t('dashboard.tama_choice_yes')}</span>
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
            className={bubbleClass}
            style={bubbleStyle}
            initial={{ opacity: 0, scale: 0.88, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 6 }}
            transition={{ duration: 0.2 }}
          >
            <p className="tama-bubble-text">{bubbleText}</p>
            {fromHook && onMessageAction && (
              <div className="tama-bubble-votes">
                <button type="button" className="tama-vote" onClick={() => voteOnMessage('like')} aria-label={t('companion.vote_like')} title={t('companion.vote_like')}>
                  <span aria-hidden="true">👍</span>
                </button>
                <button type="button" className="tama-vote" onClick={() => voteOnMessage('dislike')} aria-label={t('companion.vote_dislike')} title={t('companion.vote_dislike')}>
                  <span aria-hidden="true">👎</span>
                </button>
              </div>
            )}
            <button className="tama-bubble-close" onClick={dismissBubble} aria-label={t('companion.close')}>✕</button>
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

    </div>

    <TamagotchiJournalModal
      open={showJournal}
      userId={user?.id ?? 'anon'}
      onClose={() => setShowJournal(false)}
    />
    </>
  );
};

export default TamagotchiWidget;
