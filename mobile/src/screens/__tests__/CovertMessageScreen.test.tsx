import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockActivateEmergencySilently = jest.fn();
jest.mock('../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({
    contacts: [{ id: 'c1', name: 'Alex', phoneNumber: '+15551234567', isPriority: true }],
    activateEmergencySilently: mockActivateEmergencySilently,
  }),
}));

jest.mock('../../context/SubscriptionContext', () => ({
  useSubscription: () => ({ isPremium: true }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: jest.fn().mockResolvedValue(undefined), localUri: 'file://card.png', uri: 'file://card.png' }) },
}));

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

const mockGetRecipientPublicKey = jest.fn();
const mockUploadCovertImage = jest.fn();
const mockCreateCovertMessage = jest.fn();
jest.mock('../../services/covertMessageService', () => ({
  getRecipientPublicKey: (...args: unknown[]) => mockGetRecipientPublicKey(...args),
  uploadCovertImage: (...args: unknown[]) => mockUploadCovertImage(...args),
  createCovertMessage: (...args: unknown[]) => mockCreateCovertMessage(...args),
  getCovertInbox: jest.fn().mockResolvedValue([]),
  markCovertMessageRead: jest.fn(),
}));

jest.mock('../../services/keyService', () => ({
  getOrCreateKeyPair: jest.fn().mockResolvedValue({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32),
  }),
}));

jest.mock('../../services/covertCryptoService', () => ({
  encryptMessage: jest.fn().mockReturnValue({ ciphertext: new Uint8Array([1, 2, 3]), nonce: new Uint8Array(24) }),
  decryptMessage: jest.fn(),
}));

jest.mock('../../types/CovertPayload', () => ({
  encodeCovertPayload: jest.fn().mockReturnValue(new Uint8Array([9, 9, 9])),
  decodeCovertPayload: jest.fn(),
  generateMessageId: jest.fn().mockReturnValue(new Uint8Array(16)),
}));

jest.mock('../../services/steganographyService', () => ({
  ensurePngFile: jest.fn().mockResolvedValue('file://cover.png'),
  embedPayloadIntoFile: jest.fn().mockResolvedValue('file://embedded.png'),
  extractPayload: jest.fn(),
}));

jest.mock('../../services/locationService', () => ({
  getCurrentLocation: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../hooks/useAppStateEmergencyGuard', () => ({
  getPendingHiddenSos: jest.fn().mockResolvedValue(null),
  clearPendingHiddenSos: jest.fn().mockResolvedValue(undefined),
}));

