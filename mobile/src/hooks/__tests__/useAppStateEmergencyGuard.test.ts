import { renderHook } from '@testing-library/react-native';

type ChangeHandler = (state: string) => void;
let changeHandler: ChangeHandler | null = null;

// The real AppState pipes native 'appStateDidChange' events through an
// internal NativeEventEmitter that isn't meaningfully drivable in a unit
// test — mock the module directly so we can trigger 'change' ourselves.
// react-native/index.js does `require('./Libraries/AppState/AppState').default`,
// so mocking this deep path also covers `import { AppState } from 'react-native'`.
jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    currentState: 'active',
    addEventListener: jest.fn((type: string, handler: ChangeHandler) => {
      if (type === 'change') changeHandler = handler;
      return { remove: jest.fn(() => { changeHandler = null; }) };
    }),
  },
}));

import {
  clearInProgressEmergency,
  getInProgressEmergency,
  useAppStateEmergencyGuard,
} from '../useAppStateEmergencyGuard';

function emitBackground() {
  changeHandler?.('background');
}

describe('useAppStateEmergencyGuard', () => {
  afterEach(async () => {
    changeHandler = null;
    await clearInProgressEmergency();
  });

  test('persists emergency state when the app backgrounds during an active emergency', async () => {
    renderHook(() => useAppStateEmergencyGuard({ emergencyId: 'emergency-1', phase: 'recording', elapsed: 12 }));

    emitBackground();

    const saved = await getInProgressEmergency();
    expect(saved?.emergencyId).toBe('emergency-1');
    expect(saved?.phase).toBe('recording');
    expect(saved?.elapsed).toBe(12);
  });

  test('reflects the latest state at the time of backgrounding, not the state at mount', async () => {
    type Props = { emergencyId: string | null; phase: string; elapsed: number };
    const { rerender } = renderHook<void, Props>(
      ({ emergencyId, phase, elapsed }) => useAppStateEmergencyGuard({ emergencyId, phase, elapsed }),
      { initialProps: { emergencyId: 'emergency-1', phase: 'activating', elapsed: 0 } },
    );

    rerender({ emergencyId: 'emergency-1', phase: 'recording', elapsed: 40 });
    emitBackground();

    const saved = await getInProgressEmergency();
    expect(saved?.phase).toBe('recording');
    expect(saved?.elapsed).toBe(40);
  });

  test('does not persist anything when there is no active emergency', async () => {
    renderHook(() => useAppStateEmergencyGuard({ emergencyId: null, phase: 'countdown', elapsed: 0 }));

    emitBackground();

    const saved = await getInProgressEmergency();
    expect(saved).toBeNull();
  });

  test('clearInProgressEmergency removes the persisted flag', async () => {
    renderHook(() => useAppStateEmergencyGuard({ emergencyId: 'emergency-2', phase: 'recording', elapsed: 5 }));
    emitBackground();

    expect(await getInProgressEmergency()).not.toBeNull();

    await clearInProgressEmergency();
    expect(await getInProgressEmergency()).toBeNull();
  });
});
