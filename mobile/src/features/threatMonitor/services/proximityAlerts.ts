import type { PersonProximity } from './ProximityEstimator';

// Opt-in in-app alert when someone newly reads as getting closer in camera
// view. Informational only: it never contacts anyone or starts Emergency.
export const PROXIMITY_ALERT_CONFIG = {
  perPersonCooldownMs: 30_000,
  overallCooldownMs: 10_000,
};

export class ProximityAlerter {
  private lastAlertAt = -Infinity;
  private lastPerTrack = new Map<number, number>();
  private wasApproaching = new Set<number>();

  reset() {
    this.lastAlertAt = -Infinity;
    this.lastPerTrack.clear();
    this.wasApproaching.clear();
  }

  // Returns the track to alert about, if any. Only a reliable reading that
  // has just become "getting closer" counts, and both cooldowns must allow it.
  evaluate(readings: Map<number, PersonProximity>, now: number): number | null {
    let fire: number | null = null;
    const approachingNow = new Set<number>();
    for (const r of readings.values()) {
      if (r.state !== 'APPROACHING' || !r.reliable) continue;
      approachingNow.add(r.trackId);
      if (this.wasApproaching.has(r.trackId) || fire != null) continue;
      if (now - this.lastAlertAt < PROXIMITY_ALERT_CONFIG.overallCooldownMs) continue;
      if (now - (this.lastPerTrack.get(r.trackId) ?? -Infinity) < PROXIMITY_ALERT_CONFIG.perPersonCooldownMs) continue;
      fire = r.trackId;
    }
    this.wasApproaching = approachingNow;
    if (fire != null) {
      this.lastAlertAt = now;
      this.lastPerTrack.set(fire, now);
    }
    return fire;
  }
}
