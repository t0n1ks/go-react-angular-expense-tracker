import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ─── Weekly tier fingerprint ──────────────────────────────────────────────────

const SESSION_KEY = 'ai_advice_session';

// ─── Cooldown-based advice pacing ──────────────────────────────────────────────
// Budget advice should never fire on every transaction. It surfaces only when a
// cooldown has elapsed OR a transaction significantly impacts the cycle.
const ADVICE_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h
const SIGNIFICANT_FRACTION = 0.25;             // single expense ≥ 25% of weekly allowance

function adviceCooldownKey(userId?: number): string {
  return `tama_advice_cooldown_${userId ?? 'anon'}`;
}

function adviceCooldownElapsed(userId?: number): boolean {
  try {
    const raw = localStorage.getItem(adviceCooldownKey(userId));
    if (!raw) return true;
    const ts = Number(raw);
    return !Number.isFinite(ts) || Date.now() - ts >= ADVICE_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markAdviceShown(userId?: number): void {
  try { localStorage.setItem(adviceCooldownKey(userId), String(Date.now())); } catch { /* ignore */ }
}

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
  type: 'expense' | 'income' | 'savings_deposit' | 'savings_withdrawal';
  income_type?: string;
  date: string;
  category?: { name: string };
}

interface QueueItem { text: string; hint?: string | null; }

interface Options {
  transactions: Transaction[];
  aiAdviceEnabled: boolean;
  monthlySpendingGoal: number;
  currencySymbol: string;
  axiosInstance: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (url: string) => Promise<{ data: any }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: (url: string, data?: unknown) => Promise<{ data: any }>;
  };
  language: string;
  aiServiceMode: 'online' | 'autonomous' | 'initializing';
  userId?: number;
}

export function useAIAssistant({
  transactions,
  aiAdviceEnabled,
  monthlySpendingGoal,
  axiosInstance,
  language,
  aiServiceMode,
  userId,
}: Options) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [currentHint, setCurrentHint] = useState<string | null>(null);

  const enqueue = useCallback((item: QueueItem) => {
    setQueue(q => (q.length < 2 ? [...q, item] : q));
  }, []);

  // Pick without repeating: tracks seen indices per key in sessionStorage
  const pickFromKey = useCallback((key: string, percent?: number): string | null => {
    const pool = t(`ai.${key}`, { returnObjects: true }) as string[];
    if (!Array.isArray(pool) || pool.length === 0) return null;
    const seenKey = `ai_seen_idx_${key}`;
    let seen: number[];
    try {
      seen = JSON.parse(sessionStorage.getItem(seenKey) ?? '[]') as number[];
    } catch { seen = []; }
    const available = pool.map((_, i) => i).filter(i => !seen.includes(i));
    const candidates = available.length > 0 ? available : pool.map((_, i) => i);
    if (available.length === 0) seen = [];
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    seen.push(idx);
    try { sessionStorage.setItem(seenKey, JSON.stringify(seen)); } catch { /* ignore */ }
    const raw = pool[idx];
    return percent !== undefined ? raw.replace(/\{\{percent\}\}/g, String(percent)) : raw;
  }, [t]);

  // ── Brain fetch (primary source when service is online) ──────────────────
  useEffect(() => {
    if (!aiAdviceEnabled || aiServiceMode !== 'online') return;
    const fetch = () => {
      axiosInstance.get(`/ai/next-action?language=${language}`)
        .then(res => {
          const { type, content, animation_hint } = res.data as {
            type: string; content: string | null; animation_hint: string | null;
          };
          if (!type || type === 'NONE' || !content) return;
          // Strict separation: jokes come only from the Cow, facts only from the
          // Star. The proactive channel carries advice/greetings/encouragements.
          if (type === 'JOKE' || type === 'FACT') return;
          // Cooldown-based pacing for budget advice — at most once per window.
          if (type === 'ADVICE') {
            if (!adviceCooldownElapsed(userId)) return;
            markAdviceShown(userId);
          }
          enqueue({ text: content, hint: animation_hint ?? null });
        })
        .catch(() => { /* silent — autonomous fallback handles proactive messages */ });
    };
    fetch();
    const id = setInterval(fetch, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [aiAdviceEnabled, aiServiceMode, language, axiosInstance, enqueue, userId]);

  // ── Weekly pacing analysis (autonomous fallback only) ────────────────────
  useEffect(() => {
    if (!aiAdviceEnabled || transactions.length === 0) return;
    if (aiServiceMode === 'online') return; // Brain handles proactive content when service is reachable

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

    // Cooldown-based pacing: only surface advice on a significant transaction (a
    // single expense ≥ 25% of the weekly allowance, or the week already over
    // budget) or once the cooldown has elapsed. Otherwise stay quiet.
    const maxSingleExpense = thisWeekExp.reduce((m, tx) => Math.max(m, Math.abs(Number(tx.amount))), 0);
    const significant = weeklyLimit > 0
      && (maxSingleExpense >= weeklyLimit * SIGNIFICANT_FRACTION || weekSpending > weeklyLimit);
    if (!significant && !adviceCooldownElapsed(userId)) return;

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

    if (msg) {
      enqueue({ text: msg });
      markAdviceShown(userId);
    }
  }, [transactions, aiAdviceEnabled, monthlySpendingGoal, aiServiceMode, enqueue, pickFromKey, userId]);

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
  }, []);

  return { message: currentMessage, hasMessage: currentMessage !== null, animationHint: currentHint, dismiss };
}
