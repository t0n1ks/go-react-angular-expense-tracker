import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatchKind, CompanionMessage, CompanionState, MessageReaction } from '../utils/companion';

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

  // One reaction per message: the first tap or the dismissal counts.
  const messageRef = useRef<CompanionMessage | null>(null);
  const reactedRef = useRef<Set<string>>(new Set());
  useEffect(() => { messageRef.current = message; }, [message]);

  const react = useCallback((reaction: MessageReaction) => {
    const current = messageRef.current;
    if (!current) return;
    if (!reactedRef.current.has(current.id)) {
      reactedRef.current.add(current.id);
      axiosInstance.post('/companion/reaction', { type: current.type, reaction }).catch(() => {});
    }
    if (reaction === 'dismissed') setMessage(null);
  }, [axiosInstance]);

  /** The message finished showing without a reaction (or was replaced). */
  const clearMessage = useCallback(() => setMessage(null), []);

  return { state, message, catchEntity, react, clearMessage };
}
