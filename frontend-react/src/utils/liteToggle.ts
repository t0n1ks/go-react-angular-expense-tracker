// The Lite mode switch in Settings. Pure, so it is unit-tested.
//
// Lite and an active salary cycle are mutually exclusive. A current cycle only
// blocks switching Lite ON (stop the cycle first); switching it OFF is never
// blocked, so no state can lock a user in Lite. The server enforces the same.

/** Whether the Lite switch is locked (disabled) in Settings. */
export function liteToggleLocked(hasActiveCycle: boolean, liteMode: boolean): boolean {
  return hasActiveCycle && !liteMode;
}
