// Tiny module-level, in-memory flags for "fire once per app session" events
// — deliberately not AsyncStorage-backed (this is a per-session dedupe, not
// a per-install one) and deliberately not stored in AuthContext, so setting
// it doesn't trigger a re-render of anything that reads auth state.

let homeViewedFirstFired = false;

export function hasFiredHomeViewedFirst(): boolean {
  return homeViewedFirstFired;
}

export function markHomeViewedFirstFired(): void {
  homeViewedFirstFired = true;
}

// Reset on logout so a subsequent session (different user, same app
// process) can fire its own "first home view" again.
export function resetSessionFlags(): void {
  homeViewedFirstFired = false;
}
