import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Buffer } from 'buffer';
import { decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

import { useEmergencyContext } from '../context/EmergencyContext';
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function CovertMessageScreen() {
  const navigation = useNavigation<any>();
  const { contacts } = useEmergencyContext();

  const [mode, setMode] = useState<'send' | 'inbox'>('send');

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [pickedImageUri, setPickedImageUri] = useState<string | null>(null);
  const [messageText, setMessageText] = useState('');
  const [includeLocation, setIncludeLocation] = useState(false);
  const [sending, setSending] = useState(false);

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

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Photo library access is required to pick an image.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    if (!result.canceled && result.assets[0]) {
      setPickedImageUri(result.assets[0].uri);
    }
  };

  const handleSend = async () => {
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
      await createCovertMessage({ recipientContactId: selectedContactId, fileKey: key });

      Alert.alert('Sent', 'Your covert message was sent.');
      setPickedImageUri(null);
      setMessageText('');
      setSelectedContactId(null);
    } catch (error) {
      Alert.alert(
        'Could not send',
        error instanceof Error ? error.message : 'Something went wrong. Try again.',
      );
    } finally {
      setSending(false);
    }
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Covert Messages</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.modeSwitch}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'send' && styles.modeBtnActive]}
          onPress={() => setMode('send')}
        >
          <Text style={[styles.modeText, mode === 'send' && styles.modeTextActive]}>Send</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'inbox' && styles.modeBtnActive]}
          onPress={() => setMode('inbox')}
        >
          <Text style={[styles.modeText, mode === 'inbox' && styles.modeTextActive]}>Inbox</Text>
        </TouchableOpacity>
      </View>

      {mode === 'send' ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.sectionLabel}>Contact</Text>
          <View style={styles.contactList}>
            {contacts.length === 0 ? (
              <Text style={styles.hint}>Add a trusted contact first.</Text>
            ) : (
              contacts.map((contact) => (
                <TouchableOpacity
                  key={contact.id}
                  style={[styles.contactChip, selectedContactId === contact.id && styles.contactChipActive]}
                  onPress={() => setSelectedContactId(contact.id)}
                >
                  <Text
                    style={[styles.contactChipText, selectedContactId === contact.id && styles.contactChipTextActive]}
                  >
                    {contact.name}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </View>

          <Text style={styles.sectionLabel}>Image</Text>
          <TouchableOpacity style={styles.imagePickerBtn} onPress={pickImage} testID="covert-pick-image-btn">
            <Text style={styles.imagePickerText}>
              {pickedImageUri ? 'Image selected — tap to change' : 'Choose an image'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>Message</Text>
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
            style={styles.locationToggle}
            onPress={() => setIncludeLocation((v) => !v)}
          >
            <View style={[styles.checkbox, includeLocation && styles.checkboxChecked]} />
            <Text style={styles.hint}>Include my current location</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sendBtn, sending && styles.disabledBtn]}
            onPress={handleSend}
            disabled={sending}
            testID="covert-send-btn"
          >
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendBtnText}>Send Covertly</Text>}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            This only works when the recipient opens it inside Bes. Sending it through SMS, WhatsApp, or
            other apps may destroy the hidden message.
          </Text>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {loadingInbox ? (
            <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} />
          ) : inbox.length === 0 ? (
            <Text style={styles.hint}>No covert messages yet.</Text>
          ) : (
            inbox.map((message) => (
              <TouchableOpacity
                key={message.id}
                style={styles.inboxRow}
                onPress={() => handleOpenMessage(message)}
                disabled={decryptingId === message.id}
                testID="covert-inbox-row"
              >
                <View style={[styles.statusDot, message.status === 'SENT' && styles.statusDotUnread]} />
                <View style={styles.inboxCopy}>
                  <Text style={styles.inboxDate}>{fmtDate(message.createdAt)}</Text>
                  <Text style={styles.hint}>{message.status === 'SENT' ? 'Tap to decrypt' : 'Read'}</Text>
                </View>
                {decryptingId === message.id && <ActivityIndicator color="#7C3AED" />}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D1117' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#fff', fontSize: 24 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modeSwitch: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
  },
  modeBtnActive: { backgroundColor: '#7C3AED' },
  modeText: { color: '#b777ff', fontWeight: '700' },
  modeTextActive: { color: '#fff' },
  scroll: { padding: 16, paddingBottom: 40 },
  sectionLabel: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  hint: { color: '#888', fontSize: 13 },
  contactList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contactChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(124,58,237,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.3)',
  },
  contactChipActive: { backgroundColor: '#7C3AED' },
  contactChipText: { color: '#d9bcff', fontSize: 13, fontWeight: '700' },
  contactChipTextActive: { color: '#fff' },
  imagePickerBtn: {
    borderWidth: 1,
    borderColor: 'rgba(149,110,255,0.3)',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  imagePickerText: { color: '#d9bcff', fontSize: 14 },
  messageInput: {
    backgroundColor: 'rgba(5,7,21,0.78)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 15,
    minHeight: 90,
    padding: 12,
    textAlignVertical: 'top',
  },
  locationToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(149,110,255,0.5)',
  },
  checkboxChecked: { backgroundColor: '#7C3AED' },
  sendBtn: {
    marginTop: 20,
    backgroundColor: '#7C3AED',
    borderRadius: 12,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: { opacity: 0.6 },
  sendBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  disclaimer: { color: '#666', fontSize: 12, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1e2235',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#555' },
  statusDotUnread: { backgroundColor: '#4ECDC4' },
  inboxCopy: { flex: 1 },
  inboxDate: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
