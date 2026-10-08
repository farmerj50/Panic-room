// Picks which already-recorded video segment a social share should use.
// Bes is a safety app first: sharing must never interrupt the live
// recording unless there is genuinely no other way to get a clip. So the
// order is always: an uploaded segment → wait for an in-flight upload →
// retry a failed upload → and only then ask for a new segment cut (which
// briefly stops/restarts the camera, same as a flip).
//
// Split in two so each layer is testable without a camera:
// - selectShareSegment: pure, synchronous decision over the current entries.
// - createShareSegmentResolver: the async orchestration (wait/retry/cut).

export type ShareSegmentStatus = 'pending' | 'done' | 'failed';

// Structurally matches EmergencyScreen's PendingSegmentUpload — only the
// fields this module reads.
export type ShareableSegmentEntry = {
  segment: { sequence: number };
  localUri: string;
  status: ShareSegmentStatus;
  promise?: Promise<void>;
};

export type ShareSegmentDecision<E extends ShareableSegmentEntry> =
  | { action: 'use_done'; entry: E }
  | { action: 'wait_pending'; entry: E }
  | { action: 'retry_failed'; entry: E }
  | { action: 'cut_required' };

// Newest first. A newer pending/failed segment is preferred (waited on /
// retried) over an older uploaded one, so the clip shown in the preview is
// the newest one available. `exhausted` holds entries already waited on or
// retried without success — those are skipped, which is what lets an older
// uploaded segment win once the newer one has had its chance.
export function selectShareSegment<E extends ShareableSegmentEntry>(
  entries: readonly E[],
  exhausted: ReadonlySet<E> = new Set(),
): ShareSegmentDecision<E> {
  const newestFirst = [...entries].sort((a, b) => b.segment.sequence - a.segment.sequence);
  for (const entry of newestFirst) {
    if (entry.status === 'done') return { action: 'use_done', entry };
    if (exhausted.has(entry)) continue;
    if (entry.status === 'pending') return { action: 'wait_pending', entry };
    return { action: 'retry_failed', entry };
  }
  return { action: 'cut_required' };
}

export type ShareSegmentDeps<E extends ShareableSegmentEntry> = {
  getEntries: () => readonly E[];
  // Re-attempts the upload of a failed entry. Must leave entry.status set
  // to 'done' or 'failed' when it settles.
  retryUpload: (entry: E) => Promise<void>;
  // Forces a new segment cut (stop → finalize → restart recording). Called
  // at most once per resolve, and only when nothing else is usable.
  requestCut: () => Promise<void>;
  // True once the emergency is being torn down — stop immediately.
  isStopping: () => boolean;
  // Bound on waiting for one upload/retry.
  timeoutMs?: number;
  // Bound on waiting for the cut itself (finalize ≤8s + up to two bounded
  // camera remounts ≤6s each in EmergencyScreen, plus margin).
  cutTimeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CUT_TIMEOUT_MS = 30000;
const MAX_STEPS = 12;

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function ensureShareableSegment<E extends ShareableSegmentEntry>(
  deps: ShareSegmentDeps<E>,
): Promise<E | null> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exhausted = new Set<E>();
  let cutRequested = false;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (deps.isStopping()) return null;
    const decision = selectShareSegment(deps.getEntries(), exhausted);

    switch (decision.action) {
      case 'use_done':
        return decision.entry;

      case 'wait_pending': {
        const { entry } = decision;
        await Promise.race([entry.promise ?? Promise.resolve(), wait(timeoutMs)]);
        // Still pending = timed out. A wait that ended in 'failed' is left
        // un-exhausted so the next pass retries it once.
        if (entry.status === 'pending') exhausted.add(entry);
        break;
      }

      case 'retry_failed': {
        const { entry } = decision;
        exhausted.add(entry); // one retry per entry, whatever the outcome
        await Promise.race([deps.retryUpload(entry).catch(() => {}), wait(timeoutMs)]);
        break;
      }

      case 'cut_required':
        // Never a second cut — if the first one didn't yield an uploadable
        // segment, report "no video" rather than repeatedly interrupting
        // the recording.
        if (cutRequested) return null;
        cutRequested = true;
        // A cut that throws or hangs must never wedge sharing: it's bounded
        // and its failure is swallowed, so this resolve always settles and
        // the resolver's in-flight guard is always released (see finally
        // below). The camera's own flippingRef is released in
        // cutToNewSegment's finally, independently of this.
        await Promise.race([
          Promise.resolve()
            .then(() => deps.requestCut())
            .catch(() => {}),
          wait(deps.cutTimeoutMs ?? DEFAULT_CUT_TIMEOUT_MS),
        ]);
        break;
    }
  }
  return null;
}

// Concurrent callers (the auto prompt and the manual Share button) share
// one in-flight resolve, so they can never trigger two cuts between them.
// The guard is released in `finally` whether the resolve found a segment,
// gave up, timed out, or threw — a failed attempt never blocks the next.
export function createShareSegmentResolver<E extends ShareableSegmentEntry>(deps: ShareSegmentDeps<E>) {
  let inFlight: Promise<E | null> | null = null;
  return function resolveShareSegment(): Promise<E | null> {
    if (!inFlight) {
      inFlight = ensureShareableSegment(deps).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}
