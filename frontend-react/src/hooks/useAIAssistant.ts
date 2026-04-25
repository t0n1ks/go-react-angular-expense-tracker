import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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
  // Fall back to full pool if nothing available (shouldn't happen with 80% reset, but safe)
  const source = available.length > 0 ? available : pool;
  const picked = source[Math.floor(Math.random() * source.length)];

  const newShown = new Set(shown);
  newShown.add(picked.id);
  // Reset once 80% of the library has been shown
  if (newShown.size >= pool.length * 0.8) {
    localStorage.removeItem(SHOWN_KEY);
  } else {
    localStorage.setItem(SHOWN_KEY, JSON.stringify([...newShown]));
  }

  return picked;
}

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
  const hasAnalyzed = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enqueue = useCallback((msg: string) => {
    setQueue(q => (q.length < 2 ? [...q, msg] : q));
  }, []);

  // Financial analysis — runs once per Dashboard mount after transactions load
  useEffect(() => {
    if (!aiAdviceEnabled || hasAnalyzed.current || transactions.length === 0) return;
    hasAnalyzed.current = true;

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

    // 1. Goal tracking: spending ≥ 80% of monthly goal
    if (monthlySpendingGoal > 0 && totalExp >= 0.8 * monthlySpendingGoal) {
      const percent = Math.round((totalExp / monthlySpendingGoal) * 100);
      enqueue(t('ai.goal_alert', { percent }));
    }

    // 2. No income recorded but spending exists — worried mode
    if (totalInc === 0 && totalExp > 0) {
      const percent = monthlySpendingGoal > 0
        ? Math.round((totalExp / monthlySpendingGoal) * 100)
        : 100;
      enqueue(t('ai.worried_no_income', { percent }));
    }

    // 3. Surplus with income — suggest investing
    if (surplus > 0 && totalInc > 0 && (monthlySpendingGoal === 0 || surplus > monthlySpendingGoal * 0.3)) {
      const formatted = `${currencySymbol}${Math.round(surplus).toLocaleString()}`;
      enqueue(t('ai.invest_surplus', { surplus: formatted }));
    }

    // 4. Category dominance: one category > 50% of this month's expenses
    if (thisMonthExp.length > 0 && totalExp > 0) {
      const catMap: Record<string, number> = {};
      thisMonthExp.forEach(tx => {
        const name = tx.category?.name || '—';
        catMap[name] = (catMap[name] || 0) + Math.abs(Number(tx.amount));
      });
      const top = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] / totalExp > 0.5) {
        const percent = Math.round((top[1] / totalExp) * 100);
        enqueue(t('ai.category_alert', { category: top[0], percent }));
      }
    }

    // 5. Savings compliment: spending lower than last month
    if (totalLast > 0 && totalExp < totalLast) {
      const percent = Math.round(((totalLast - totalExp) / totalLast) * 100);
      enqueue(t('ai.savings_compliment', { percent }));
    }
  }, [transactions, aiAdviceEnabled, monthlySpendingGoal, currencySymbol, t, enqueue]);

  // Idle humor timer: fires after 45s of inactivity
  useEffect(() => {
    if (!aiHumorEnabled) return;

    const fire = () => {
      const humor = t('ai.humor', { returnObjects: true }) as string[];
      const facts = t('ai.facts', { returnObjects: true }) as string[];
      const tips = t('ai.tips', { returnObjects: true }) as string[];
      const pool = buildPool(humor, facts, tips);
      const picked = pickRandom(pool);
      enqueue(picked.text);
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

  // Dequeue: promote first item from queue to currentMessage when slot is free
  useEffect(() => {
    if (currentMessage === null && queue.length > 0) {
      setCurrentMessage(queue[0]);
      setQueue(q => q.slice(1));
    }
  }, [currentMessage, queue]);

  const dismiss = useCallback(() => setCurrentMessage(null), []);

  return { message: currentMessage, hasMessage: currentMessage !== null, dismiss };
}
