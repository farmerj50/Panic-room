import { useState } from 'react';
import {
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { useEmergencyContext } from '../context/EmergencyContext';
import { deleteContactFromBackend, saveContactToBackend, updateContactInBackend } from '../services/contactService';
import { Contact } from '../types/contact';

import resourcesCard from '../../assets/images/resources-card.png';

const CONTACT_COLORS = ['#d94fa3', '#fb7a33', '#17b8ac', '#8b5cf6', '#4aa8ff', '#f59e0b'];

function formatPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export default function ContactsScreen() {
  const navigation = useNavigation<any>();
  const { contacts, setContacts } = useEmergencyContext();
  const { width } = useWindowDimensions();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(contacts.length === 0);
  const [editMode, setEditMode] = useState(false);

  const isWide = width >= 900;
  const pageMaxWidth = isWide ? 1180 : 620;

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('Profile');
  };

  const handleAdd = async () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Missing info', 'Please enter both a name and phone number.');
      return;
    }

    setSaving(true);
    try {
      const saved = await saveContactToBackend({
        name: name.trim(),
        phoneNumber: phone.trim(),
      });
      await setContacts([...contacts, saved]);
      setName('');
      setPhone('');
      setShowAdd(false);
    } catch {
      Alert.alert('Error', 'Could not save contact. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Remove contact?', 'This contact will be removed from your trusted circle.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteContactFromBackend(id);
            await setContacts(contacts.filter((contact) => contact.id !== id));
          } catch {
            Alert.alert('Error', 'Could not remove contact. Check your connection.');
          }
        },
      },
    ]);
  };

  const handleTogglePriority = async (id: string) => {
    const target = contacts.find((contact) => contact.id === id);
    if (!target) return;

    try {
      const updatedContact = await updateContactInBackend(id, {
        isPriority: !target.isPriority,
      });
      const updated = contacts.map((contact) => {
        if (contact.id === id) return updatedContact;
        return updatedContact.isPriority ? { ...contact, isPriority: false } : contact;
      });
      await setContacts(updated);
    } catch {
      Alert.alert('Error', 'Could not update contact priority. Check your connection.');
    }
  };

  const textContact = async (contact: Contact) => {
    const body = encodeURIComponent('Checking in from PanicRoom. Are you safe?');
    await Linking.openURL(`sms:${contact.phoneNumber}?body=${body}`);
  };

  const sortedContacts = [...contacts].sort(
    (a, b) => Number(b.isPriority) - Number(a.isPriority),
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { maxWidth: pageMaxWidth }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack} style={styles.headerButton} activeOpacity={0.82}>
              <Text style={styles.headerButtonText}>{'<'}</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Emergency Contacts</Text>
            <TouchableOpacity
              onPress={() => setShowAdd((current) => !current)}
              style={styles.addTopButton}
              activeOpacity={0.82}
            >
              <Text style={styles.addTopText}>+</Text>
            </TouchableOpacity>
          </View>

          <LinearGradient
            colors={['rgba(12, 16, 45, 0.98)', 'rgba(10, 12, 38, 0.94)']}
            style={[styles.hero, !isWide && styles.heroNarrow]}
          >
            <View style={[styles.heroIcon, !isWide && styles.heroIconNarrow]}>
              <Text style={styles.heroIconText}>C</Text>
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>
                Your people. Your <Text style={styles.heroAccent}>safety.</Text>
              </Text>
              <Text style={styles.heroText}>
                Add trusted contacts who can help you in an emergency. They will be notified if
                you need help.
              </Text>
            </View>
            {isWide && (
              <ImageBackground
                source={resourcesCard}
                resizeMode="cover"
                imageStyle={styles.heroArtImage}
                style={styles.heroArt}
              >
                <LinearGradient
                  colors={['rgba(10,12,38,0.08)', 'rgba(10,12,38,0.86)']}
                  style={StyleSheet.absoluteFill}
                />
              </ImageBackground>
            )}
          </LinearGradient>

          <View style={styles.contactsHeader}>
            <Text style={styles.sectionTitle}>Your Contacts</Text>
            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.editButton}
              onPress={() => setEditMode((current) => !current)}
            >
              <Text style={styles.editIcon}>E</Text>
              <Text style={styles.editText}>{editMode ? 'Done' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          <LinearGradient
            colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
            style={styles.contactsCard}
          >
            {sortedContacts.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Text style={styles.emptyIconText}>C</Text>
                </View>
                <Text style={styles.emptyTitle}>No contacts yet</Text>
                <Text style={styles.emptyText}>Add someone you trust below.</Text>
              </View>
            ) : (
              sortedContacts.map((contact, index) => {
                const color = CONTACT_COLORS[index % CONTACT_COLORS.length];
                return (
                  <View
                    key={contact.id}
                    style={[
                      styles.contactRow,
                      index < sortedContacts.length - 1 && styles.contactRowBorder,
                    ]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.82}
                      onPress={() => handleTogglePriority(contact.id)}
                      style={[styles.avatar, { backgroundColor: `${color}d9` }]}
                    >
                      <Text style={styles.avatarText}>{getInitial(contact.name)}</Text>
                      {contact.isPriority && (
                        <View style={styles.priorityStar}>
                          <Text style={styles.priorityStarText}>*</Text>
                        </View>
                      )}
                    </TouchableOpacity>

                    <View style={styles.contactCopy}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.contactPhone}>{formatPhone(contact.phoneNumber)}</Text>
                    </View>

                    <TouchableOpacity
                      activeOpacity={0.82}
                      style={[
                        styles.statusBadge,
                        contact.isPriority ? styles.priorityBadge : styles.secondaryBadge,
                      ]}
                      onPress={() => handleTogglePriority(contact.id)}
                    >
                      <Text
                        style={[
                          styles.statusBadgeText,
                          contact.isPriority ? styles.priorityBadgeText : styles.secondaryBadgeText,
                        ]}
                      >
                        {contact.isPriority ? '* Priority' : 'S Secondary'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.82}
                      style={[
                        styles.circleAction,
                        contact.isPriority && styles.circleActionActive,
                      ]}
                      onPress={() => handleTogglePriority(contact.id)}
                    >
                      <Text style={styles.circleActionText}>P</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.82}
                      style={styles.circleAction}
                      onPress={() => textContact(contact)}
                    >
                      <Text style={styles.circleActionText}>M</Text>
                    </TouchableOpacity>

                    {editMode ? (
                      <TouchableOpacity
                        activeOpacity={0.82}
                        style={styles.removeButton}
                        onPress={() => handleDelete(contact.id)}
                      >
                        <Text style={styles.removeButtonText}>Remove</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.rowArrow}>{'>'}</Text>
                    )}
                  </View>
                );
              })
            )}
          </LinearGradient>

          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.addContactCard}
            onPress={() => setShowAdd((current) => !current)}
          >
            <View style={styles.addIconCircle}>
              <Text style={styles.addIconText}>+</Text>
            </View>
            <View style={styles.addCopy}>
              <Text style={styles.addTitle}>Add New Contact</Text>
              <Text style={styles.addText}>Add someone you trust to help in an emergency.</Text>
            </View>
            <Text style={styles.rowArrow}>{showAdd ? 'v' : '>'}</Text>
          </TouchableOpacity>

          {showAdd && (
            <LinearGradient
              colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
              style={styles.form}
            >
              <Text style={styles.formTitle}>Contact Details</Text>
              <View style={styles.formGrid}>
                <TextInput
                  style={styles.input}
                  placeholder="Name"
                  placeholderTextColor="#7f7899"
                  value={name}
                  onChangeText={setName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Phone number"
                  placeholderTextColor="#7f7899"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
              <TouchableOpacity
                style={[styles.addButton, saving && styles.disabledButton]}
                onPress={handleAdd}
                disabled={saving}
                activeOpacity={0.84}
              >
                <Text style={styles.addButtonText}>{saving ? 'Saving...' : '+ Add Contact'}</Text>
              </TouchableOpacity>
            </LinearGradient>
          )}

          <LinearGradient
            colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
            style={styles.priorityInfo}
          >
            <View style={styles.priorityInfoIcon}>
              <Text style={styles.priorityInfoIconText}>*</Text>
            </View>
            <View style={styles.priorityInfoCopy}>
              <Text style={styles.priorityInfoTitle}>Set a Priority</Text>
              <Text style={styles.priorityInfoText}>
                Your priority contact will be called or notified first during an emergency.
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.learnButton}
              onPress={() => navigation.navigate('SafetyPlan')}
            >
              <Text style={styles.learnText}>Learn more</Text>
              <Text style={styles.learnInfo}>i</Text>
            </TouchableOpacity>
          </LinearGradient>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  keyboard: { flex: 1 },
  scroll: {
    alignSelf: 'center',
    paddingBottom: 42,
    paddingHorizontal: 18,
    paddingTop: 16,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  headerButtonText: { color: '#fff', fontSize: 28, fontWeight: '500' },
  title: { color: '#fff', fontSize: 24, fontWeight: '900' },
  addTopButton: {
    alignItems: 'center',
    borderColor: '#9d65ff',
    borderRadius: 22,
    borderWidth: 2,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  addTopText: { color: '#b777ff', fontSize: 28, fontWeight: '600', lineHeight: 30 },
  hero: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 28,
    marginBottom: 22,
    minHeight: 198,
    overflow: 'hidden',
    padding: 28,
  },
  heroNarrow: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(137, 76, 255, 0.24)',
    borderRadius: 56,
    height: 112,
    justifyContent: 'center',
    width: 112,
  },
  heroIconNarrow: {
    borderRadius: 42,
    height: 84,
    width: 84,
  },
  heroIconText: { color: '#b777ff', fontSize: 42, fontWeight: '900' },
  heroCopy: { flex: 1, minWidth: 260, zIndex: 2 },
  heroTitle: { color: '#fff', fontSize: 34, fontWeight: '900', lineHeight: 42, marginBottom: 14 },
  heroAccent: { color: '#9f58ff' },
  heroText: { color: '#d8d2e8', fontSize: 20, lineHeight: 31, maxWidth: 660 },
  heroArt: {
    alignSelf: 'stretch',
    borderRadius: 18,
    minHeight: 140,
    overflow: 'hidden',
    width: 300,
  },
  heroArtImage: { borderRadius: 18 },
  contactsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 22,
  },
  sectionTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  editButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.12)',
    borderColor: 'rgba(183,119,255,0.46)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 20,
  },
  editIcon: { color: '#a461ff', fontSize: 18, fontWeight: '900' },
  editText: { color: '#b777ff', fontSize: 18, fontWeight: '900' },
  contactsCard: {
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    overflow: 'hidden',
    paddingHorizontal: 26,
    paddingVertical: 12,
  },
  emptyState: { alignItems: 'center', minHeight: 220, justifyContent: 'center' },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.2)',
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    marginBottom: 14,
    width: 68,
  },
  emptyIconText: { color: '#b777ff', fontSize: 28, fontWeight: '900' },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 6 },
  emptyText: { color: '#a9a1bd', fontSize: 15 },
  contactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    minHeight: 116,
    paddingVertical: 18,
  },
  contactRowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  avatar: {
    alignItems: 'center',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    position: 'relative',
    width: 72,
  },
  avatarText: { color: '#fff', fontSize: 31, fontWeight: '900' },
  priorityStar: {
    alignItems: 'center',
    backgroundColor: '#f7b731',
    borderRadius: 11,
    bottom: 2,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 22,
  },
  priorityStarText: { color: '#fff', fontSize: 15, fontWeight: '900', lineHeight: 18 },
  contactCopy: { flex: 1, minWidth: 0 },
  contactName: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 8 },
  contactPhone: { color: '#aaa4bb', fontSize: 21 },
  statusBadge: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 148,
    paddingHorizontal: 18,
  },
  priorityBadge: {
    backgroundColor: 'rgba(137,76,255,0.12)',
    borderColor: 'rgba(183,119,255,0.38)',
  },
  secondaryBadge: {
    backgroundColor: 'rgba(245,126,35,0.08)',
    borderColor: 'rgba(245,126,35,0.34)',
  },
  statusBadgeText: { fontSize: 18, fontWeight: '900' },
  priorityBadgeText: { color: '#b777ff' },
  secondaryBadgeText: { color: '#fb7a33' },
  circleAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.16)',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  circleActionActive: {
    backgroundColor: 'rgba(247,183,49,0.22)',
    borderColor: 'rgba(247,183,49,0.5)',
    borderWidth: 1,
  },
  circleActionText: { color: '#b777ff', fontSize: 22, fontWeight: '900' },
  rowArrow: { color: '#9b94ac', fontSize: 32, fontWeight: '300' },
  removeButton: {
    alignItems: 'center',
    borderColor: '#ef445b',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
  },
  removeButtonText: { color: '#ff6b7d', fontSize: 13, fontWeight: '900' },
  addContactCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 18, 49, 0.8)',
    borderColor: 'rgba(149, 110, 255, 0.45)',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
    minHeight: 116,
    padding: 24,
  },
  addIconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.18)',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  addIconText: { color: '#a461ff', fontSize: 43, fontWeight: '300', lineHeight: 46 },
  addCopy: { flex: 1, minWidth: 0 },
  addTitle: { color: '#b777ff', fontSize: 22, fontWeight: '900', marginBottom: 8 },
  addText: { color: '#aaa4bb', fontSize: 18, lineHeight: 25 },
  form: {
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    padding: 20,
  },
  formTitle: { color: '#fff', fontSize: 17, fontWeight: '900', marginBottom: 14 },
  formGrid: { gap: 12, marginBottom: 14 },
  input: {
    backgroundColor: 'rgba(5, 7, 21, 0.78)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 15,
    minHeight: 50,
    outlineStyle: 'none' as never,
    paddingHorizontal: 14,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 50,
  },
  disabledButton: { opacity: 0.62 },
  addButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  priorityInfo: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.22)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 20,
    minHeight: 132,
    overflow: 'hidden',
    padding: 24,
  },
  priorityInfoIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(247,183,49,0.2)',
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  priorityInfoIconText: { color: '#f7b731', fontSize: 31, fontWeight: '900' },
  priorityInfoCopy: { flex: 1, minWidth: 0 },
  priorityInfoTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 8 },
  priorityInfoText: { color: '#aaa4bb', fontSize: 17, lineHeight: 24 },
  learnButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.12)',
    borderColor: 'rgba(149,110,255,0.26)',
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 28,
  },
  learnText: { color: '#b777ff', fontSize: 18, fontWeight: '900' },
  learnInfo: {
    borderColor: '#b777ff',
    borderRadius: 12,
    borderWidth: 1.5,
    color: '#b777ff',
    fontSize: 15,
    fontWeight: '900',
    height: 24,
    lineHeight: 21,
    textAlign: 'center',
    width: 24,
  },
});
