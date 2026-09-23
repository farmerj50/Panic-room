import { act, renderHook, waitFor } from '@testing-library/react-native';

// EmergencyProvider loads contacts from the backend on mount — seed the
// mock directly rather than calling setContacts afterward, which would
// otherwise race against (and get clobbered by) this mount-time load.
const mockGetContactsFromBackend = jest.fn();
jest.mock('../../services/contactService', () => ({
  getContactsFromBackend: (...args: unknown[]) => mockGetContactsFromBackend(...args),
}));

jest.mock('../../services/locationService', () => ({
  getCurrentLocation: jest.fn().mockResolvedValue({ latitude: 1, longitude: 2 }),
  getLastKnownLocation: jest.fn().mockResolvedValue(null),
  watchLocation: jest.fn().mockResolvedValue({ remove: jest.fn() }),
}));

const mockCreateEmergency = jest.fn();
const mockNotifyEmergencyContacts = jest.fn();
jest.mock('../../services/emergencyService', () => ({
  createEmergency: (...args: unknown[]) => mockCreateEmergency(...args),
  notifyEmergencyContacts: (...args: unknown[]) => mockNotifyEmergencyContacts(...args),
}));

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => ({
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    uri: 'file://audio.m4a',
  }),
}));

const mockGetMicrophoneStatus = jest.fn();
const mockRequestMicrophonePermission = jest.fn();
jest.mock('../../services/corePermissions', () => ({
  getMicrophoneStatus: (...args: unknown[]) => mockGetMicrophoneStatus(...args),
  requestMicrophonePermission: (...args: unknown[]) => mockRequestMicrophonePermission(...args),
}));

import { EmergencyProvider, useEmergencyContext } from '../EmergencyContext';
import { Contact } from '../../types/contact';

const CONTACT: Contact = { id: 'c1', name: 'Alex', phoneNumber: '+15551234567', isPriority: true };

// Renders the provider and waits for its mount-time loadContacts() to
// resolve (seeded via mockGetContactsFromBackend in beforeEach) before
// handing back — every test wants contacts already settled, not racing
// against the mount effect.
async function renderCtx() {
  const hook = renderHook(() => useEmergencyContext(), { wrapper: EmergencyProvider });
  await waitFor(() => expect(hook.result.current.contacts).toHaveLength(1));
  return hook;
}

type Ctx = ReturnType<typeof useEmergencyContext>;

// activateEmergencySilently triggers React state updates (isEmergency,
// emergencyId) that later calls read back via refs synced during render —
// wrapping in act() ensures those renders commit before the next call
// runs, matching real usage (an event handler, not a raw promise chain
// outside React's control).
async function activate(result: { current: Ctx }, params: Parameters<Ctx['activateEmergencySilently']>[0]) {
  let out!: Awaited<ReturnType<Ctx['activateEmergencySilently']>>;
  await act(async () => {
    out = await result.current.activateEmergencySilently(params);
  });
  return out;
}

