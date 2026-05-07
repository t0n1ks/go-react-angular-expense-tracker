import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ─── Fact history ─────────────────────────────────────────────────────────────

const FACT_HISTORY_MAX = 8;

interface QueueItem { text: string; hint?: string | null; }

function storeFact(text: string): void {
  try {
    const key = `tama_fact_history_${new Date().toISOString().split('T')[0]}`;
    const raw = localStorage.getItem(key);
    const existing: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (existing.includes(text)) return;
    const updated = [...existing, text].slice(-FACT_HISTORY_MAX);
    localStorage.setItem(key, JSON.stringify(updated));
  } catch { /* ignore */ }
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
  axiosInstance: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (url: string) => Promise<{ data: any }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: (url: string, data?: unknown) => Promise<{ data: any }>;
  };
}

export function useAIAssistant({
  transactions,
  aiAdviceEnabled,
  aiHumorEnabled,
  monthlySpendingGoal,
  axiosInstance,
}: Options) {
  const { t, i18n } = useTranslation();
  // Derive language from i18n directly so it stays reactive on every language switch.
  // resolvedLanguage is always a bare code like 'uk'; language may be 'uk-UA'.
  const effectiveLang = i18n.resolvedLanguage ?? i18n.language?.split('-')[0] ?? 'en';
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [currentHint, setCurrentHint] = useState<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstFired = useRef(false);
  const fireRef = useRef<(() => void) | null>(null);

  const enqueue = useCallback((item: QueueItem) => {
    setQueue(q => (q.length < 2 ? [...q, item] : q));
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

    const thisWeekExp = transactions.filter(tx => {
      const d = new Date(tx.date);
      return tx.type === 'expense' && d >= monday;
    });
    const weekSpending = thisWeekExp.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);

    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const salaryJustIn = transactions.some(tx =>
      tx.type === 'income' &&
      (!tx.income_type || tx.income_type === 'one_time') &&
      new Date(tx.date) >= threeDaysAgo,
    );

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

    const weeklyLimit = monthlySpendingGoal > 0 ? monthlySpendingGoal / 4.3 : 0;
    const pace = weeklyLimit > 0 ? weekSpending / weeklyLimit : 0;
    const dayOfWeek = now.getDay();
    const isPastWednesday = dayOfWeek === 0 || dayOfWeek >= 3;

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

    const fp = `${weekKey}:${tier}:s${salaryJustIn ? 1 : 0}`;
    if (getStoredFp() === fp) return;
    storeFp(fp);

    let msg: string | null = null;
    if (tier === 'pacing_over') {
      const percentOver = Math.round((pace - 1) * 100);
      msg = pickFromKey('pacing_over', percentOver);
    } else {
      msg = pickFromKey(tier);
    }

    if (msg) enqueue({ text: msg });
  }, [transactions, aiAdviceEnabled, monthlySpendingGoal, enqueue, pickFromKey]);

  // ── Idle humor timer — first fire at 25 s, then 60 s idle after dismiss ──
  useEffect(() => {
    if (!aiHumorEnabled) return;

    let cancelled = false;
    firstFired.current = false;

    const doFire = async () => {
      try {
        const res = await axiosInstance.get(`/ai/next-action?language=${effectiveLang}`);
        if (cancelled) return;
        const data = res.data as { type: string; content: string; animation_hint?: string };
        if (!data.content?.trim()) return;
        enqueue({ text: data.content, hint: data.animation_hint ?? null });
        if (data.type === 'FACT') {
          storeFact(data.content);
        }
      } catch {
        // Python service unavailable — remain silent, no fallback text
      }
    };

    fireRef.current = () => void doFire();

    // First fire: guaranteed after 25 s regardless of activity
    idleTimer.current = setTimeout(() => {
      firstFired.current = true;
      void doFire();
    }, 25_000);

    // After first fire, activity resets the 60 s idle timer
    const resetIdle = () => {
      if (!firstFired.current) return;
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => void doFire(), 60_000);
    };

    const events = ['mousemove', 'click', 'keydown'] as const;
    events.forEach(e => window.addEventListener(e, resetIdle));

    return () => {
      cancelled = true;
      clearTimeout(idleTimer.current);
      events.forEach(e => window.removeEventListener(e, resetIdle));
    };
  }, [aiHumorEnabled, effectiveLang, enqueue, axiosInstance]);

  // ── Dequeue ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (currentMessage === null && queue.length > 0) {
      setCurrentMessage(queue[0].text);
      setCurrentHint(queue[0].hint ?? null);
      setQueue(q => q.slice(1));
    }
  }, [currentMessage, queue]);

  const dismiss = useCallback(() => {
    setCurrentMessage(null);
    setCurrentHint(null);
    // Restart 60 s idle timer after user dismisses a message
    if (firstFired.current && fireRef.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(fireRef.current, 60_000);
    }
  }, []);

  return { message: currentMessage, hasMessage: currentMessage !== null, animationHint: currentHint, dismiss };
}
