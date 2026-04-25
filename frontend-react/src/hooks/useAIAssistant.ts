import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

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
  const hasAnalyzed = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enqueue = useCallback((msg: string) => {
    setQueue(q => (q.length < 2 ? [...q, msg] : q));
  }, []);

  useEffect(() => {
    if (!aiAdviceEnabled || hasAnalyzed.current || transactions.length === 0) return;
    hasAnalyzed.current = true;

    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;

    const expenses = transactions.filter(tx => tx.type === 'expense');

    const thisMonthExp = expenses.filter(tx => {
      const d = new Date(tx.date);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const lastMonthExp = expenses.filter(tx => {
      const d = new Date(tx.date);
      return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
    });

    const totalThis = thisMonthExp.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);
    const totalLast = lastMonthExp.reduce((s, tx) => s + Math.abs(Number(tx.amount)), 0);

    if (monthlySpendingGoal > 0 && totalThis >= 0.8 * monthlySpendingGoal) {
      const percent = Math.round((totalThis / monthlySpendingGoal) * 100);
      enqueue(t('ai.goal_alert', { percent }));
    }

    if (thisMonthExp.length > 0 && totalThis > 0) {
      const catMap: Record<string, number> = {};
      thisMonthExp.forEach(tx => {
        const name = tx.category?.name || '—';
        catMap[name] = (catMap[name] || 0) + Math.abs(Number(tx.amount));
      });
      const top = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] / totalThis > 0.5) {
        const percent = Math.round((top[1] / totalThis) * 100);
        enqueue(t('ai.category_alert', { category: top[0], percent }));
      }
    }

    if (totalLast > 0 && totalThis < totalLast) {
      const percent = Math.round(((totalLast - totalThis) / totalLast) * 100);
      enqueue(t('ai.savings_compliment', { percent }));
    }
  }, [transactions, aiAdviceEnabled, monthlySpendingGoal, t, enqueue]);

  useEffect(() => {
    if (!aiHumorEnabled) return;
    const resetTimer = () => {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        const jokes = t('ai.humor', { returnObjects: true }) as string[];
        const joke = jokes[Math.floor(Math.random() * jokes.length)];
        enqueue(joke);
      }, 45_000);
    };
    resetTimer();
    const events = ['mousemove', 'click', 'keydown'] as const;
    events.forEach(e => window.addEventListener(e, resetTimer));
    return () => {
      clearTimeout(idleTimer.current);
      events.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [aiHumorEnabled, t, enqueue]);

  useEffect(() => {
    if (currentMessage === null && queue.length > 0) {
      setCurrentMessage(queue[0]);
      setQueue(q => q.slice(1));
    }
  }, [currentMessage, queue]);

  const dismiss = useCallback(() => setCurrentMessage(null), []);

  return { message: currentMessage, hasMessage: currentMessage !== null, dismiss };
}
