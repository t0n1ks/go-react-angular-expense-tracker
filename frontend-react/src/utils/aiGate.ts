// What the companion may SHOW, from the two AI toggles and Lite mode.
//
// A thin output gate only: the content pool, the reaction engine and the
// health engine keep running unchanged; these rules decide what reaches the
// user. Turning a toggle back on restores the normal behaviour as is.
// TODO(llm): AI toggles currently gate only the user-facing output; when a
// real LLM is connected, revisit to enforce restrictions at the data/call
// level, not just by hiding output.

export interface AIGateSettings {
  liteMode: boolean;
  aiAdviceEnabled: boolean; // «Включить финансовые советы» (extended only)
  aiHumorEnabled: boolean;  // «Включить юмор и взаимодействие»
}

/** Humour & interaction OFF → radio silence: nothing on its own, in any mode. */
export const isRadioSilence = (s: AIGateSettings): boolean => !s.aiHumorEnabled;

/** Companion engine messages that are not about money. */
const NON_FINANCE_MESSAGES = new Set(['quest_ask']);

/**
 * Whether a companion (server engine) message may be shown.
 * - Radio silence: never.
 * - Lite: only non-finance messages (finance advice doesn't apply in Lite).
 * - Extended: as before — all of them while finance advice is on, none off.
 */
export function companionMessageVisible(type: string, s: AIGateSettings): boolean {
  if (isRadioSilence(s)) return false;
  if (s.liteMode) return NON_FINANCE_MESSAGES.has(type);
  return s.aiAdviceEnabled;
}

const AMBIENT_ALL = new Set(['GREETING', 'TIP', 'ENCOURAGEMENT']);
const AMBIENT_NO_FINANCE = new Set(['GREETING', 'ENCOURAGEMENT']);

/**
 * Ambient lines the AI service may push (greetings, tips, encouragement), or
 * null when none are shown (nothing is requested then).
 * - Radio silence: none.
 * - Lite: no finance tips.
 * - Extended: as before — all of them while finance advice is on, none off.
 */
export function ambientTypes(s: AIGateSettings): ReadonlySet<string> | null {
  if (isRadioSilence(s)) return null;
  if (s.liteMode) return AMBIENT_NO_FINANCE;
  return s.aiAdviceEnabled ? AMBIENT_ALL : null;
}
