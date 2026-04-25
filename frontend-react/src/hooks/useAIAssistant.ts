import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// ─── Shuffle pool (idle humor) ───────────────────────────────────────────────

const SHOWN_KEY = 'ai_shown_items';

interface PoolItem {
  id: string;
  text: string;
}

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
  } catch {
    return new Set();
  }
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

// ─── Session memory (financial advice) ───────────────────────────────────────

const SESSION_KEY = 'ai_advice_session';

function getSessionFingerprint(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function saveSessionFingerprint(fp: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, fp);
  } catch { /* ignore */ }
}

function computeFingerprint(
  totalExp: number,
  totalInc: number,
  goal: number,
  topCatShare: number,
  totalLast: number,
): string {
  return [
    Math.round(totalExp),
    Math.round(totalInc),
    Math.round(goal),
    Math.round(topCatShare * 100),
    Math.round(totalLast),
  ].join(':');
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface Transaction {
  amount: number;
  type: 'expense' | 'income';
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
  currencySymbol,
}: Options) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<string[]>([]);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enqueue = useCallback((msg: string) => {
    setQueue(q => (q.length < 2 ? [...q, msg] : q));
  }, []);

  // ── Financial analysis ────────────────────────────────────────────────────
  // Runs whenever transactions or settings change.
  // Picks at most ONE insight (priority cascade), skips if data hasn't changed
  // since the last shown insight this session.
  useEffect(() => {
    if (!aiAdviceEnabled || transactions.length === 0) return;

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    const thisMonthExp = transactions.filter(tx => {
      const d = new Date(tx.date);
      return tx.type === 'expense' && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const lastMonthExp = transactions.filter(tx => {
      const d = new Date(tx.date);
      return tx.type === 'expense' && d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    });
    const thisMonthInc = transactions.filter(tx => {
      const d = new Date(tx.date);
      return tx.type === 'income' && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });

    const totalExp = thisMonthExp.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
    const totalLast = lastMonthExp.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
    const totalInc = thisMonthInc.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
    const surplus = totalInc - totalExp;

    // Build category map for fingerprint + category alert
    let topCatShare = 0;
    let topCatName = '';
    if (thisMonthExp.length > 0 && totalExp > 0) {
      const catMap: Record<string, number> = {};
      thisMonthExp.forEach(tx => {
        const name = tx.category?.name || '—';
        catMap[name] = (catMap[name] || 0) + Math.abs(Number(tx.amount));
      });
      const top = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
      if (top) { topCatShare = top[1] / totalExp; topCatName = top[0]; }
    }

    // Skip if the same numbers were already analyzed this session
    const fingerprint = computeFingerprint(totalExp, totalInc, monthlySpendingGoal, topCatShare, totalLast);
    if (getSessionFingerprint() === fingerprint) return;
    saveSessionFingerprint(fingerprint);

    // Priority cascade — exactly ONE insight fires per unique data state
    let msg: string | null = null;

    if (monthlySpendingGoal > 0 && totalExp >= 0.8 * monthlySpendingGoal) {
      msg = t('ai.goal_alert', { percent: Math.round((totalExp / monthlySpendingGoal) * 100) });
    } else if (totalInc === 0 && totalExp > 0) {
      const percent = monthlySpendingGoal > 0
        ? Math.round((totalExp / monthlySpendingGoal) * 100)
        : 100;
      msg = t('ai.worried_no_income', { percent });
    } else if (surplus > 0 && totalInc > 0 && (monthlySpendingGoal === 0 || surplus > monthlySpendingGoal * 0.3)) {
      msg = t('ai.invest_surplus', { surplus: `${currencySymbol}${Math.round(surplus).toLocaleString()}` });
    } else if (topCatShare > 0.5) {
      msg = t('ai.category_alert', { category: topCatName, percent: Math.round(topCatShare * 100) });
    } else if (totalLast > 0 && totalExp < totalLast) {
      msg = t('ai.savings_compliment', { percent: Math.round(((totalLast - totalExp) / totalLast) * 100) });
    }

    if (msg) enqueue(msg);
  }, [transactions, aiAdviceEnabled, monthlySpendingGoal, currencySymbol, t, enqueue]);

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
