import { useState, useEffect, useCallback } from 'react';

// Ambient companion lines from the AI service (greetings, encouragements),
// polled every 10 minutes. Financial reactions (pace, overspending, big
// expenses, payday…) are NOT decided here any more: the server's companion
// engine owns them (see useCompanion / GET /api/companion/state), so the UFO
// has one source of truth and can never contradict the dashboard. Jokes and
// facts come only from the cow and the star.

interface QueueItem { text: string; hint?: string | null; }

interface Options {
  aiAdviceEnabled: boolean;
  axiosInstance: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (url: string) => Promise<{ data: any }>;
  };
  language: string;
  aiServiceMode: 'online' | 'autonomous' | 'initializing';
}

// Ambient types the proactive channel shows; everything else has its own home.
const AMBIENT_TYPES = new Set(['GREETING', 'ENCOURAGEMENT']);

export function useAIAssistant({
  aiAdviceEnabled,
  axiosInstance,
  language,
  aiServiceMode,
}: Options) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [currentHint, setCurrentHint] = useState<string | null>(null);

  const enqueue = useCallback((item: QueueItem) => {
    setQueue(q => (q.length < 2 ? [...q, item] : q));
  }, []);

  useEffect(() => {
    if (!aiAdviceEnabled || aiServiceMode !== 'online') return;
    const fetch = () => {
      axiosInstance.get(`/ai/next-action?language=${language}`)
        .then(res => {
          const { type, content, animation_hint } = res.data as {
            type: string; content: string | null; animation_hint: string | null;
          };
          if (!AMBIENT_TYPES.has(type) || !content) return;
          enqueue({ text: content, hint: animation_hint ?? null });
        })
        .catch(() => { /* silent — the companion engine still speaks */ });
    };
    fetch();
    const id = setInterval(fetch, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [aiAdviceEnabled, aiServiceMode, language, axiosInstance, enqueue]);

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