describe('EmergencyContext.activateEmergencySilently', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetContactsFromBackend.mockResolvedValue([CONTACT]);
    mockCreateEmergency.mockResolvedValue({ id: 'em-1' });
    mockNotifyEmergencyContacts.mockResolvedValue({ sent: true, notifiedCount: 1, providerConfigured: true });
    mockGetMicrophoneStatus.mockResolvedValue('denied');
    mockRequestMicrophonePermission.mockResolvedValue('granted');
  });

  test('fresh activation creates exactly one EmergencyEvent and kicks off exactly one notify call', async () => {
    const { result } = await renderCtx();

    const activationResult = await activate(result, { reason: 'covert-hidden-sos' });

    expect(activationResult).toEqual({ ok: true, emergencyId: 'em-1', reused: false });
    expect(mockCreateEmergency).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNotifyEmergencyContacts).toHaveBeenCalledTimes(1));
  });

  test('resolves without waiting on a slow notify call', async () => {
    let releaseNotify!: () => void;
    mockNotifyEmergencyContacts.mockReturnValue(
      new Promise((resolve) => {
        releaseNotify = () => resolve({ sent: true, notifiedCount: 1, providerConfigured: true });
      }),
    );

    const { result } = await renderCtx();

    const start = Date.now();
    const activationResult = await activate(result, { reason: 'covert-hidden-sos' });
    const elapsed = Date.now() - start;

    expect(activationResult.ok).toBe(true);
    // Activation itself must not be gated on the notify round-trip.
    expect(elapsed).toBeLessThan(1000);
    releaseNotify();
  });

  test('a rapid double-call only creates one EmergencyEvent', async () => {
    let releaseCreate!: (v: { id: string }) => void;
    mockCreateEmergency.mockReturnValue(new Promise((resolve) => { releaseCreate = resolve; }));

    const { result } = await renderCtx();

    let firstResult!: Awaited<ReturnType<Ctx['activateEmergencySilently']>>;
    let secondResult!: Awaited<ReturnType<Ctx['activateEmergencySilently']>>;
    await act(async () => {
      const first = result.current.activateEmergencySilently({ reason: 'covert-hidden-sos' });
      const second = result.current.activateEmergencySilently({ reason: 'covert-hidden-sos' });
      releaseCreate({ id: 'em-1' });
      [firstResult, secondResult] = await Promise.all([first, second]);
    });

    expect(mockCreateEmergency).toHaveBeenCalledTimes(1);
    expect(firstResult.ok).toBe(true);
    expect(secondResult).toEqual({ ok: false, error: 'ALREADY_PENDING' });
  });

  test('calling while already active does not create a second EmergencyEvent but does re-notify', async () => {
    const { result } = await renderCtx();

    await activate(result, { reason: 'covert-hidden-sos' });
    expect(mockCreateEmergency).toHaveBeenCalledTimes(1);

    const second = await activate(result, { reason: 'covert-hidden-sos' });

    expect(second).toEqual({ ok: true, emergencyId: 'em-1', reused: true });
    expect(mockCreateEmergency).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockNotifyEmergencyContacts).toHaveBeenCalledTimes(2));
  });

  test('two consecutive createEmergency failures return CREATE_FAILED', async () => {
    mockCreateEmergency.mockRejectedValue(new Error('network down'));

    const { result } = await renderCtx();

    const activationResult = await activate(result, { reason: 'covert-hidden-sos' });

    expect(activationResult).toEqual({ ok: false, error: 'CREATE_FAILED' });
    expect(mockCreateEmergency).toHaveBeenCalledTimes(2);
  }, 10000);
});

describe('EmergencyContext.runCoreActivation mic-permission guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetContactsFromBackend.mockResolvedValue([CONTACT]);
    mockCreateEmergency.mockResolvedValue({ id: 'em-1' });
    mockNotifyEmergencyContacts.mockResolvedValue({ sent: true, notifiedCount: 1, providerConfigured: true });
    mockGetMicrophoneStatus.mockResolvedValue('denied');
    mockRequestMicrophonePermission.mockResolvedValue('granted');
  });

  // The screen-based path (EmergencyScreen.tsx calling runCoreActivation
  // directly, no skipMicPermissionPrompt) can show a dialog — it should
  // request mic permission when not already granted.
  test('runCoreActivation({ startAudio: true }) requests mic permission when not already granted', async () => {
    const { result } = await renderCtx();

    await act(async () => {
      await result.current.runCoreActivation({ startAudio: true });
    });

    expect(mockGetMicrophoneStatus).toHaveBeenCalled();
    expect(mockRequestMicrophonePermission).toHaveBeenCalledWith({ context: 'emergency_activation' });
  });

  test('runCoreActivation({ startAudio: true }) skips the request when mic is already granted', async () => {
    mockGetMicrophoneStatus.mockResolvedValue('granted');
    const { result } = await renderCtx();

    await act(async () => {
      await result.current.runCoreActivation({ startAudio: true });
    });

    expect(mockRequestMicrophonePermission).not.toHaveBeenCalled();
  });

  // The headless Hidden SOS path can't show a dialog without blowing its
  // "hidden" cover — activateEmergencySilently must pass
  // skipMicPermissionPrompt so runCoreActivation never prompts here.
  test('activateEmergencySilently never triggers a mic-permission prompt', async () => {
    const { result } = await renderCtx();

    await activate(result, { reason: 'covert-hidden-sos' });

    expect(mockRequestMicrophonePermission).not.toHaveBeenCalled();
  });
});
