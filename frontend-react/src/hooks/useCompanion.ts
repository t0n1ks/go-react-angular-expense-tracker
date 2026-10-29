import { useCallback, useEffect, useRef, useState } from 'react';
import { messageActionEffect, type CatchKind, type CompanionMessage, type CompanionState, type MessageAction } from '../utils/companion';

// The companion's state from the server (GET /api/companion/state): read on
// mount, every 10 minutes, and whenever `refreshKey` changes (e.g. the cycle
// figures after a new transaction) so "just happened" reactions arrive at
// once. All decisions are the server's; this hook only relays them.

const POLL_MS = 10 * 60 * 1000;

interface AxiosLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (url: string) => Promise<{ data: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post: (url: string, data?: unknown) => Promise<{ data: any }>;
}

interface Options {
  axiosInstance: AxiosLike;
  language: string;
  refreshKey?: unknown;
}

export function useCompanion({ axiosInstance, language, refreshKey }: Options) {
  const [state, setState] = useState<CompanionState | null>(null);
  const [message, setMessage] = useState<CompanionMessage | null>(null);
  const languageRef = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);

  const apply = useCallback((next: CompanionState) => {
    setState(next);
    // A new message replaces nothing that is still showing; it waits.
    if (next.message) setMessage(prev => prev ?? next.message);
  }, []);

  const refresh = useCallback(() => {
    axiosInstance.get(`/companion/state?language=${encodeURIComponent(languageRef.current)}`)
      .then(res => apply(res.data as CompanionState))
      .catch(() => { /* keep the last known state */ });
  }, [axiosInstance, apply]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, refreshKey]);

  const catchEntity = useCallback((kind: CatchKind) => {
    axiosInstance.post('/companion/catch', { kind })
      .then(res => setState(res.data as CompanionState))
      .catch(() => { /* the catch still counts locally for the joke/fact */ });
  }, [axiosInstance]);

  // 👍 / 👎 send one vote for the message's type; ✕ sends nothing. Every
  // action closes the message.
  const messageRef = useRef<CompanionMessage | null>(null);
  useEffect(() => { messageRef.current = message; }, [message]);

  const act = useCallback((action: MessageAction) => {
    const current = messageRef.current;
    if (!current) return;
    const { vote } = messageActionEffect(action);
    if (vote) axiosInstance.post('/companion/reaction', { type: current.type, reaction: vote }).catch(() => {});
    setMessage(null);
  }, [axiosInstance]);

  return { state, message, catchEntity, act };
}
