import { useState, useEffect, useCallback } from 'react';

// Ambient companion lines from the AI service (greetings, a tip at most once a
// day, encouragements),
// polled every 10 minutes. Financial reactions (pace, overspending, big
// expenses, payday…) are NOT decided here any more: the server's companion
// engine owns them (see useCompanion / GET /api/companion/state), so the UFO
// has one source of truth and can never contradict the dashboard. Jokes and
// facts come only from the cow and the star.

interface QueueItem { text: string; hint?: string | null; }

interface Options {
  // Which ambient types may be shown (utils/aiGate); null → none, nothing
  // is requested.
  ambientTypes: ReadonlySet<string> | null;
  axiosInstance: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (url: string) => Promise<{ data: any }>;
  };
  language: string;
  aiServiceMode: 'online' | 'autonomous' | 'initializing';
}

export function useAIAssistant({
  ambientTypes,
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
    if (!ambientTypes || aiServiceMode !== 'online') return;
    const fetch = () => {
      axiosInstance.get(`/ai/next-action?language=${language}`)
        .then(res => {
          const { type, content, animation_hint } = res.data as {
            type: string; content: string | null; animation_hint: string | null;
          };
          if (!ambientTypes.has(type) || !content) return;
          enqueue({ text: content, hint: animation_hint ?? null });
        })
        .catch(() => { /* silent — the companion engine still speaks */ });
    };
    fetch();
    const id = setInterval(fetch, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [ambientTypes, aiServiceMode, language, axiosInstance, enqueue]);

  // The gate closed (e.g. radio silence turned on): drop what's queued/shown.
  useEffect(() => {
    if (ambientTypes) return;
    setQueue([]);
    setCurrentMessage(null);
    setCurrentHint(null);
  }, [ambientTypes]);

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
