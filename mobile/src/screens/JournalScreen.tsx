import { useEffect, useState } from 'react';
import {
  Alert,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { getPrivateData, savePrivateData } from '../services/privateDataService';
import heroBg from '../../assets/images/hero-bg.png';
import journalCard from '../../assets/images/journal-card.png';
import safetyPlanCard from '../../assets/images/safety-plan-card.png';

const JOURNAL_KEY = 'journalNotes';

type Mood = 'Awful' | 'Struggling' | 'Okay' | 'Good' | 'Great';

type JournalNotes = {
  privateNotes: string;
  moodCheckIn: string;
  incidentNotes: string;
  evidenceNotes: string;
  mood: Mood | null;
};

const emptyNotes: JournalNotes = {
  privateNotes: '',
  moodCheckIn: '',
  incidentNotes: '',
  evidenceNotes: '',
  mood: null,
};

const QUICK_CARDS = [
  {
    title: 'New Note',
    desc: 'Write anything on your mind.',
    icon: 'N',
    color: '#9b5cff',
    key: 'privateNotes' as const,
  },
  {
    title: 'Mood Check-In',
    desc: "Track how you're feeling today.",
    icon: 'M',
    color: '#ff4fa3',
    key: 'moodCheckIn' as const,
  },
  {
    title: 'Incident Note',
    desc: 'Record details of an incident.',
    icon: '!',
    color: '#fb7a33',
    key: 'incidentNotes' as const,
  },
  {
    title: 'Saved Evidence',
    desc: 'View saved evidence notes.',
    icon: 'E',
    color: '#21d4d0',
    key: 'evidenceNotes' as const,
  },
];

const MOODS: Array<{ label: Mood; icon: string; color: string }> = [
  { label: 'Awful', icon: ':(', color: '#a86cff' },
  { label: 'Struggling', icon: ':|', color: '#ff9f43' },
  { label: 'Okay', icon: ':)', color: '#ffd166' },
  { label: 'Good', icon: ':D', color: '#4ee1d5' },
  { label: 'Great', icon: '^^', color: '#b777ff' },
];

const EVIDENCE_TYPES = [
  { label: 'Photos', count: '2 items', icon: 'P', color: '#4ee1d5' },
  { label: 'Audio', count: '1 item', icon: 'A', color: '#ff4fa3' },
  { label: 'Screenshots', count: '3 items', icon: 'S', color: '#b777ff' },
  { label: 'Documents', count: '1 item', icon: 'D', color: '#d8ccff' },
];

export default function JournalScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const [notes, setNotes] = useState<JournalNotes>(emptyNotes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPrivateData<JournalNotes>(JOURNAL_KEY)
      .then(async (stored) => {
        if (stored) {
          setNotes({ ...emptyNotes, ...stored });
          await AsyncStorage.removeItem(JOURNAL_KEY);
          return;
        }

        const local = await AsyncStorage.getItem(JOURNAL_KEY);
        if (local) {
          const parsed = { ...emptyNotes, ...JSON.parse(local) };
          setNotes(parsed);
          await savePrivateData(JOURNAL_KEY, parsed);
          await AsyncStorage.removeItem(JOURNAL_KEY);
        }
      })
      .catch(() => {});
  }, []);

  const updateNote = (key: keyof JournalNotes, value: string | Mood | null) => {
    setNotes((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await savePrivateData(JOURNAL_KEY, notes);
      await AsyncStorage.removeItem(JOURNAL_KEY);
      Alert.alert('Saved', 'Your journal notes were saved to your encrypted account storage.');
    } finally {
      setSaving(false);
    }
  };

  const focusCard = (key: keyof JournalNotes) => {
    if (key === 'moodCheckIn') return;
    if (key === 'evidenceNotes') navigation.navigate('Evidence');
  };

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('Home');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.page, { maxWidth: isWide ? 980 : 620 }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={goBack} style={styles.backButton} activeOpacity={0.82}>
              <Text style={styles.iconButtonText}>{'<'}</Text>
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Journal</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>♡</Text>
            </TouchableOpacity>
          </View>

          <ImageBackground source={journalCard} resizeMode="cover" imageStyle={styles.heroImage} style={styles.hero}>
            <LinearGradient
              colors={['rgba(8, 8, 30, 0.98)', 'rgba(24, 10, 52, 0.75)', 'rgba(24, 10, 52, 0.18)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>
                Your space.{'\n'}
                <Text style={styles.heroAccent}>Your voice.</Text>
              </Text>
              <Text style={styles.heroText}>
                A private space for notes, mood check-ins, incidents, and evidence details.
              </Text>
              <View style={styles.privacyPill}>
                <Text style={styles.privacyIcon}>L</Text>
                <Text style={styles.privacyText}>Only you can see this.</Text>
              </View>
            </View>
          </ImageBackground>

          <View style={[styles.quickGrid, !isWide && styles.quickGridStacked]}>
            {QUICK_CARDS.map((card) => (
              <TouchableOpacity
                key={card.title}
                activeOpacity={0.84}
                style={[styles.quickCard, !isWide && styles.fullWidth]}
                onPress={() => focusCard(card.key)}
              >
                <View style={[styles.quickIcon, { backgroundColor: `${card.color}26` }]}>
                  <Text style={[styles.quickIconText, { color: card.color }]}>{card.icon}</Text>
                </View>
                <View style={styles.quickCopy}>
                  <Text style={styles.quickTitle}>{card.title}</Text>
                  <Text style={styles.quickDesc}>{card.desc}</Text>
                </View>
                <Text style={styles.quickArrow}>{'>'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <LinearGradient colors={['rgba(12, 18, 49, 0.96)', 'rgba(14, 15, 48, 0.96)']} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: 'rgba(155,92,255,0.22)' }]}>
                <Text style={[styles.sectionIconText, { color: '#b777ff' }]}>N</Text>
              </View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Private Notes</Text>
                <Text style={styles.sectionSubtitle}>Write what you need to remember.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.82} style={styles.sectionLink} onPress={save}>
                <Text style={styles.sectionLinkText}>{saving ? 'Saving' : 'Save'}</Text>
                <Text style={styles.sectionLinkText}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.sectionBody, isWide && styles.sectionBodyWide]}>
              <TextInput
                multiline
                placeholder="Talked to someone safe today..."
                placeholderTextColor="#8c84a8"
                style={[styles.noteInput, isWide && styles.noteInputWide]}
                textAlignVertical="top"
                value={notes.privateNotes}
                onChangeText={(value) => updateNote('privateNotes', value)}
              />
              {isWide && (
                <ImageBackground source={safetyPlanCard} resizeMode="cover" imageStyle={styles.sideImage} style={styles.sideArt}>
                  <LinearGradient
                    colors={['rgba(14,15,48,0.2)', 'rgba(14,15,48,0.78)']}
                    style={StyleSheet.absoluteFill}
                  />
                </ImageBackground>
              )}
            </View>
          </LinearGradient>

          <LinearGradient colors={['rgba(14, 18, 52, 0.96)', 'rgba(18, 16, 52, 0.96)']} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: 'rgba(255,79,163,0.22)' }]}>
                <Text style={[styles.sectionIconText, { color: '#ff4fa3' }]}>M</Text>
              </View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Mood Check-In</Text>
                <Text style={styles.sectionSubtitle}>How are you feeling today?</Text>
              </View>
              <TouchableOpacity activeOpacity={0.82} style={styles.sectionLink} onPress={save}>
                <Text style={[styles.sectionLinkText, { color: '#ff6fba' }]}>Save</Text>
                <Text style={[styles.sectionLinkText, { color: '#ff6fba' }]}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.moodRow}>
              {MOODS.map((mood) => {
                const active = notes.mood === mood.label;
                return (
                  <TouchableOpacity
                    key={mood.label}
                    activeOpacity={0.82}
                    onPress={() => updateNote('mood', mood.label)}
                    style={[styles.moodButton, active && { borderColor: mood.color, backgroundColor: `${mood.color}1f` }]}
                  >
                    <View style={[styles.moodIcon, { backgroundColor: `${mood.color}2b` }]}>
                      <Text style={[styles.moodIconText, { color: mood.color }]}>{mood.icon}</Text>
                    </View>
                    <Text style={styles.moodLabel}>{mood.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              multiline
              placeholder="Add anything about your mood..."
              placeholderTextColor="#8c84a8"
              style={[styles.noteInput, styles.moodNoteInput]}
              textAlignVertical="top"
              value={notes.moodCheckIn}
              onChangeText={(value) => updateNote('moodCheckIn', value)}
            />
          </LinearGradient>

          <LinearGradient colors={['rgba(20, 17, 50, 0.98)', 'rgba(12, 18, 48, 0.96)']} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: 'rgba(251,122,51,0.24)' }]}>
                <Text style={[styles.sectionIconText, { color: '#fb8b42' }]}>!</Text>
              </View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Incident Notes</Text>
                <Text style={styles.sectionSubtitle}>Date, time, place, and details.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.82} style={styles.sectionLink} onPress={save}>
                <Text style={[styles.sectionLinkText, { color: '#fb8b42' }]}>Save</Text>
                <Text style={[styles.sectionLinkText, { color: '#fb8b42' }]}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              multiline
              placeholder="May 9, 2025 • 7:45 PM • At home..."
              placeholderTextColor="#8c84a8"
              style={styles.noteInput}
              textAlignVertical="top"
              value={notes.incidentNotes}
              onChangeText={(value) => updateNote('incidentNotes', value)}
            />
          </LinearGradient>

          <LinearGradient colors={['rgba(10, 27, 57, 0.98)', 'rgba(12, 18, 48, 0.96)']} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: 'rgba(33,212,208,0.2)' }]}>
                <Text style={[styles.sectionIconText, { color: '#21d4d0' }]}>E</Text>
              </View>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>Saved Evidence Notes</Text>
                <Text style={styles.sectionSubtitle}>Photos, recordings, messages, witnesses.</Text>
              </View>
              <TouchableOpacity activeOpacity={0.82} style={styles.sectionLink} onPress={() => navigation.navigate('Evidence')}>
                <Text style={[styles.sectionLinkText, { color: '#4ee1d5' }]}>Open</Text>
                <Text style={[styles.sectionLinkText, { color: '#4ee1d5' }]}>{'>'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.evidenceGrid}>
              {EVIDENCE_TYPES.map((item) => (
                <TouchableOpacity key={item.label} activeOpacity={0.82} style={styles.evidenceTile}>
                  <View style={[styles.evidenceIcon, { borderColor: `${item.color}66` }]}>
                    <Text style={[styles.evidenceIconText, { color: item.color }]}>{item.icon}</Text>
                  </View>
                  <View>
                    <Text style={styles.evidenceLabel}>{item.label}</Text>
                    <Text style={styles.evidenceCount}>{item.count}</Text>
                  </View>
                  <Text style={styles.evidenceArrow}>{'>'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              multiline
              placeholder="Notes about saved evidence..."
              placeholderTextColor="#8c84a8"
              style={[styles.noteInput, styles.evidenceNoteInput]}
              textAlignVertical="top"
              value={notes.evidenceNotes}
              onChangeText={(value) => updateNote('evidenceNotes', value)}
            />
          </LinearGradient>

          <ImageBackground source={heroBg} resizeMode="cover" imageStyle={styles.footerImage} style={styles.footerCard}>
            <LinearGradient
              colors={['rgba(40, 20, 91, 0.94)', 'rgba(8, 14, 38, 0.74)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.footerIcon}>
              <Text style={styles.footerIconText}>♥</Text>
            </View>
            <View style={styles.footerCopy}>
              <Text style={styles.footerTitle}>You are not alone.</Text>
              <Text style={styles.footerText}>
                Your feelings are valid. Your story matters. Keep going. We are here for you.
              </Text>
            </View>
          </ImageBackground>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  scroll: {
    alignItems: 'center',
    paddingBottom: 116,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  page: { width: '100%' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(199,140,255,0.24)',
    borderWidth: 1,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(199,140,255,0.3)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  iconButtonText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  backButtonText: { color: '#f2e8ff', fontSize: 13, fontWeight: '900' },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  hero: {
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 22,
    borderWidth: 1,
    height: 285,
    justifyContent: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  heroImage: { borderRadius: 22 },
  heroCopy: { maxWidth: 410, paddingHorizontal: 28, zIndex: 2 },
  heroTitle: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 44,
    marginBottom: 10,
  },
  heroAccent: { color: '#b777ff' },
  heroText: { color: '#f2ecff', fontSize: 16, lineHeight: 24, marginBottom: 20 },
  privacyPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(142, 62, 180, 0.24)',
    borderColor: 'rgba(255, 111, 218, 0.52)',
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 38,
    paddingHorizontal: 16,
  },
  privacyIcon: { color: '#ff6fda', fontSize: 13, fontWeight: '900' },
  privacyText: { color: '#ffb3ed', fontSize: 14, fontWeight: '800' },
  quickGrid: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  quickGridStacked: { flexDirection: 'column' },
  fullWidth: { width: '100%' },
  quickCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 20, 55, 0.94)',
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 104,
    padding: 16,
  },
  quickIcon: {
    alignItems: 'center',
    borderRadius: 25,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  quickIconText: { fontSize: 20, fontWeight: '900' },
  quickCopy: { flex: 1 },
  quickTitle: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 5 },
  quickDesc: { color: '#d4cde8', fontSize: 13, lineHeight: 18 },
  quickArrow: { color: '#c084fc', fontSize: 20, fontWeight: '900' },
  section: {
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
    padding: 20,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  sectionIcon: {
    alignItems: 'center',
    borderRadius: 24,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  sectionIconText: { fontSize: 20, fontWeight: '900' },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 4 },
  sectionSubtitle: { color: '#d4cde8', fontSize: 13, lineHeight: 19 },
  sectionLink: { alignItems: 'center', flexDirection: 'row', gap: 8, padding: 6 },
  sectionLinkText: { color: '#c084fc', fontSize: 13, fontWeight: '900' },
  sectionBody: { gap: 16 },
  sectionBodyWide: { flexDirection: 'row' },
  noteInput: {
    backgroundColor: 'rgba(6, 9, 28, 0.82)',
    borderColor: 'rgba(149, 110, 255, 0.18)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#f4f0ff',
    fontSize: 15,
    lineHeight: 22,
    minHeight: 120,
    outlineStyle: 'none' as never,
    padding: 14,
  },
  noteInputWide: { flex: 1 },
  sideArt: {
    borderRadius: 14,
    minHeight: 120,
    overflow: 'hidden',
    width: 250,
  },
  sideImage: { borderRadius: 14 },
  moodRow: {
    backgroundColor: 'rgba(6, 9, 28, 0.52)',
    borderColor: 'rgba(149, 110, 255, 0.14)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
    padding: 12,
  },
  moodButton: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 7,
    minWidth: 96,
    padding: 10,
  },
  moodIcon: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  moodIconText: { fontSize: 14, fontWeight: '900' },
  moodLabel: { color: '#fff', fontSize: 13, fontWeight: '800' },
  moodNoteInput: { minHeight: 78 },
  evidenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  evidenceTile: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(78,225,213,0.24)',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 62,
    minWidth: 164,
    paddingHorizontal: 12,
  },
  evidenceIcon: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  evidenceIconText: { fontSize: 15, fontWeight: '900' },
  evidenceLabel: { color: '#fff', fontSize: 13, fontWeight: '900' },
  evidenceCount: { color: '#b9b0cd', fontSize: 12, marginTop: 2 },
  evidenceArrow: { color: '#c084fc', fontSize: 16, fontWeight: '900', marginLeft: 'auto' },
  evidenceNoteInput: { minHeight: 82 },
  footerCard: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    minHeight: 124,
    overflow: 'hidden',
    padding: 22,
  },
  footerImage: { borderRadius: 18 },
  footerIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(183,119,255,0.24)',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  footerIconText: { color: '#d9bcff', fontSize: 24, fontWeight: '900' },
  footerCopy: { flex: 1 },
  footerTitle: { color: '#d9bcff', fontSize: 20, fontWeight: '900', marginBottom: 8 },
  footerText: { color: '#e5def4', fontSize: 14, lineHeight: 21 },
});
