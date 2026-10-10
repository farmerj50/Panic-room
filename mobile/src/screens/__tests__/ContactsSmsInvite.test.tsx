import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';

import type { Contact } from '../../types/contact';

let mockContacts: Contact[] = [];
const mockSetContacts = jest.fn();
const mockLoadContacts = jest.fn().mockResolvedValue(undefined);
jest.mock('../../context/EmergencyContext', () => ({
  useEmergencyContext: () => ({ contacts: mockContacts, setContacts: mockSetContacts, loadContacts: mockLoadContacts }),
}));

jest.mock('../../context/SubscriptionContext', () => ({
  useSubscription: () => ({ contactLimit: 3 }),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(cb, []);
  },
}));

jest.mock('../../context/TourContext', () => ({
  useTour: () => ({ phase: 'idle', currentStep: null }),
  useTourTarget: () => ({ current: null }),
  useTourTargetPress: (_key: string, handler: () => void) => handler,
}));

jest.mock('../../components/TourStepCard', () => () => null);

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

const mockCreateSmsInvite = jest.fn();
const mockSaveContact = jest.fn();
jest.mock('../../services/contactService', () => ({
  createSmsInvite: (...args: unknown[]) => mockCreateSmsInvite(...args),
  saveContactToBackend: (...args: unknown[]) => mockSaveContact(...args),
  deleteContactFromBackend: jest.fn(),
  updateContactInBackend: jest.fn(),
}));

import ContactsScreen from '../ContactsScreen';
import { describeSmsResult } from '../../utils/smsStatus';

const contact = (over: Partial<Contact>): Contact => ({
  id: 'c1',
  name: 'Sam',
  phoneNumber: '+15551230001',
  isPriority: true,
  smsStatus: 'pending',
  ...over,
});

describe('trusted-contact SMS status and invites', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    mockCreateSmsInvite.mockResolvedValue({
      url: 'https://bes.test/sms-consent/tok',
      shareMessage: "I've added you as an emergency contact in Bes. https://bes.test/sms-consent/tok",
      expiresAt: '2026-10-24T00:00:00Z',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['accepted', 'Texts on', false],
    ['pending', 'Texts need their OK', true],
    ['declined', 'Declined texts', true],
    ['number_changed', 'Number changed — re-invite', true],
    ['opted_out', 'Replied STOP to texts', false],
  ] as const)('%s contact shows "%s" (invite button: %s)', (smsStatus, label, canInvite) => {
    mockContacts = [contact({ smsStatus })];
    render(<ContactsScreen />);
    expect(screen.getByTestId('contact-sms-status')).toHaveTextContent(label);
    expect(Boolean(screen.queryByTestId('contact-sms-invite-btn'))).toBe(canInvite);
  });

  test('contacts are re-fetched when the screen comes into focus (fresh SMS status)', () => {
    mockContacts = [contact({ smsStatus: 'pending' })];
    render(<ContactsScreen />);
    expect(mockLoadContacts).toHaveBeenCalled();
  });

  test('Send SMS invite creates a link and opens the share sheet with it', async () => {
    mockContacts = [contact({ smsStatus: 'pending' })];
    render(<ContactsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('contact-sms-invite-btn'));
    });
    expect(mockCreateSmsInvite).toHaveBeenCalledWith('c1');
    expect(Share.share).toHaveBeenCalledWith({
      message: expect.stringContaining('https://bes.test/sms-consent/tok'),
    });
  });

  test('a failed invite shows an error instead of opening the share sheet', async () => {
    mockContacts = [contact({ smsStatus: 'pending' })];
    mockCreateSmsInvite.mockRejectedValue(new Error('offline'));
    render(<ContactsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('contact-sms-invite-btn'));
    });
    expect(Share.share).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Could not create invite', expect.any(String));
  });
});

describe('describeSmsResult (emergency status line)', () => {
  test('SMS switched off', () => {
    expect(describeSmsResult({ smsAvailable: false, error: 'SMS_DISABLED', providerConfigured: true, sent: false, notifiedCount: 0 })).toBe(
      "Emergency texts aren't enabled yet — recording and calls continue.",
    );
  });

  test('provider unavailable', () => {
    expect(describeSmsResult({ smsAvailable: false, error: 'NOT_CONFIGURED', providerConfigured: false, sent: false, notifiedCount: 0 })).toBe(
      'SMS unavailable — recording and calls continue.',
    );
  });

  test('queued, never "delivered", with ineligible count', () => {
    const text = describeSmsResult({
      smsAvailable: true,
      providerConfigured: true,
      contactCount: 3,
      eligibleCount: 1,
      ineligibleCount: 2,
      queuedCount: 1,
      sent: true,
      notifiedCount: 1,
    });
    expect(text).toBe('SMS queued for 1 of 3 contacts · 2 not eligible for SMS alerts');
    expect(text).not.toMatch(/deliver/i);
  });

  test('nobody has accepted yet', () => {
    expect(
      describeSmsResult({ smsAvailable: true, providerConfigured: true, contactCount: 2, eligibleCount: 0, ineligibleCount: 2, queuedCount: 0, sent: false, notifiedCount: 0 }),
    ).toBe('No contacts have accepted SMS alerts yet — send invites from Contacts. Calls are unaffected.');
  });
});
