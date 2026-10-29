// The companion (tamagotchi) as the server describes it — GET
// /api/companion/state. Health, mood, the reason and which message to show
// are all decided in Go from the dashboard's own figures; this file only
// turns the server's message types + numbers into words (the four-language
// fallback used whenever the AI service has no variant of its own).

import type { TFunction } from 'i18next';

export type CompanionMood = 'thriving' | 'content' | 'worried' | 'stressed' | 'exhausted';
export type CompanionBasis = 'cycle' | 'month' | 'none';
export type SlotValue = number | string | boolean; // booleans are context flags (e.g. calibrating)
export type Slots = Record<string, SlotValue>;

export interface CompanionReason {
  type: string;
  slots?: Slots;
}

export interface CompanionMessage {
  id: string;
  type: string;
  priority: number;
  tone: string;
  slots: Slots;
  text?: string; // the AI service's variant; absent → fallback below
}

export interface CompanionState {
  health: number; // 25–100
  mood: CompanionMood;
  reason: CompanionReason;
  basis: CompanionBasis;
  quest: { open: boolean };
  message: CompanionMessage | null;
}

export type CatchKind = 'star' | 'cow';
/** An explicit vote on a message type; closing a message is never a vote. */
export type MessageVote = 'liked' | 'disliked';
/** What the user can do with a companion message bubble. */
export type MessageAction = 'like' | 'dislike' | 'close';

/** Every message type the server can send (each has a text in 4 languages). */
export const COMPANION_MESSAGE_TYPES = [
  'overspent',
  'big_expense',
  'savings_deposit',
  'income',
  'pace_warn',
  'pace_over',
  'pace_recovered',
  'payday_tomorrow',
  'last_days',
  'week_checkin',
  'weekday_heads_up',
  'quest_ask',
] as const;

/** Every health reason the server can send. */
export const COMPANION_REASON_TYPES = [
  'all_good',
  'all_good_free',
  'grace',
  'recovering',
  'pace_ahead_week1',
  'pace_ahead',
  'overspent',
  'quest',
] as const;

const AMOUNT_SLOTS = new Set(['amount', 'remaining', 'daily', 'spent', 'over', 'saved_total', 'forecast_end']);

type FormatAmount = (n: number) => string;

/** Signed money: the app's formatter drops the sign, so a true minus is added. */
export function signedAmount(n: number, formatAmount: FormatAmount): string {
  return n < 0 ? `−${formatAmount(Math.abs(n))}` : formatAmount(n);
}

/** Localized weekday name; 0 = Sunday (Go's time.Weekday). */
export function weekdayName(day: number, locale: string): string {
  // 7 Jan 2024 was a Sunday.
  return new Date(2024, 0, 7 + day).toLocaleDateString(locale, { weekday: 'long' });
}

/** The numbers of a message/reason, ready for interpolation. */
export function formatSlots(slots: Slots | undefined, t: TFunction, formatAmount: FormatAmount, locale: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(slots ?? {})) {
    if (typeof value === 'boolean') continue;
    if (typeof value === 'number' && AMOUNT_SLOTS.has(key)) out[key] = signedAmount(value, formatAmount);
    else if (key === 'weekday' && typeof value === 'number') out[key] = weekdayName(value, locale);
    else if (typeof value === 'number') out[key] = value.toLocaleString(locale, { maximumFractionDigits: 1 });
    else out[key] = value;
  }
  // Built-in categories render in the UI language; user categories as typed.
  if (slots?.category_key) out.category = t(String(slots.category_key), { defaultValue: String(slots.category ?? '') });
  return out;
}

/** i18n key of a message's fallback text (some types have a variant by data). */
export function messageKey(msg: Pick<CompanionMessage, 'type' | 'slots'>): string {
  if (msg.type === 'week_checkin' && msg.slots.forecast_end !== undefined) return 'companion.msg.week_checkin_forecast';
  if (msg.type === 'big_expense' && msg.slots.remaining === undefined) return 'companion.msg.big_expense_short';
  return `companion.msg.${msg.type}`;
}

/** The words of a message: the AI service's variant, else the fallback. */
export function messageText(msg: CompanionMessage, t: TFunction, formatAmount: FormatAmount, locale: string): string {
  if (msg.text && msg.text.trim()) return msg.text;
  return t(messageKey(msg), formatSlots(msg.slots, t, formatAmount, locale));
}

/** Plain-language "why" behind the current health. */
export function reasonText(reason: CompanionReason, t: TFunction, formatAmount: FormatAmount, locale: string): string {
  return t(`companion.reason.${reason.type}`, formatSlots(reason.slots, t, formatAmount, locale));
}

/** "Health 72% (−13%): <reason>" — shown when health has dropped. */
export function healthChangeText(health: number, previous: number | null, reason: string, t: TFunction): string {
  const delta = previous === null ? 0 : Math.round(health - previous);
  return delta < 0
    ? t('companion.health_dropped', { value: health, delta: `−${Math.abs(delta)}`, reason })
    : t('companion.health_now', { value: health, reason });
}

/**
 * What an action on a companion message does. 👍 / 👎 send a vote (the type is
 * shown a bit more / less often); ✕ only closes it — no vote, no effect on
 * health — and the UFO answers with a short line and flies on.
 */
export function messageActionEffect(action: MessageAction): { vote: MessageVote | null; flyOff: boolean } {
  switch (action) {
    case 'like':
      return { vote: 'liked', flyOff: false };
    case 'dislike':
      return { vote: 'disliked', flyOff: false };
    default:
      return { vote: null, flyOff: true };
  }
}

/** Everything the user can do with the UFO and its bubbles. */
export type CompanionInteraction =
  | CatchKind
  | 'journal_yes' // ✓ on "show my finds / moo-jokes?"
  | 'journal_no' // ✕ on that prompt
  | 'message_close'
  | 'message_vote';

/**
 * Only catching the shining star or the cow counts for the weekly quest (and
 * so for health). Prompts, jokes, finds and closing any bubble are health-
 * neutral — dismissing never counts as "not engaging".
 */
export function countsForQuest(interaction: CompanionInteraction): interaction is CatchKind {
  return interaction === 'star' || interaction === 'cow';
}

/**
 * The UFO's short line when a bubble is closed with ✕ (or the journal prompt
 * is declined) before it flies on. Placeholder pool until Stage D's content.
 */
export function pickExitLine(t: TFunction, random: () => number = Math.random): string {
  const pool = t('ai.exit_phrases', { returnObjects: true }) as unknown;
  if (!Array.isArray(pool) || pool.length === 0) return '';
  return String(pool[Math.floor(random() * pool.length)]);
}
