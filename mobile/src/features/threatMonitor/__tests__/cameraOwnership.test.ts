const mockRelease = jest.fn();
jest.mock('../services/besVision', () => ({
  releaseMonitorCamera: () => mockRelease(),
  isBesVisionAvailable: true,
}));

import {
  __resetCameraOwnershipForTests,
  acquireForMonitor,
  claimForEmergency,
  getHandoffHistory,
  isMonitorActive,
  onEmergencyClaim,
} from '../services/CameraOwnershipService';

describe('CameraOwnershipService', () => {
  beforeEach(() => {
    __resetCameraOwnershipForTests();
    mockRelease.mockReset().mockResolvedValue(true);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => jest.useRealTimers());

  it('refuses the monitor while an Emergency is active', () => {
    expect(acquireForMonitor({ isEmergency: true })).toBe(false);
    expect(isMonitorActive()).toBe(false);
    expect(acquireForMonitor({ isEmergency: false })).toBe(true);
    expect(isMonitorActive()).toBe(true);
  });

  it('Emergency preempts a running monitor and records a confirmed release', async () => {
    acquireForMonitor({ isEmergency: false });
    const stopped = jest.fn();
    onEmergencyClaim(stopped);

    const record = await claimForEmergency();

    expect(stopped).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(isMonitorActive()).toBe(false);
    expect(record).toMatchObject({ outcome: 'released', monitorWasActive: true });
    expect(getHandoffHistory()).toHaveLength(1);
  });

  it('always releases natively, even when JS thinks no monitor is running', async () => {
    const record = await claimForEmergency();
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(record).toMatchObject({ outcome: 'released', monitorWasActive: false });
  });

  it('never blocks Emergency longer than the timeout', async () => {
    jest.useFakeTimers();
    mockRelease.mockReturnValue(new Promise(() => {})); // camera never confirms closed
    acquireForMonitor({ isEmergency: false });

    const pending = claimForEmergency(1000);
    await jest.advanceTimersByTimeAsync(1000);
    const record = await pending;

    expect(record.outcome).toBe('timeout');
    expect(record.ms).toBeLessThanOrEqual(1100);
  });

  it('reports a timeout when the camera did not confirm closed', async () => {
    mockRelease.mockResolvedValue(false);
    expect((await claimForEmergency()).outcome).toBe('timeout');
  });

  it('never throws, even if the native release fails or a listener throws', async () => {
    mockRelease.mockRejectedValue(new Error('boom'));
    onEmergencyClaim(() => {
      throw new Error('listener');
    });
    await expect(claimForEmergency()).resolves.toMatchObject({ outcome: 'error' });
  });

  it('lets the monitor start again once the Emergency is over', async () => {
    acquireForMonitor({ isEmergency: false });
    await claimForEmergency();
    expect(acquireForMonitor({ isEmergency: true })).toBe(false);
    expect(acquireForMonitor({ isEmergency: false })).toBe(true);
  });
});
