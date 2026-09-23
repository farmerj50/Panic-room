import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Asset } from 'expo-asset';
import { Buffer } from 'buffer';
import { decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

import { useEmergencyContext } from '../context/EmergencyContext';
import { useSubscription } from '../context/SubscriptionContext';
import { getOrCreateKeyPair } from '../services/keyService';
import { decryptMessage, encryptMessage } from '../services/covertCryptoService';
import { decodeCovertPayload, encodeCovertPayload, generateMessageId } from '../types/CovertPayload';
import { embedPayloadIntoFile, ensurePngFile, extractPayload } from '../services/steganographyService';
import {
  CovertMessage,
  createCovertMessage,
  getCovertInbox,
  getRecipientPublicKey,
  markCovertMessageRead,
  uploadCovertImage,
} from '../services/covertMessageService';
import { getCurrentLocation } from '../services/locationService';
import { getMicrophoneStatus, requestMicrophonePermission } from '../services/corePermissions';
import { ApiError } from '../services/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingHiddenSos,
  getPendingHiddenSos,
  PendingHiddenSos,
} from '../hooks/useAppStateEmergencyGuard';

const COVERT_MIC_PROMPT_KEY = 'covert_mic_prompt_shown';

// Cover images are picked from a small built-in set rather than the device's
// photo library — no file-system access, and no risk of accidentally
// choosing a photo that reveals more than intended.
const COVER_CARDS = [
  { id: 'heart', label: 'Heart', source: require('../../assets/covert-cards/heart.png') },
  { id: 'star', label: 'Star', source: require('../../assets/covert-cards/star.png') },
  { id: 'moon', label: 'Moon', source: require('../../assets/covert-cards/moon.png') },
  { id: 'sun', label: 'Sun', source: require('../../assets/covert-cards/sun.png') },
  { id: 'wave', label: 'Wave', source: require('../../assets/covert-cards/wave.png') },
  { id: 'flower', label: 'Flower', source: require('../../assets/covert-cards/flower.png') },
  { id: 'sparkle', label: 'Sparkle', source: require('../../assets/covert-cards/sparkle.png') },
  { id: 'leaf', label: 'Leaf', source: require('../../assets/covert-cards/leaf.png') },
] as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function CovertMessageScreen() {
  const navigation = useNavigation<any>();
  const { contacts, activateEmergencySilently } = useEmergencyContext();
  const { isPremium } = useSubscription();

  const [mode, setMode] = useState<'send' | 'inbox'>('send');

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [includeLocation, setIncludeLocation] = useState(false);
  const [sending, setSending] = useState(false);
  const [isSosSend, setIsSosSend] = useState(false);

  // Local, low-key confirmation for Hidden SOS — deliberately never a loud
  // Alert.alert (see the send buttons below): a small dot near the SOS
  // button, not a banner saying "EMERGENCY ACTIVATED". 'idle' renders
  // nothing at all.
  const [sosIndicator, setSosIndicator] = useState<'idle' | 'activating' | 'confirmed' | 'pendingRetry'>('idle');
  const [pendingRetry, setPendingRetry] = useState<PendingHiddenSos | null>(null);

  const [inbox, setInbox] = useState<CovertMessage[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [decryptingId, setDecryptingId] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    try {
      const messages = await getCovertInbox();
      setInbox(messages);
    } catch {
      // Best-effort — leave the previous list showing rather than clearing it.
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'inbox') loadInbox();
  }, [mode, loadInbox]);

  // A prior Hidden SOS that failed even after its silent retry (see
  // EmergencyContext.activateEmergencySilently) leaves this flag behind —
  // surface it here as a low-key inline notice rather than a loud alert.
  useEffect(() => {
    getPendingHiddenSos()
      .then(setPendingRetry)
      .catch(() => {});
  }, []);

  // Hidden SOS records audio silently (see EmergencyContext.runCoreActivation's
  // skipMicPermissionPrompt) because it can't show a dialog without blowing
  // its cover — so mic permission has to be asked here instead, proactively,
  // the first time the user opens Covert Messaging. Gated on a one-time
  // AsyncStorage flag so re-opening this screen after a decline doesn't turn
  // into exactly the nagging pattern the contextual-permission redesign is
  // meant to avoid; any later re-ask happens via the normal per-activation
  // guard for the screen-based (non-silent) emergency path.
  useEffect(() => {
    (async () => {
      const alreadyPrompted = await AsyncStorage.getItem(COVERT_MIC_PROMPT_KEY);
      if (alreadyPrompted) return;
      try {
        const status = await getMicrophoneStatus();
        if (status !== 'granted') {
          await requestMicrophonePermission({ context: 'covert_setup' });
        }
      } finally {
        await AsyncStorage.setItem(COVERT_MIC_PROMPT_KEY, 'true');
      }
    })();
  }, []);

  const retryPendingHiddenSos = useCallback(async () => {
    if (!pendingRetry) return;
    const result = await activateEmergencySilently({
      reason: 'covert-hidden-sos-retry',
      linkedCovertMessageId: pendingRetry.linkedCovertMessageId,
    });
    if (result.ok) {
      await clearPendingHiddenSos().catch(() => {});
      setPendingRetry(null);
      setSosIndicator('confirmed');
      setTimeout(() => setSosIndicator('idle'), 4000);
    }
  }, [pendingRetry, activateEmergencySilently]);

  const selectCard = async (card: (typeof COVER_CARDS)[number]) => {
    try {
      const asset = Asset.fromModule(card.source);
      await asset.downloadAsync();
      setPickedImageUri(asset.localUri ?? asset.uri);
      setSelectedCardId(card.id);
    } catch {
      Alert.alert('Could not load image', 'Try a different one.');
    }
  };

  // triggerSos is a plain boolean passed explicitly from each button's
  // onPress (see the JSX below) — it is never derived from messageText or
  // any other content. This is the structural enforcement of the hard
  // safety rule: an ordinary "Send Hidden Message" must never trigger
  // emergency actions, no matter what the hidden text says.
  const handleSend = async (triggerSos: boolean) => {
    if (!isPremium) {
      navigation.navigate('Paywall', { reason: 'covert-messaging' });
      return;
    }
    if (!selectedContactId) {
      Alert.alert('Choose a contact', 'Select who this covert message is for.');
      return;
    }
    if (!pickedImageUri) {
      Alert.alert('Choose an image', 'Pick an image to hide the message in.');
      return;
    }
    if (!messageText.trim()) {
      Alert.alert('Write a message', 'Enter the message to send.');
      return;
    }

    setIsSosSend(triggerSos);
    setSending(true);
    try {
      const { publicKey: recipientPublicKeyBase64 } = await getRecipientPublicKey(selectedContactId);
      const recipientPublicKey = new Uint8Array(Buffer.from(recipientPublicKeyBase64, 'base64'));

      const myKeyPair = await getOrCreateKeyPair();
      const { ciphertext, nonce } = encryptMessage(
        decodeUTF8(messageText.trim()),
        recipientPublicKey,
        myKeyPair.secretKey,
      );

      let location: { latitude: number; longitude: number } | undefined;
      if (includeLocation) {
        const current = await getCurrentLocation();
        location = current ?? undefined;
      }

      const payload = encodeCovertPayload({
        senderPublicKey: myKeyPair.publicKey,
        nonce,
        ciphertext,
        messageId: generateMessageId(),
        timestamp: Date.now(),
        location,
      });

      const pngUri = await ensurePngFile(pickedImageUri);
      const embeddedUri = await embedPayloadIntoFile(pngUri, payload);
      const { key } = await uploadCovertImage(embeddedUri);
      // Everything above this line — and this call itself — is byte-for-byte
      // identical whether or not this is a Hidden SOS send. Only what
      // happens after the covert message has successfully sent differs.
      const sentMessage = await createCovertMessage({ recipientContactId: selectedContactId, fileKey: key });

      setPickedImageUri(null);
      setSelectedCardId(null);
      setMessageText('');
      setSelectedContactId(null);

      if (!triggerSos) {
        Alert.alert('Sent', 'Your covert message was sent.');
        return;
      }

      // SOS-only, strictly after the covert send already succeeded. A
      // failure here must never look like the message itself failed to
      // send — it did send. See activateEmergencySilently's own internal
      // retry/pending-flag handling for what happens if this fails.
      setSosIndicator('activating');
      const result = await activateEmergencySilently({
        reason: 'covert-hidden-sos',
        linkedCovertMessageId: sentMessage.id,
      });
      setSosIndicator(result.ok ? 'confirmed' : 'pendingRetry');
      if (result.ok) {
        setTimeout(() => setSosIndicator('idle'), 4000);
      } else {
        getPendingHiddenSos().then(setPendingRetry).catch(() => {});
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PREMIUM_REQUIRED') {
        Alert.alert(
          'Still activating',
          'Bes Premium is still activating on our end. Please try again in a moment.',
          [{ text: 'OK', onPress: () => navigation.navigate('Paywall', { reason: 'covert-messaging' }) }],
        );
      } else {
        Alert.alert(
          'Could not send',
          error instanceof Error ? error.message : 'Something went wrong. Try again.',
        );
      }
    } finally {
      setSending(false);
    }
  };

  // The one moment it's acceptable to interrupt with a dialog — everything
  // after this confirmation is silent. Worded blandly, not alarmingly, in
  // case someone glances at the screen while it's up.
  const confirmSendHiddenSos = () => {
    Alert.alert('Send this?', 'This will also alert your trusted contacts.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => { void handleSend(true); } },
    ]);
  };

  const handleOpenMessage = async (message: CovertMessage) => {
    setDecryptingId(message.id);
    try {
      const response = await fetch(message.fileUrl);
      if (!response.ok) throw new Error('Could not download the image.');
      const arrayBuffer = await response.arrayBuffer();

      // We already have the downloaded bytes in memory — decode directly
      // rather than writing a throwaway file to disk first.
      const rawPayload = extractPayload(Buffer.from(arrayBuffer));
      if (!rawPayload) {
        Alert.alert('No hidden message found', 'This image does not contain a covert message.');
        return;
      }

      const decoded = decodeCovertPayload(rawPayload);
      const myKeyPair = await getOrCreateKeyPair();
      const plaintext = decryptMessage(decoded.ciphertext, decoded.nonce, decoded.senderPublicKey, myKeyPair.secretKey);

      if (!plaintext) {
        Alert.alert('Could not decrypt', 'This message was not encrypted for your key.');
        return;
      }

      const text = encodeUTF8(plaintext);
      const locationText = decoded.location
        ? `\n\nLocation: ${decoded.location.latitude.toFixed(5)}, ${decoded.location.longitude.toFixed(5)}`
        : '';
      Alert.alert(`Message — ${fmtDate(decoded.timestamp ? new Date(decoded.timestamp).toISOString() : message.createdAt)}`, `${text}${locationText}`);

      if (message.status === 'SENT') {
        await markCovertMessageRead(message.id);
        setInbox((current) => current.map((m) => (m.id === message.id ? { ...m, status: 'READ' } : m)));
      }
    } catch (error) {
      Alert.alert('Could not open message', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setDecryptingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.82}
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
        >
          <Text style={styles.iconButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Covert Messages</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.modeSwitch}>
          <TouchableOpacity
            activeOpacity={0.82}
            style={[styles.modeBtn, mode === 'send' && styles.modeBtnActive]}
            onPress={() => setMode('send')}
          >
            <Text style={[styles.modeText, mode === 'send' && styles.modeTextActive]}>Send</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            style={[styles.modeBtn, mode === 'inbox' && styles.modeBtnActive]}
            onPress={() => setMode('inbox')}
          >
            <Text style={[styles.modeText, mode === 'inbox' && styles.modeTextActive]}>Inbox</Text>
          </TouchableOpacity>
        </View>

        {mode === 'send' ? (
          <>
            <Text style={styles.sectionLabel}>Contact</Text>
            <LinearGradient
              colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
              style={styles.card}
            >
              {contacts.length === 0 ? (
                <Text style={styles.hint}>Add a trusted contact first.</Text>
              ) : (
                <View style={styles.contactList}>
                  {contacts.map((contact) => (
                    <TouchableOpacity
                      key={contact.id}
                      activeOpacity={0.84}
                      style={[styles.contactChip, selectedContactId === contact.id && styles.contactChipActive]}
                      onPress={() => setSelectedContactId(contact.id)}
                      testID={`covert-contact-${contact.id}`}
                    >
                      <Text
                        style={[
                          styles.contactChipText,
                          selectedContactId === contact.id && styles.contactChipTextActive,
                        ]}
                      >
                        {contact.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </LinearGradient>

            <Text style={styles.sectionLabel}>Image</Text>
            <LinearGradient
              colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
              style={styles.card}
            >
              <Text style={styles.hint}>
                {selectedCardId ? 'Selected — tap another to change' : 'Pick a cover image'}
              </Text>
              <View style={styles.cardGrid} testID="covert-pick-image-btn">
                {COVER_CARDS.map((card) => (
                  <TouchableOpacity
                    key={card.id}
                    activeOpacity={0.84}
                    style={[styles.cardThumbWrap, selectedCardId === card.id && styles.cardThumbWrapActive]}
                    onPress={() => selectCard(card)}
                    testID={`covert-card-${card.id}`}
                  >
                    <Image source={card.source} style={styles.cardThumb} />
                  </TouchableOpacity>
                ))}
              </View>
            </LinearGradient>

            <Text style={styles.sectionLabel}>Message</Text>
            <LinearGradient
              colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
              style={styles.card}
            >
              <TextInput
                style={styles.messageInput}
                placeholder="What do you want to say?"
                placeholderTextColor="#7f7899"
                value={messageText}
                onChangeText={setMessageText}
                multiline
                testID="covert-message-input"
              />

              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.locationToggle}
                onPress={() => setIncludeLocation((v) => !v)}
              >
                <View style={[styles.checkbox, includeLocation && styles.checkboxChecked]} />
                <Text style={styles.hint}>Include my current location</Text>
              </TouchableOpacity>
            </LinearGradient>

            {pendingRetry ? (
              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.retryBanner}
                onPress={retryPendingHiddenSos}
                testID="covert-sos-retry-banner"
              >
                <Text style={styles.retryBannerText}>
                  Your last Hidden SOS didn't fully go through — tap to retry.
                </Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              activeOpacity={0.86}
              style={[styles.sendBtn, sending && styles.disabledBtn]}
              onPress={() => { void handleSend(false); }}
              disabled={sending}
              testID="covert-send-btn"
            >
              {sending && !isSosSend ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>Send Hidden Message</Text>
              )}
            </TouchableOpacity>

            <View style={styles.sosRow}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={[styles.sosBtn, sending && styles.disabledBtn]}
                onPress={confirmSendHiddenSos}
                disabled={sending}
                testID="covert-send-sos-btn"
              >
                {sending && isSosSend ? (
                  <ActivityIndicator color="#ef445b" />
                ) : (
                  <Text style={styles.sosBtnText}>Send Hidden SOS</Text>
                )}
              </TouchableOpacity>
              {sosIndicator !== 'idle' ? (
                <View
                  style={[
                    styles.sosIndicatorDot,
                    sosIndicator === 'confirmed' && styles.sosIndicatorConfirmed,
                    sosIndicator === 'pendingRetry' && styles.sosIndicatorPending,
                  ]}
                  testID="covert-sos-indicator"
                />
              ) : null}
            </View>

            <Text style={styles.disclaimer}>
              This only works when the recipient opens it inside Bes. Sending it through SMS, WhatsApp, or
              other apps may destroy the hidden message.
            </Text>
          </>
        ) : (
          <LinearGradient
            colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
            style={styles.card}
          >
            {loadingInbox ? (
              <ActivityIndicator color="#b777ff" style={styles.inboxLoader} />
            ) : inbox.length === 0 ? (
              <Text style={styles.hint}>No covert messages yet.</Text>
            ) : (
              inbox.map((message, idx) => (
                <TouchableOpacity
                  key={message.id}
                  activeOpacity={0.84}
                  style={[styles.inboxRow, idx < inbox.length - 1 && styles.inboxRowBorder]}
                  onPress={() => handleOpenMessage(message)}
                  disabled={decryptingId === message.id}
                  testID="covert-inbox-row"
                >
                  <View style={[styles.statusDot, message.status === 'SENT' && styles.statusDotUnread]} />
                  <View style={styles.inboxCopy}>
                    <Text style={styles.inboxDate}>{fmtDate(message.createdAt)}</Text>
                    <Text style={styles.hint}>{message.status === 'SENT' ? 'Tap to decrypt' : 'Read'}</Text>
                  </View>
                  {decryptingId === message.id && <ActivityIndicator color="#b777ff" />}
                </TouchableOpacity>
              ))
            )}
          </LinearGradient>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    marginBottom: 6,
  },
  headerSpacer: { height: 38, width: 38 },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(199,140,255,0.24)',
    borderRadius: 19,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  iconButtonText: { color: '#fff', fontSize: 18, fontWeight: '900' },
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  scroll: { padding: 18, paddingBottom: 60, maxWidth: 620, width: '100%', alignSelf: 'center' },
  modeSwitch: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
    padding: 5,
  },
  modeBtn: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  modeBtnActive: { backgroundColor: '#7c3aed' },
  modeText: { color: '#b9b0cd', fontSize: 13, fontWeight: '900' },
  modeTextActive: { color: '#fff' },
  sectionLabel: {
    color: '#b8afca',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 12,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  card: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    padding: 18,
  },
  hint: { color: '#a9a1bd', fontSize: 13 },
  contactList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contactChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
  },
  contactChipActive: { backgroundColor: '#7C3AED', borderColor: '#7c3aed' },
  contactChipText: { color: '#d9bcff', fontSize: 13, fontWeight: '700' },
  contactChipTextActive: { color: '#fff' },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  cardThumbWrap: {
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
    height: 72,
    width: 72,
  },
  cardThumbWrapActive: { borderColor: '#7c3aed' },
  cardThumb: { height: '100%', width: '100%' },
  messageInput: {
    backgroundColor: 'rgba(5,7,21,0.78)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 15,
    minHeight: 100,
    padding: 14,
    textAlignVertical: 'top',
  },
  locationToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(149,110,255,0.5)',
  },
  checkboxChecked: { backgroundColor: '#7C3AED', borderColor: '#7c3aed' },
  sendBtn: {
    backgroundColor: '#ef445b',
    borderRadius: 14,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: { opacity: 0.62 },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  // Deliberately de-emphasized relative to sendBtn — outlined, not a loud
  // filled block — this screen is supposed to look boring at a glance.
  sosRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  sosBtn: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(239,68,91,0.4)',
    borderRadius: 14,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosBtnText: { color: '#ef445b', fontSize: 15, fontWeight: '900' },
  // Small, quiet dot — never a modal, never the words "SOS"/"emergency"/
  // "alert" in the indicator itself. Reuses statusDotUnread's teal for
  // "confirmed" so no new alarm color enters the palette.
  sosIndicatorDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7f7899' },
  sosIndicatorConfirmed: { backgroundColor: '#4ee1d5' },
  sosIndicatorPending: { backgroundColor: '#e0b34d' },
  retryBanner: {
    backgroundColor: 'rgba(224,179,77,0.12)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  retryBannerText: { color: '#e0b34d', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  disclaimer: { color: '#8b839f', fontSize: 12, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  inboxLoader: { marginVertical: 24 },
  inboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 64,
    paddingVertical: 12,
  },
  inboxRowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#555' },
  statusDotUnread: { backgroundColor: '#4ee1d5' },
  inboxCopy: { flex: 1 },
  inboxDate: { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 2 },
});
