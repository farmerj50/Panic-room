import { MONITOR_CONFIG } from '../config/threatMonitorConfig';
import { releaseMonitorCamera } from './besVision';

// Who may use the camera: the AI Monitor only while no Emergency is active,
// and Emergency always. The monitor is the only thing that ever yields.

export type HandoffOutcome = 'released' | 'timeout' | 'error';
export type HandoffRecord = { at: number; outcome: HandoffOutcome; ms: number; monitorWasActive: boolean };

let monitorActive = false;
const claimListeners = new Set<() => void>();
const handoffs: HandoffRecord[] = [];

// The monitor calls this before turning its camera on.
export function acquireForMonitor({ isEmergency }: { isEmergency: boolean }): boolean {
  if (isEmergency) return false;
  monitorActive = true;
  return true;
}

export function releaseForMonitor() {
  monitorActive = false;
}

export function isMonitorActive() {
  return monitorActive;
}

// The monitor hook subscribes so its own state stops along with the native
// camera when Emergency claims it.
export function onEmergencyClaim(listener: () => void): () => void {
  claimListeners.add(listener);
  return () => claimListeners.delete(listener);
}

// Emergency calls this right before mounting its camera. Releases the monitor
// camera immediately and waits only for CameraX to confirm it's closed,
// capped at the timeout — Emergency proceeds either way. Never throws.
export async function claimForEmergency(
  timeoutMs: number = MONITOR_CONFIG.emergencyHandoffTimeoutMs,
): Promise<HandoffRecord> {
  const started = Date.now();
  const monitorWasActive = monitorActive;
  monitorActive = false;
  claimListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome: HandoffOutcome;
  try {
    outcome = await Promise.race<HandoffOutcome>([
      releaseMonitorCamera().then((closed) => (closed ? 'released' : 'timeout')),
      new Promise<HandoffOutcome>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
  } catch {
    outcome = 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }

  const record: HandoffRecord = { at: started, outcome, ms: Date.now() - started, monitorWasActive };
  handoffs.push(record);
  if (handoffs.length > 20) handoffs.shift();
  // Logged every time (no personal data) so hand-offs can be counted on test devices.
  if (outcome === 'released') console.info(`[AIMonitorHandoff] ${JSON.stringify(record)}`);
  else console.warn(`[AIMonitorHandoff] ${JSON.stringify(record)}`);
  return record;
}

// For validation reports.
export function getHandoffHistory(): readonly HandoffRecord[] {
  return handoffs;
}

export function __resetCameraOwnershipForTests() {
  monitorActive = false;
  claimListeners.clear();
  handoffs.length = 0;
}
