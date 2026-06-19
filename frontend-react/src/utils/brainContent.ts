// ── AI-first content fetch with guaranteed, non-blocking local fallback ───────
//
// Wraps the Go `/ai/content` proxy for the user-initiated UFO entities
// (Cow → joke, Star → fact) and the transaction-advice path. Returns the brain's
// text for the requested category, or `null` when the caller should fall back to
// its local i18n pool. It NEVER throws and NEVER blocks the UI:
//
//   - If the AI service isn't `online`, it returns null immediately (no network).
//   - Otherwise it races the request against an AbortController timeout; any
//     error / timeout / `type:"NONE"` / empty body resolves to null.
//
// Callers always compute their local pick up-front, so a slow or hung service
// just loses the race — it can never stall the interaction.

export type BrainCategory = 'joke' | 'fact' | 'advice';

// Each category must resolve to exactly its own response type — strict isolation
// so e.g. the Cow (joke) can never display advice/fact content, even if the
// backend regresses and returns a mismatched type.
const CATEGORY_TYPE: Record<BrainCategory, string> = {
  joke: 'JOKE',
  fact: 'FACT',
  advice: 'ADVICE',
};

interface AxiosLikeGet {
  get: (url: string, config?: { signal?: AbortSignal }) => Promise<{ data: unknown }>;
}

interface BrainContentResponse {
  type?: string;
  content?: string | null;
  animation_hint?: string | null;
  all_translations?: Record<string, string> | null;
}

export async function fetchBrainContent(
  axiosInstance: AxiosLikeGet,
  category: BrainCategory,
  language: string,
  opts: { aiServiceMode?: string; timeoutMs?: number } = {},
): Promise<{ text: string; translations?: Record<string, string> | null } | null> {
  const { aiServiceMode, timeoutMs = 1200 } = opts;

  // Fast path: known-offline → skip the network entirely, use the local pool.
  if (aiServiceMode !== 'online') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await axiosInstance.get(
      `/ai/content?category=${category}&language=${encodeURIComponent(language)}`,
      { signal: controller.signal },
    );
    const data = res?.data as BrainContentResponse | undefined;
    const text = data?.content?.trim();
    if (!data || data.type === 'NONE' || !text) return null;
    // Strict categorization: only accept content of the exact requested type.
    if (data.type !== CATEGORY_TYPE[category]) return null;
    // Pass through all-language translations so the journal/favorites can
    // re-render the item when the UI language changes.
    return { text, translations: data.all_translations ?? null };
  } catch {
    // Timeout, network error, abort — caller falls back to its local pool.
    return null;
  } finally {
    clearTimeout(timer);
  }
}
