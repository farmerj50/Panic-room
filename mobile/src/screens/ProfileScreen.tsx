import {
  Alert,
  Image,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { useEmergencyContext } from '../context/EmergencyContext';

import heroBg from '../../assets/images/hero-bg.png';
import journalCard from '../../assets/images/journal-card.png';
import resourcesCard from '../../assets/images/resources-card.png';
import teenGroup from '../../assets/images/teen-group.png';

const SAFETY_CARDS = [
  {
    icon: 'P',
    label: 'PIN & Passcode',
    desc: 'Change your PIN or unlock settings.',
    color: '#b777ff',
    route: 'Setup',
  },
  {
    icon: 'M',
    label: 'Privacy Mode',
    desc: 'Hide the app and protect your data.',
    color: '#ff5f82',
    route: 'Setup',
  },
  {
    icon: 'E',
    label: 'Emergency Settings',
    desc: 'Countdown, number, alerts, and triggers.',
    color: '#4ee1d5',
    route: 'Setup',
  },
] as const;

const INFO_ROWS = [
  {
    icon: 'D',
    label: 'My Details',
    desc: 'Update your name, email, and personal info.',
    color: '#ff6b9a',
    route: 'Setup',
  },
  {
    icon: 'N',
    label: 'My Notes',
    desc: 'Personal notes and important reminders.',
    color: '#b777ff',
    route: 'Journal',
  },
  {
    icon: 'G',
    label: 'Goals & Reminders',
    desc: 'Set goals and get reminders to stay safe and strong.',
    color: '#f59e0b',
    route: 'SafetyPlan',
  },
  {
    icon: 'B',
    label: 'Backup & Restore',
    desc: 'Back up your data or restore from a previous backup.',
    color: '#4ee1d5',
    route: 'Setup',
  },
] as const;

const SUPPORT_CARDS = [
  {
    icon: '?',
    label: 'Help Center',
    desc: 'Get help and find answers.',
    color: '#4aa8ff',
    route: 'Resources',
  },
  {
    icon: 'F',
    label: 'Feedback',
    desc: 'Share your thoughts to help us improve.',
    color: '#b777ff',
    route: 'Messages',
  },
  {
    icon: 'i',
    label: 'About PanicRoom',
    desc: 'Learn more about the app.',
    color: '#4ee1d5',
    route: 'Home',
  },
  {
    icon: '*',
    label: 'Rate the App',
    desc: 'If PanicRoom helps, please rate us.',
    color: '#f59e0b',
    route: 'Profile',
  },
] as const;

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { logout, user } = useAuth();
  const { contacts, isSetupDone, loadContacts } = useEmergencyContext();
  const { width } = useWindowDimensions();

  const isWide = width >= 900;
  const pageMaxWidth = isWide ? 1000 : 620;
  const safetyPct = Math.min(100, (isSetupDone ? 40 : 10) + Math.min(contacts.length * 20, 60));

  const clearLocalData = () => {
    Alert.alert('Clear local data?', 'This removes contacts, setup status, and notes from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await Promise.all(
            [
              'contacts',
              'setupDone',
              'journalNotes',
              'safetyPlan',
              'panicroom_emergency_settings',
              'panicroom_last_location',
              'panicroom_lock_screen_enabled',
            ].map((key) => AsyncStorage.removeItem(key)),
          );
          await loadContacts();
          Alert.alert('Cleared', 'Local PanicRoom data has been removed from this device.');
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { maxWidth: pageMaxWidth }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.title}>Profile</Text>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.navigate('Setup')}
            activeOpacity={0.82}
          >
            <Text style={styles.iconButtonText}>S</Text>
          </TouchableOpacity>
        </View>

        <ImageBackground
          source={heroBg}
          resizeMode="cover"
          imageStyle={styles.heroImage}
          style={[styles.heroCard, { minHeight: isWide ? 245 : 260 }]}
        >
          <LinearGradient
            colors={[
              'rgba(5, 7, 24, 0.98)',
              'rgba(12, 14, 42, 0.88)',
              'rgba(18, 14, 46, 0.35)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />

          <Image source={teenGroup} resizeMode="cover" style={styles.heroPeople} />

          <View style={[styles.heroTop, !isWide && styles.heroTopNarrow]}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarCircle}>
                <Image source={journalCard} resizeMode="cover" style={styles.avatarImage} />
                <LinearGradient
                  colors={['rgba(9,10,32,0.05)', 'rgba(80,35,150,0.42)']}
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <TouchableOpacity activeOpacity={0.82} style={styles.cameraBadge}>
                <Text style={styles.cameraBadgeText}>C</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.heroCopy}>
              <Text style={styles.heroGreeting}>
                Hi, {user?.name || 'there'} <Text style={styles.heartText}>{'<3'}</Text>
              </Text>
              <Text style={styles.heroSub}>You are not alone.{'\n'}We are here for you.</Text>
            </View>
          </View>

          <View style={[styles.statsRow, !isWide && styles.statsRowNarrow]}>
            <TouchableOpacity activeOpacity={0.82} style={styles.statBadge}>
              <View style={styles.statIconCircle}>
                <Text style={styles.statIcon}>S</Text>
              </View>
              <View>
                <Text style={styles.statLabel}>Member since</Text>
                <Text style={styles.statValue}>May 2025</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity activeOpacity={0.82} style={styles.statBadge}>
              <View style={styles.statIconCircle}>
                <Text style={styles.statIcon}>L</Text>
              </View>
              <View>
                <Text style={styles.statLabel}>Account</Text>
                <Text style={styles.statValue}>Private</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.statBadge}
              onPress={() => navigation.navigate('SafetyPlan')}
            >
              <View style={styles.statIconCircle}>
                <Text style={styles.statIcon}>V</Text>
              </View>
              <View>
                <Text style={styles.statLabel}>Safety Plan</Text>
                <Text style={[styles.statValue, { color: safetyPct >= 80 ? '#4ee1d5' : '#d9bcff' }]}>
                  {safetyPct}% Complete
                </Text>
              </View>
              <Text style={styles.statsArrow}>{'>'}</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>

        <Text style={styles.sectionLabel}>Safety & Security</Text>
        <View style={[styles.safetyGrid, !isWide && styles.safetyGridNarrow]}>
          {SAFETY_CARDS.map((card) => (
            <TouchableOpacity
              key={card.label}
              activeOpacity={0.84}
              style={[styles.safetyCard, !isWide && styles.fullWidth]}
              onPress={() => navigation.navigate(card.route)}
            >
              <View style={[styles.largeIcon, { backgroundColor: `${card.color}24` }]}>
                <Text style={[styles.largeIconText, { color: card.color }]}>{card.icon}</Text>
              </View>
              <View style={styles.cardCopy}>
                <Text style={styles.cardTitle}>{card.label}</Text>
                <Text style={styles.cardDesc}>{card.desc}</Text>
              </View>
              <Text style={styles.cardArrow}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>People & Connections</Text>
        <LinearGradient
          colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
          style={styles.section}
        >
          <TouchableOpacity
            activeOpacity={0.84}
            style={[styles.resourceRow, styles.resourceRowBorder]}
            onPress={() => navigation.navigate('Contacts')}
          >
            <View style={[styles.itemIcon, { backgroundColor: 'rgba(183,119,255,0.24)' }]}>
              <Text style={[styles.itemIconText, { color: '#b777ff' }]}>C</Text>
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>Trusted Contacts</Text>
              <Text style={styles.itemDesc}>Manage your circle of trusted people.</Text>
            </View>
            <View style={[styles.valueBadge, { backgroundColor: '#8b4dff22', borderColor: '#8b4dff55' }]}>
              <Text style={[styles.valueText, { color: '#d9bcff' }]}>
                {contacts.length} Contact{contacts.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Text style={styles.rowArrow}>{'>'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.84}
            style={styles.resourceRow}
            onPress={() => navigation.navigate('Setup')}
          >
            <View style={[styles.itemIcon, { backgroundColor: 'rgba(74,168,255,0.24)' }]}>
              <Text style={[styles.itemIconText, { color: '#4aa8ff' }]}>T</Text>
            </View>
            <View style={styles.itemCopy}>
              <Text style={styles.itemName}>Emergency Number</Text>
              <Text style={styles.itemDesc}>Set the number to call in an emergency.</Text>
            </View>
            <View style={[styles.valueBadge, { backgroundColor: '#4aa8ff22', borderColor: '#4aa8ff55' }]}>
              <Text style={[styles.valueText, { color: '#7fb7ff' }]}>911</Text>
            </View>
            <Text style={styles.rowArrow}>{'>'}</Text>
          </TouchableOpacity>
        </LinearGradient>

        <View style={[styles.infoGrid, !isWide && styles.infoGridNarrow]}>
          <View style={styles.infoColumn}>
            <Text style={styles.sectionLabel}>My Information</Text>
            <LinearGradient
              colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
              style={styles.section}
            >
              {INFO_ROWS.map((row, idx) => (
                <TouchableOpacity
                  key={row.label}
                  activeOpacity={0.84}
                  style={[styles.resourceRow, idx < INFO_ROWS.length - 1 && styles.resourceRowBorder]}
                  onPress={() => navigation.navigate(row.route)}
                >
                  <View style={[styles.itemIcon, { backgroundColor: `${row.color}24` }]}>
                    <Text style={[styles.itemIconText, { color: row.color }]}>{row.icon}</Text>
                  </View>
                  <View style={styles.itemCopy}>
                    <Text style={styles.itemName}>{row.label}</Text>
                    <Text style={styles.itemDesc}>{row.desc}</Text>
                  </View>
                  <Text style={styles.rowArrow}>{'>'}</Text>
                </TouchableOpacity>
              ))}
            </LinearGradient>
          </View>

          <ImageBackground
            source={resourcesCard}
            resizeMode="cover"
            imageStyle={styles.lovedImage}
            style={styles.lovedCard}
          >
            <LinearGradient
              colors={['rgba(13, 18, 49, 0.98)', 'rgba(18, 15, 51, 0.88)']}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.lovedCopy}>
              <Text style={styles.lovedTitle}>You are loved.</Text>
              <Text style={styles.lovedText}>Your story matters.{'\n'}Your safety matters.{'\n'}You matter.</Text>
            </View>
            <View style={styles.lovedHeart}>
              <Text style={styles.lovedHeartText}>{'<3'}</Text>
            </View>
          </ImageBackground>
        </View>

        <Text style={styles.sectionLabel}>App & Support</Text>
        <View style={[styles.supportGrid, !isWide && styles.supportGridNarrow]}>
          {SUPPORT_CARDS.map((card) => (
            <TouchableOpacity
              key={card.label}
              activeOpacity={0.84}
              style={[styles.supportCard, !isWide && styles.supportCardNarrow]}
              onPress={() => navigation.navigate(card.route)}
            >
              <View style={[styles.supportIcon, { backgroundColor: `${card.color}24` }]}>
                <Text style={[styles.supportIconText, { color: card.color }]}>{card.icon}</Text>
              </View>
              <View style={styles.cardCopy}>
                <Text style={styles.supportLabel}>{card.label}</Text>
                <Text style={styles.supportDesc}>{card.desc}</Text>
              </View>
              <Text style={styles.cardArrow}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Danger Zone</Text>
        <LinearGradient
          colors={['rgba(78, 12, 25, 0.58)', 'rgba(13, 18, 49, 0.97)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.section, styles.dangerSection]}
        >
          <TouchableOpacity activeOpacity={0.84} style={[styles.resourceRow, styles.resourceRowBorder]} onPress={clearLocalData}>
            <View style={[styles.itemIcon, { backgroundColor: 'rgba(239,68,91,0.22)' }]}>
              <Text style={[styles.itemIconText, { color: '#ff6f7f' }]}>X</Text>
            </View>
            <View style={styles.itemCopy}>
              <Text style={[styles.itemName, { color: '#fff' }]}>Clear Local Data</Text>
              <Text style={styles.itemDesc}>
                Remove all contacts, notes, and settings from this device.
              </Text>
            </View>
            <TouchableOpacity style={styles.clearBtn} onPress={clearLocalData} activeOpacity={0.82}>
              <Text style={styles.clearBtnText}>Clear Data</Text>
            </TouchableOpacity>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.84} style={styles.resourceRow} onPress={logout}>
            <View style={[styles.itemIcon, { backgroundColor: 'rgba(183,119,255,0.22)' }]}>
              <Text style={[styles.itemIconText, { color: '#d9bcff' }]}>L</Text>
            </View>
            <View style={styles.itemCopy}>
              <Text style={[styles.itemName, { color: '#fff' }]}>Sign Out</Text>
              <Text style={styles.itemDesc}>End this session on the current device.</Text>
            </View>
            <TouchableOpacity style={styles.clearBtn} onPress={logout} activeOpacity={0.82}>
              <Text style={styles.clearBtnText}>Sign Out</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </LinearGradient>

        <LinearGradient
          colors={['rgba(56, 22, 117, 0.86)', 'rgba(14, 18, 52, 0.98)']}
          style={styles.footerCard}
        >
          <View style={styles.footerShield}>
            <Text style={styles.footerShieldText}>S</Text>
          </View>
          <View style={styles.footerCopy}>
            <Text style={styles.footerTitle}>Remember:</Text>
            <Text style={styles.footerText}>
              You are not responsible for anyone else's actions. Leaving is not giving up, it is
              choosing your life.
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.footerBtn}
            onPress={() => navigation.navigate('SafetyPlan')}
          >
            <Text style={styles.footerBtnText}>{'<3'} You are strong</Text>
          </TouchableOpacity>
        </LinearGradient>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  scroll: {
    alignSelf: 'center',
    paddingBottom: 116,
    paddingHorizontal: 18,
    paddingTop: 12,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
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
  title: { color: '#fff', fontSize: 23, fontWeight: '900' },
  heroCard: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'space-between',
    marginBottom: 24,
    overflow: 'hidden',
    padding: 28,
  },
  heroImage: { borderRadius: 22 },
  heroPeople: {
    bottom: -35,
    height: 230,
    opacity: 0.28,
    position: 'absolute',
    right: -20,
    width: 430,
  },
  heroTop: { alignItems: 'center', flexDirection: 'row', gap: 28, zIndex: 2 },
  heroTopNarrow: { alignItems: 'flex-start', flexDirection: 'column', gap: 18 },
  avatarWrap: { position: 'relative' },
  avatarCircle: {
    backgroundColor: '#17133a',
    borderColor: '#b777ff',
    borderRadius: 78,
    borderWidth: 2,
    height: 156,
    overflow: 'hidden',
    width: 156,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  cameraBadge: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderColor: '#d8bcff',
    borderRadius: 21,
    borderWidth: 2,
    bottom: 10,
    height: 42,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 42,
  },
  cameraBadgeText: { color: '#fff', fontSize: 17, fontWeight: '900' },
  heroCopy: { flex: 1 },
  heroGreeting: { color: '#fff', fontSize: 30, fontWeight: '900', marginBottom: 12 },
  heartText: { color: '#c084fc', fontSize: 24 },
  heroSub: { color: '#eee8ff', fontSize: 18, lineHeight: 28 },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    marginLeft: 184,
    marginTop: 18,
    zIndex: 2,
  },
  statsRowNarrow: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 8,
    marginLeft: 0,
  },
  statBadge: { alignItems: 'center', flexDirection: 'row', gap: 10, minWidth: 128 },
  statIconCircle: {
    alignItems: 'center',
    borderColor: 'rgba(199,140,255,0.42)',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  statIcon: { color: '#c084fc', fontSize: 16, fontWeight: '900' },
  statLabel: { color: '#b9b0cd', fontSize: 13, lineHeight: 18 },
  statValue: { color: '#fff', fontSize: 14, fontWeight: '800' },
  statDivider: { backgroundColor: 'rgba(149,110,255,0.22)', height: 38, width: 1 },
  statsArrow: { color: '#c084fc', fontSize: 22, marginLeft: 8 },
  sectionLabel: {
    color: '#b8afca',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 12,
    marginLeft: 12,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  safetyGrid: { flexDirection: 'row', gap: 14, marginBottom: 24 },
  safetyGridNarrow: { flexDirection: 'column' },
  fullWidth: { width: '100%' },
  safetyCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 18, 49, 0.94)',
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 16,
    minHeight: 116,
    padding: 18,
  },
  largeIcon: {
    alignItems: 'center',
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  largeIconText: { fontSize: 26, fontWeight: '900' },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#fff', fontSize: 17, fontWeight: '900', marginBottom: 6 },
  cardDesc: { color: '#d3ccdf', fontSize: 14, lineHeight: 20 },
  cardArrow: { color: '#b8aacd', fontSize: 24, fontWeight: '300' },
  section: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 24,
    overflow: 'hidden',
  },
  resourceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    minHeight: 86,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  resourceRowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  itemIcon: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  itemIconText: { fontSize: 23, fontWeight: '900' },
  itemCopy: { flex: 1, minWidth: 0 },
  itemName: { color: '#fff', fontSize: 17, fontWeight: '900', marginBottom: 5 },
  itemDesc: { color: '#cfc8dd', fontSize: 14, lineHeight: 20 },
  valueBadge: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  valueText: { fontSize: 14, fontWeight: '900' },
  rowArrow: { color: '#b8aacd', fontSize: 24, fontWeight: '300' },
  infoGrid: { alignItems: 'stretch', flexDirection: 'row', gap: 20 },
  infoGridNarrow: { flexDirection: 'column', gap: 0 },
  infoColumn: { flex: 2 },
  lovedCard: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'space-between',
    marginBottom: 24,
    minHeight: 330,
    overflow: 'hidden',
    padding: 30,
  },
  lovedImage: { borderRadius: 18 },
  lovedCopy: { zIndex: 2 },
  lovedTitle: { color: '#c084fc', fontSize: 28, fontWeight: '900', marginBottom: 14 },
  lovedText: { color: '#f0ebff', fontSize: 17, lineHeight: 28 },
  lovedHeart: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(183,119,255,0.22)',
    borderRadius: 52,
    height: 104,
    justifyContent: 'center',
    width: 104,
    zIndex: 2,
  },
  lovedHeartText: { color: '#d8bcff', fontSize: 28, fontWeight: '900' },
  supportGrid: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  supportGridNarrow: { flexDirection: 'column' },
  supportCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 18, 49, 0.94)',
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 104,
    padding: 16,
  },
  supportCardNarrow: { width: '100%' },
  supportIcon: {
    alignItems: 'center',
    borderRadius: 25,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  supportIconText: { fontSize: 21, fontWeight: '900' },
  supportLabel: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 5 },
  supportDesc: { color: '#cfc8dd', fontSize: 13, lineHeight: 18 },
  dangerSection: { borderColor: 'rgba(239,68,91,0.42)' },
  clearBtn: {
    alignItems: 'center',
    borderColor: '#ef445b',
    borderRadius: 14,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  clearBtnText: { color: '#ff7080', fontSize: 14, fontWeight: '900' },
  footerCard: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 20,
    minHeight: 112,
    overflow: 'hidden',
    padding: 22,
  },
  footerShield: {
    alignItems: 'center',
    backgroundColor: 'rgba(183,119,255,0.24)',
    borderRadius: 34,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  footerShieldText: { color: '#d8bcff', fontSize: 27, fontWeight: '900' },
  footerCopy: { flex: 1, minWidth: 220 },
  footerTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 6 },
  footerText: { color: '#e3ddeb', fontSize: 14, lineHeight: 21 },
  footerBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(139,77,255,0.68)',
    borderColor: 'rgba(199,140,255,0.42)',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  footerBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
