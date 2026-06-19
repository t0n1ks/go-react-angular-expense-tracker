// Persistence for the Tamagotchi journal & favorites (localStorage).
//
// Daily "discoveries" reset at midnight (intentional, keeps the journal fresh).
// "Favorites" persist indefinitely until the user un-stars them. Both store
// stable SavedItem objects (id + translations) rather than raw localized
// strings, so the lists re-render in whatever UI language is active. Legacy
// raw-string entries are upgraded on read for full backward compatibility.

import {
  type SavedItem,
  type ContentKind,
  itemFromLegacyString,
} from '../data/tamaContent';

export type { SavedItem };

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Accepts a legacy raw string OR a stored SavedItem and returns a SavedItem.
function normItem(kind: ContentKind, raw: unknown): SavedItem | null {
  if (typeof raw === 'string') return itemFromLegacyString(kind, raw);
  if (raw && typeof raw === 'object') {
    const o = raw as Partial<SavedItem>;
    if (typeof o.id === 'string' && o.tr && typeof o.tr === 'object') {
      return { id: o.id, kind: o.kind ?? kind, tr: o.tr };
    }
  }
  return null;
}

function normList(kind: ContentKind, arr: unknown): SavedItem[] {
  if (!Array.isArray(arr)) return [];
  const out: SavedItem[] = [];
  for (const raw of arr) {
    const item = normItem(kind, raw);
    if (item) out.push(item);
  }
  return out;
}

// ── Daily discoveries (journal) ───────────────────────────────────────────────

export interface Discoveries {
  date: string;
  facts: SavedItem[];
  jokes: SavedItem[];
}

const discKey = (userId: string | number) => `tama_discoveries_${userId}`;

export function loadDiscoveries(userId: string | number): Discoveries {
  const today = getTodayKey();
  const empty: Discoveries = { date: today, facts: [], jokes: [] };
  try {
    const raw = localStorage.getItem(discKey(userId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as { date?: string; facts?: unknown; jokes?: unknown };
    if (parsed.date !== today) return empty; // daily reset
    return {
      date: today,
      facts: normList('fact', parsed.facts),
      jokes: normList('joke', parsed.jokes),
    };
  } catch {
    return empty;
  }
}

export function addDiscovery(userId: string | number, kind: ContentKind, item: SavedItem): void {
  try {
    const current = loadDiscoveries(userId);
    const list = kind === 'fact' ? current.facts : current.jokes;
    if (!list.some((d) => d.id === item.id)) list.push(item);
    localStorage.setItem(discKey(userId), JSON.stringify(current));
  } catch {
    /* ignore quota / serialization errors — journal is best-effort */
  }
}

// ── Favorites (persistent, never reset) ───────────────────────────────────────

const favKey = (userId: string | number) => `tama_favorites_${userId}`;
const FAVORITES_MAX = 300; // generous ceiling; pool is far smaller

export function loadFavorites(userId: string | number): SavedItem[] {
  try {
    const raw = localStorage.getItem(favKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(parsed)) return [];
    // kind travels with each favorite entry; fall back to 'joke' only if absent.
    return parsed
      .map((raw) => normItem((raw?.kind as ContentKind) ?? 'joke', raw))
      .filter((x): x is SavedItem => x !== null);
  } catch {
    return [];
  }
}

function saveFavorites(userId: string | number, list: SavedItem[]): void {
  try {
    localStorage.setItem(favKey(userId), JSON.stringify(list.slice(-FAVORITES_MAX)));
  } catch {
    /* ignore */
  }
}

export function isFavorite(userId: string | number, id: string): boolean {
  return loadFavorites(userId).some((f) => f.id === id);
}

/** Toggle an item's favorite status; returns the updated favorites list. */
export function toggleFavorite(userId: string | number, item: SavedItem): SavedItem[] {
  const list = loadFavorites(userId);
  const idx = list.findIndex((f) => f.id === item.id);
  const next = idx >= 0 ? list.filter((_, i) => i !== idx) : [...list, item];
  saveFavorites(userId, next);
  return next;
}
