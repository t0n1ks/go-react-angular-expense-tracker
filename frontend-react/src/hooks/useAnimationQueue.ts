import { useState, useCallback } from 'react';

export interface AnimationItem {
  id: string;
  type: string;           // 'JOKE' | 'FACT' | 'ADVICE' | 'RANDOM_ANIMATION'
  content?: string;
  animationHint?: string; // 'COW_ABDUCTION' | 'COIN_COLLECT' | 'FLY_BY_MOON'
}

interface QueueState {
  active: AnimationItem | null;
  queue: AnimationItem[];
}

interface UseAnimationQueueReturn {
  activeAnimation: AnimationItem | null;
  enqueue: (item: AnimationItem) => void;
  completeAnimation: () => void;
}

export function useAnimationQueue(): UseAnimationQueueReturn {
  const [state, setState] = useState<QueueState>({ active: null, queue: [] });

  const enqueue = useCallback((item: AnimationItem) => {
    setState(s => {
      if (s.active === null) return { ...s, active: item };
      if (s.queue.some(q => q.id === item.id) || s.queue.length >= 4) return s;
      return { ...s, queue: [...s.queue, item] };
    });
  }, []);

  const completeAnimation = useCallback(() => {
    setState(s => {
      const [next, ...rest] = s.queue;
      return { active: next ?? null, queue: rest };
    });
  }, []);

  return { activeAnimation: state.active, enqueue, completeAnimation };
}
