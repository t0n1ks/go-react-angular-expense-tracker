// Keyed Tamagotchi content registry + resolution helpers.
//
// The canonical content (all 4 languages per stable key) lives in the
// auto-generated `tamaContentData.ts`, kept in sync with the Python AI service.
// This module adds the lookup/identity logic used by the journal & favorites:
// discoveries are stored as stable keys (e.g. "joke_045") and resolved to the
// active UI language at render time, so switching languages re-renders the list.

import { JOKES, FACTS, type LocalizedText } from './tamaContentData';

export { JOKES, FACTS };
export type { LocalizedText };

export type ContentKind = 'joke' | 'fact';
export type LangIso = keyof LocalizedText; // 'en' | 'de' | 'ru' | 'uk'

const POOLS: Record<ContentKind, Record<string, LocalizedText>> = { joke: JOKES, fact: FACTS };

// A single discovered/favorited content item. `id` is a stable identity (a
// registry key like "joke_045", or "ai_<hash>" for AI content not in the pool).
// `tr` carries the known translations so AI items still re-render on switch.
export interface SavedItem {
  id: string;
  kind: ContentKind;
  tr: Partial<Record<LangIso, string>>;
}

/** Normalize an i18n language tag (e.g. "uk-UA", "ua") to a registry ISO code. */
export function normalizeLang(lang: string | undefined | null): LangIso {
  const base = (lang ?? 'en').slice(0, 2).toLowerCase();
  if (base === 'de' || base === 'ru' || base === 'uk' || base === 'en') return base;
  if (base === 'ua') return 'uk';
  return 'en';
}

/** All translations for a registry key, or null if the key is unknown. */
export function getTr(kind: ContentKind, key: string): LocalizedText | null {
  return POOLS[kind][key] ?? null;
}

export const CONTENT_KEYS: Record<ContentKind, string[]> = {
  joke: Object.keys(JOKES),
  fact: Object.keys(FACTS),
};

// Reverse index: any-language text → registry key. Lets AI-served content
// (delivered as text + all_translations) be stored as a stable key whenever it
// matches the canonical pool. Built lazily once; pools are small.
let _revIndex: Record<ContentKind, Map<string, string>> | null = null;
function revIndex(): Record<ContentKind, Map<string, string>> {
  if (_revIndex) return _revIndex;
  const build = (pool: Record<string, LocalizedText>) => {
    const m = new Map<string, string>();
    for (const [key, tr] of Object.entries(pool)) {
      (['en', 'de', 'ru', 'uk'] as LangIso[]).forEach((l) => m.set(tr[l].trim(), key));
    }
    return m;
  };
  _revIndex = { joke: build(JOKES), fact: build(FACTS) };
  return _revIndex;
}

/** Map a served string (in any language) back to its registry key, or null. */
export function resolveKeyByText(kind: ContentKind, text: string | undefined | null): string | null {
  if (!text) return null;
  return revIndex()[kind].get(text.trim()) ?? null;
}

/** Render a saved item in the active UI language, with graceful fallback. */
export function resolveItemText(item: SavedItem, lang: string): string {
  const iso = normalizeLang(lang);
  // Prefer the live registry so content fixes propagate; fall back to the
  // stored translations (covers AI items absent from the registry).
  const src: Partial<Record<LangIso, string>> = getTr(item.kind, item.id) ?? item.tr ?? {};
  return src[iso] ?? src.en ?? Object.values(src).find(Boolean) ?? '';
}

// djb2 — compact stable id for AI/legacy content not present in the registry.
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Build a SavedItem from served content. Resolution order:
 *   1. an explicit registry key (local-pool picks),
 *   2. reverse-map the text/translations to a registry key (AI content in pool),
 *   3. a self-contained "ai_<hash>" item carrying whatever translations we have.
 */
export function buildItem(
  kind: ContentKind,
  opts: { key?: string; text?: string; translations?: Record<string, string> | null },
): SavedItem {
  if (opts.key && getTr(kind, opts.key)) {
    return { id: opts.key, kind, tr: getTr(kind, opts.key)! };
  }

  const tr: Partial<Record<LangIso, string>> = {};
  if (opts.translations) {
    (['en', 'de', 'ru', 'uk'] as LangIso[]).forEach((l) => {
      const v = opts.translations![l];
      if (typeof v === 'string' && v.trim()) tr[l] = v;
    });
  }

  // Try to recover a canonical key from any provided string.
  const key =
    resolveKeyByText(kind, tr.en) ??
    resolveKeyByText(kind, opts.text) ??
    (opts.translations
      ? (['de', 'ru', 'uk'] as LangIso[]).map((l) => resolveKeyByText(kind, tr[l])).find(Boolean) ?? null
      : null);
  if (key && getTr(kind, key)) {
    return { id: key, kind, tr: getTr(kind, key)! };
  }

  // Self-contained fallback. Keep the served text under its best-known slot.
  if (opts.text && Object.keys(tr).length === 0) tr.en = opts.text;
  const seed = tr.en ?? opts.text ?? JSON.stringify(tr);
  return { id: `ai_${shortHash(seed)}`, kind, tr };
}

/** Normalize a legacy raw-string discovery into a SavedItem (best-effort key recovery). */
export function itemFromLegacyString(kind: ContentKind, text: string): SavedItem {
  return buildItem(kind, { text });
}