const mockGetMicrophoneStatus = jest.fn();
const mockRequestMicrophonePermission = jest.fn();
jest.mock('../../services/corePermissions', () => ({
  getMicrophoneStatus: (...args: unknown[]) => mockGetMicrophoneStatus(...args),
  requestMicrophonePermission: (...args: unknown[]) => mockRequestMicrophonePermission(...args),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import CovertMessageScreen from '../CovertMessageScreen';

async function fillOutMessage(messageText: string) {
  fireEvent.press(screen.getByTestId('covert-contact-c1'));
  fireEvent.press(screen.getByTestId('covert-card-heart'));
  await waitFor(() => expect(screen.getByTestId('covert-message-input')).toBeTruthy());
  fireEvent.changeText(screen.getByTestId('covert-message-input'), messageText);
}

describe('CovertMessageScreen — Hidden SOS safety rule', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockGetRecipientPublicKey.mockResolvedValue({ publicKey: Buffer.from(new Uint8Array(32)).toString('base64') });
    mockUploadCovertImage.mockResolvedValue({ key: 'file-key-1' });
    mockCreateCovertMessage.mockResolvedValue({ id: 'msg-1', createdAt: new Date().toISOString(), senderId: 's1', status: 'SENT', protocolVersion: 1, fileUrl: 'https://example.com/x.png' });
    mockActivateEmergencySilently.mockResolvedValue({ ok: true, emergencyId: 'em-1', reused: false });
    // Default to already-granted so the proactive mic-effect (present on
    // every render) doesn't fire a request during unrelated tests below —
    // the dedicated describe block for that effect overrides this.
    mockGetMicrophoneStatus.mockResolvedValue('granted');
    mockRequestMicrophonePermission.mockResolvedValue('granted');
  });

  test.each(['I need help', 'SOS', 'emergency 911'])(
    'ordinary "Send Hidden Message" never triggers the emergency workflow, even with content %p',
    async (messageText) => {
      render(<CovertMessageScreen />);
      await fillOutMessage(messageText);

      fireEvent.press(screen.getByTestId('covert-send-btn'));

      await waitFor(() => expect(mockCreateCovertMessage).toHaveBeenCalledTimes(1));
      expect(mockActivateEmergencySilently).not.toHaveBeenCalled();
    },
    15000, // first render in a cold Jest worker can exceed the 5s default under load
  );

  test('a failed covert send never triggers the emergency workflow', async () => {
    mockCreateCovertMessage.mockRejectedValue(new Error('network down'));
    render(<CovertMessageScreen />);
    await fillOutMessage('I need help');

    fireEvent.press(screen.getByTestId('covert-send-btn'));

    await waitFor(() => expect(mockCreateCovertMessage).toHaveBeenCalledTimes(1));
    expect(mockActivateEmergencySilently).not.toHaveBeenCalled();
  });

  test('"Send Hidden SOS" sends the covert message first, then triggers activation, in order', async () => {
    const callOrder: string[] = [];
    mockCreateCovertMessage.mockImplementation(async () => {
      callOrder.push('createCovertMessage');
      return { id: 'msg-1', createdAt: new Date().toISOString(), senderId: 's1', status: 'SENT', protocolVersion: 1, fileUrl: 'https://example.com/x.png' };
    });
    mockActivateEmergencySilently.mockImplementation(async () => {
      callOrder.push('activateEmergencySilently');
      return { ok: true, emergencyId: 'em-1', reused: false };
    });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const sendButton = buttons?.find((b) => b.text === 'Send');
      sendButton?.onPress?.();
    });

    render(<CovertMessageScreen />);
    await fillOutMessage('I need help');

    fireEvent.press(screen.getByTestId('covert-send-sos-btn'));

    await waitFor(() => expect(mockActivateEmergencySilently).toHaveBeenCalledTimes(1));
    expect(mockCreateCovertMessage).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['createCovertMessage', 'activateEmergencySilently']);
    expect(mockActivateEmergencySilently).toHaveBeenCalledWith(
      expect.objectContaining({ linkedCovertMessageId: 'msg-1' }),
    );
  });

  test('the encoded payload passed to embedPayloadIntoFile is identical whether or not Hidden SOS is triggered', async () => {
    const { embedPayloadIntoFile } = require('../../services/steganographyService');
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      buttons?.find((b) => b.text === 'Send')?.onPress?.();
    });

    render(<CovertMessageScreen />);
    await fillOutMessage('I need help');
    fireEvent.press(screen.getByTestId('covert-send-btn'));
    await waitFor(() => expect(mockCreateCovertMessage).toHaveBeenCalledTimes(1));
    const normalArgs = embedPayloadIntoFile.mock.calls[0];

    jest.clearAllMocks();
    mockCreateCovertMessage.mockResolvedValue({ id: 'msg-2', createdAt: new Date().toISOString(), senderId: 's1', status: 'SENT', protocolVersion: 1, fileUrl: 'x' });
    mockActivateEmergencySilently.mockResolvedValue({ ok: true, emergencyId: 'em-2', reused: false });

    render(<CovertMessageScreen />);
    await fillOutMessage('I need help');
    fireEvent.press(screen.getByTestId('covert-send-sos-btn'));
    await waitFor(() => expect(mockCreateCovertMessage).toHaveBeenCalledTimes(1));
    const sosArgs = embedPayloadIntoFile.mock.calls[0];

    expect(sosArgs).toEqual(normalArgs);
  });
});

describe('CovertMessageScreen — proactive mic-permission request', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockGetRecipientPublicKey.mockResolvedValue({ publicKey: Buffer.from(new Uint8Array(32)).toString('base64') });
  });

  test('requests mic permission on first mount when status is not granted and the flag is unset', async () => {
    mockGetMicrophoneStatus.mockResolvedValue('denied');
    mockRequestMicrophonePermission.mockResolvedValue('granted');

    render(<CovertMessageScreen />);

    await waitFor(() => expect(mockRequestMicrophonePermission).toHaveBeenCalledWith({ context: 'covert_setup' }));
    await waitFor(async () => {
      expect(await AsyncStorage.getItem('covert_mic_prompt_shown')).toBe('true');
    });
  });

  test('does not request again on a second mount once the flag is set', async () => {
    mockGetMicrophoneStatus.mockResolvedValue('denied');
    mockRequestMicrophonePermission.mockResolvedValue('denied');

    const first = render(<CovertMessageScreen />);
    await waitFor(() => expect(mockRequestMicrophonePermission).toHaveBeenCalledTimes(1));
    first.unmount();

    mockRequestMicrophonePermission.mockClear();
    render(<CovertMessageScreen />);

    // Give the mount-time effect a tick to (not) fire.
    await waitFor(() => expect(mockGetMicrophoneStatus).toHaveBeenCalled());
    expect(mockRequestMicrophonePermission).not.toHaveBeenCalled();
  });

  test('does not request when mic permission is already granted, but still sets the flag', async () => {
    mockGetMicrophoneStatus.mockResolvedValue('granted');

    render(<CovertMessageScreen />);

    await waitFor(async () => {
      expect(await AsyncStorage.getItem('covert_mic_prompt_shown')).toBe('true');
    });
    expect(mockRequestMicrophonePermission).not.toHaveBeenCalled();
  });
});
