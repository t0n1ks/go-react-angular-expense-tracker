import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ─── Idle humor shuffle pool ──────────────────────────────────────────────────

const SHOWN_KEY = 'ai_shown_items';

interface PoolItem { id: string; text: string; }

function buildPool(humor: string[], facts: string[], tips: string[]): PoolItem[] {
  return [
    ...humor.map((text, i) => ({ id: `humor_${i}`, text })),
    ...facts.map((text, i) => ({ id: `facts_${i}`, text })),
    ...tips.map((text, i) => ({ id: `tips_${i}`, text })),
  ];
}

function getShown(): Set<string> {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch { return new Set(); }
}

function pickRandom(pool: PoolItem[]): PoolItem {
  const shown = getShown();
  const available = pool.filter(item => !shown.has(item.id));
  const source = available.length > 0 ? available : pool;
  const picked = source[Math.floor(Math.random() * source.length)];
  const newShown = new Set(shown);
  newShown.add(picked.id);
  if (newShown.size >= pool.length * 0.8) {
    localStorage.removeItem(SHOWN_KEY);
  } else {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...newShown]));
  }
  return picked;
}

// ─── Weekly tier fingerprint ──────────────────────────────────────────────────

const SESSION_KEY = 'ai_advice_session';

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getWeekKey(d: Date): string {
  const m = getMonday(d);
  return `${m.getFullYear()}-${m.getMonth()}-${m.getDate()}`;
}

function getStoredFp(): string | null {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

function storeFp(fp: string): void {
  try { sessionStorage.setItem(SESSION_KEY, fp); } catch { /* ignore */ }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface Transaction {
  amount: number;
  type: 'expense' | 'income';
  income_type?: string;
  date: string;
  category?: { name: string };
}

interface Options {
  transactions: Transaction[];
  aiAdviceEnabled: boolean;
  aiHumorEnabled: boolean;
  monthlySpendingGoal: number;
  currencySymbol: string;
}

export function useAIAssistant({
  transactions,
  aiAdviceEnabled,
  aiHumorEnabled,
  monthlySpendingGoal,
}: Options) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<string[]>([]);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enqueue = useCallback((msg: string) => {
    setQueue(q => (q.length < 2 ? [...q, msg] : q));
  }, []);

  // Pick a random item from a locale array key, with optional {{percent}} interpolation
  const pickFromKey = useCallback((key: string, percent?: number): string | null => {
    const pool = t(`ai.${key}`, { returnObjects: true }) as string[];
    if (!Array.isArray(pool) || pool.length === 0) return null;
    const raw = pool[Math.floor(Math.random() * pool.length)];
    return percent !== undefined ? raw.replace(/\{\{percent\}\}/g, String(percent)) : raw;
  }, [t]);

  // ── Weekly pacing analysis ────────────────────────────────────────────────
  useEffect(() => {
    if (!aiAdviceEnabled || transactions.length === 0) return;

    const now = new Date();
    const monday = getMonday(now);
    const weekKey = getWeekKey(now);

    // This week's expense transactions
    const thisWeekExp = transactions.filter(tx => {
      const d = new Date(tx.date);
      return tx.type === 'expense' && d >= monday;
    });
    const weekSpending = thisWeekExp.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);

    // Did a full-salary income arrive in the last 3 days?
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const salaryJustIn = transactions.some(tx =>
      tx.type === 'income' &&
      (!tx.income_type || tx.income_type === 'one_time') &&
      new Date(tx.date) >= threeDaysAgo,
    );

    // Category balance: 2+ categories, no single one > 45% of week spending
    const catMap: Record<string, number> = {};
    thisWeekExp.forEach(tx => {
      const cat = tx.category?.name ?? 'other';
      catMap[cat] = (catMap[cat] || 0) + Math.abs(Number(tx.amount));
    });
    const catCount = Object.keys(catMap).length;
    const maxShare = weekSpending > 0 && catCount > 0
      ? Math.max(...Object.values(catMap)) / weekSpending
      : 0;
    const isBalanced = catCount >= 2 && maxShare < 0.45;

    // Weekly pacing
    const weeklyLimit = monthlySpendingGoal > 0 ? monthlySpendingGoal / 4.3 : 0;
    const pace = weeklyLimit > 0 ? weekSpending / weeklyLimit : 0;
    const dayOfWeek = now.getDay(); // 0=Sun
    const isPastWednesday = dayOfWeek === 0 || dayOfWeek >= 3;

    // Determine tier (priority order)
    type Tier = 'salary_just_in' | 'pacing_over' | 'pacing_warn' | 'pacing_great' | 'balanced' | 'pacing_good';
    let tier: Tier | null = null;

    if (salaryJustIn) {
      tier = 'salary_just_in';
    } else if (weeklyLimit > 0 && pace > 1.2) {
      tier = 'pacing_over';
    } else if (weeklyLimit > 0 && pace > 0.8) {
      tier = 'pacing_warn';
    } else if (weeklyLimit > 0 && pace < 0.5 && isPastWednesday && weekSpending > 0) {
      tier = 'pacing_great';
    } else if (isBalanced && weekSpending > 0 && pace < 0.8) {
      tier = 'balanced';
    } else if (weeklyLimit > 0 && weekSpending > 0 && pace < 0.8) {
      tier = 'pacing_good';
    }

    if (!tier) return;

    // Only fire if the tier changed this session/week
    const fp = `${weekKey}:${tier}:s${salaryJustIn ? 1 : 0}`;
    if (getStoredFp() === fp) return;
    storeFp(fp);

    // Pick message
    let msg: string | null = null;
    if (tier === 'pacing_over') {
      const percentOver = Math.round((pace - 1) * 100);
      msg = pickFromKey('pacing_over', percentOver);
    } else {
      msg = pickFromKey(tier);
    }

    if (msg) enqueue(msg);
  }, [transactions, aiAdviceEnabled, monthlySpendingGoal, enqueue, pickFromKey]);

  // ── Idle humor timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!aiHumorEnabled) return;

    const fire = () => {
      const humor = t('ai.humor', { returnObjects: true }) as string[];
      const facts = t('ai.facts', { returnObjects: true }) as string[];
      const tips = t('ai.tips', { returnObjects: true }) as string[];
      enqueue(pickRandom(buildPool(humor, facts, tips)).text);
    };

    const resetTimer = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(fire, 45_000);
    };

    resetTimer();
    const events = ['mousemove', 'click', 'keydown'] as const;
    events.forEach(e => window.addEventListener(e, resetTimer));
    return () => {
      clearTimeout(idleTimer.current);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [aiHumorEnabled, t, enqueue]);

  // ── Dequeue ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (currentMessage === null && queue.length > 0) {
      setCurrentMessage(queue[0]);
      setQueue(q => q.slice(1));
    }
  }, [currentMessage, queue]);

  const dismiss = useCallback(() => setCurrentMessage(null), []);

  return { message: currentMessage, hasMessage: currentMessage !== null, dismiss };
}
