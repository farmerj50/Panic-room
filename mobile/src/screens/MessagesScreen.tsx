import { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';

import { useEmergencyContext } from '../context/EmergencyContext';

import journalCard from '../../assets/images/journal-card.png';
import resourcesCard from '../../assets/images/resources-card.png';
import teenGroup from '../../assets/images/teen-group.png';

const CONTACT_COLORS = ['#ff6b9a', '#b777ff', '#4aa8ff', '#f59e0b', '#4ee1d5'];

const QUICK_ACTIONS = [
  {
    title: 'Message Trusted Contacts',
    desc: 'Reach out to people you trust.',
    icon: 'M',
    color: '#b777ff',
    route: 'Contacts',
  },
  {
    title: 'Support Services',
    desc: 'Message counselors or support teams.',
    icon: 'H',
    color: '#4ee1d5',
    route: 'Resources',
  },
  {
    title: 'Group Chat',
    desc: 'Chat with multiple trusted contacts.',
    icon: 'G',
    color: '#ff5ea8',
    route: 'Contacts',
  },
  {
    title: 'Alerts & Updates',
    desc: 'Important safety alerts and updates.',
    icon: 'A',
    color: '#f7b731',
    route: 'Resources',
  },
] as const;

const QUICK_HELP = [
  {
    name: 'Call 911',
    desc: 'Emergency services',
    accent: '#ef445b',
    icon: '!',
    type: 'call' as const,
    value: '911',
  },
  {
    name: 'National Domestic Violence Hotline',
    desc: '1-800-799-7233',
    accent: '#b777ff',
    icon: 'D',
    type: 'call' as const,
    value: '18007997233',
  },
  {
    name: 'Crisis Text Line',
    desc: 'Text HOME to 741741',
    accent: '#f59e0b',
    icon: 'T',
    type: 'text' as const,
    value: '741741',
    body: 'HOME',
  },
];

const SUPPORT_CONVERSATIONS = [
  {
    id: 'support',
    name: 'SafeLine Support',
    preview: 'A counselor can respond when you are ready.',
    time: '24/7',
    icon: 'H',
    color: '#4ee1d5',
    route: 'Resources',
  },
  {
    id: 'alerts',
    name: 'Emergency Alerts',
    preview: 'Safety reminders and emergency updates.',
    time: 'Today',
    icon: 'S',
    color: '#b777ff',
    route: 'SafetyPlan',
  },
];

export default function MessagesScreen() {
  const navigation = useNavigation<any>();
  const { contacts } = useEmergencyContext();
  const { width } = useWindowDimensions();
  const [sending, setSending] = useState<string | null>(null);

  const isWide = width >= 900;
  const pageMaxWidth = isWide ? 1000 : 620;

  const orderedContacts = useMemo(
    () => [...contacts].sort((a, b) => Number(b.isPriority) - Number(a.isPriority)),
    [contacts],
  );

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('Home');
  };

  const sendAlert = async (phoneNumber: string, contactId: string) => {
    setSending(contactId);
    const body = encodeURIComponent(
      'Checking in from PanicRoom. Are you safe? Reply if you need support.',
    );
    const url = `sms:${phoneNumber}?body=${body}`;

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) Alert.alert('SMS unavailable', 'This device cannot open SMS links.');
      else await Linking.openURL(url);
    } finally {
      setSending(null);
    }
  };

  const openQuickHelp = async (item: (typeof QUICK_HELP)[number]) => {
    const body = item.body ? encodeURIComponent(item.body) : '';
    const url =
      item.type === 'call'
        ? `tel:${item.value}`
        : `sms:${item.value}${body ? `?body=${body}` : ''}`;

    await Linking.openURL(url);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { maxWidth: pageMaxWidth }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.iconButton} activeOpacity={0.82}>
            <Text style={styles.iconButtonText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Messages</Text>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.navigate('SafetyPlan')}
            activeOpacity={0.82}
          >
            <Text style={styles.iconButtonText}>S</Text>
          </TouchableOpacity>
        </View>

        <ImageBackground
          source={journalCard}
          resizeMode="cover"
          imageStyle={styles.heroImage}
          style={[styles.hero, { minHeight: isWide ? 335 : 285 }]}
        >
          <LinearGradient
            colors={[
              'rgba(5, 7, 24, 0.99)',
              'rgba(14, 12, 42, 0.84)',
              'rgba(14, 12, 42, 0.18)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.heroCopy, !isWide && styles.heroCopyNarrow]}>
            <Text style={[styles.heroTitle, !isWide && styles.heroTitleNarrow]}>
              You're not alone.{'\n'}
              <Text style={styles.heroTitleAccent}>We're here to help.</Text>
            </Text>
            <Text style={styles.heroText}>
              Message trusted contacts or connect with support services. Your conversations are
              private and secure.
            </Text>
            <View style={styles.encryptedBadge}>
              <View style={styles.encryptedIcon}>
                <Text style={styles.encryptedIconText}>L</Text>
              </View>
              <View>
                <Text style={styles.encryptedLabel}>End-to-end encrypted</Text>
                <Text style={styles.encryptedSub}>Your privacy is our priority.</Text>
              </View>
            </View>
          </View>
        </ImageBackground>

        <View style={[styles.quickGrid, !isWide && styles.quickGridNarrow]}>
          {QUICK_ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.title}
              activeOpacity={0.84}
              style={[styles.quickCard, !isWide && styles.quickCardNarrow]}
              onPress={() => navigation.navigate(action.route)}
            >
              <View style={[styles.quickIconCircle, { backgroundColor: `${action.color}24` }]}>
                <Text style={[styles.quickIconText, { color: action.color }]}>{action.icon}</Text>
              </View>
              <View style={styles.quickCopy}>
                <Text style={styles.quickLabel}>{action.title}</Text>
                <Text style={styles.quickDesc}>{action.desc}</Text>
              </View>
              <Text style={styles.quickArrow}>{'>'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.mainGrid, !isWide && styles.mainGridNarrow]}>
          <LinearGradient
            colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']}
            style={[styles.section, styles.conversationSection]}
          >
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Conversations</Text>
              <View style={styles.sectionActions}>
                <TouchableOpacity
                  style={styles.newMsgBtn}
                  onPress={() => navigation.navigate('Contacts')}
                  activeOpacity={0.82}
                >
                  <Text style={styles.newMsgText}>New Message</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.filterPill} activeOpacity={0.82}>
                  <Text style={styles.filterText}>All</Text>
                  <Text style={styles.filterArrow}>v</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.itemList}>
              {orderedContacts.length === 0 ? (
                <TouchableOpacity
                  activeOpacity={0.84}
                  style={[styles.convRow, styles.convRowBorder]}
                  onPress={() => navigation.navigate('Contacts')}
                >
                  <View style={[styles.convAvatar, { backgroundColor: '#b777ff26' }]}>
                    <Text style={[styles.convAvatarText, { color: '#b777ff' }]}>+</Text>
                  </View>
                  <View style={styles.convInfo}>
                    <View style={styles.convTopRow}>
                      <Text style={styles.convName}>Add Trusted Contacts</Text>
                      <Text style={styles.convTime}>Setup</Text>
                    </View>
                    <Text style={styles.convPreview}>
                      Add people you trust so check-ins and emergency alerts can work.
                    </Text>
                  </View>
                  <Text style={styles.rowArrow}>{'>'}</Text>
                </TouchableOpacity>
              ) : (
                orderedContacts.map((contact, idx) => {
                  const color = CONTACT_COLORS[idx % CONTACT_COLORS.length];
                  return (
                    <TouchableOpacity
                      key={contact.id}
                      activeOpacity={0.84}
                      style={[styles.convRow, styles.convRowBorder]}
                      onPress={() => sendAlert(contact.phoneNumber, contact.id)}
                    >
                      <View style={styles.avatarImageWrap}>
                        <Image source={teenGroup} resizeMode="cover" style={styles.avatarImage} />
                        <LinearGradient
                          colors={[`${color}11`, `${color}88`]}
                          style={StyleSheet.absoluteFill}
                        />
                        <Text style={styles.avatarInitial}>{contact.name.charAt(0).toUpperCase()}</Text>
                      </View>
                      {contact.isPriority && <View style={styles.onlineDot} />}
                      <View style={styles.convInfo}>
                        <View style={styles.convTopRow}>
                          <Text style={styles.convName}>
                            {contact.name}
                            {contact.isPriority ? '  <3' : ''}
                          </Text>
                          <Text style={styles.convTime}>Now</Text>
                        </View>
                        <Text style={styles.convPreview}>
                          {sending === contact.id
                            ? 'Opening message...'
                            : 'Tap to send a private check-in message.'}
                        </Text>
                      </View>
                      <View style={styles.unreadBadge}>
                        <Text style={styles.unreadText}>1</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}

              {SUPPORT_CONVERSATIONS.map((conversation, idx) => (
                <TouchableOpacity
                  key={conversation.id}
                  activeOpacity={0.84}
                  style={[styles.convRow, idx === 0 && styles.convRowBorder]}
                  onPress={() => navigation.navigate(conversation.route)}
                >
                  <View
                    style={[
                      styles.convAvatar,
                      { backgroundColor: `${conversation.color}24`, borderColor: `${conversation.color}55` },
                    ]}
                  >
                    <Text style={[styles.convAvatarText, { color: conversation.color }]}>
                      {conversation.icon}
                    </Text>
                  </View>
                  <View style={styles.convInfo}>
                    <View style={styles.convTopRow}>
                      <Text style={styles.convName}>{conversation.name}</Text>
                      <Text style={styles.convTime}>{conversation.time}</Text>
                    </View>
                    <Text style={styles.convPreview}>{conversation.preview}</Text>
                  </View>
                  <Text style={styles.rowArrow}>{'>'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              activeOpacity={0.82}
              style={styles.archiveLink}
              onPress={() => navigation.navigate('Contacts')}
            >
              <Text style={styles.archiveText}>View archived</Text>
              <Text style={styles.archiveIcon}>B</Text>
              <Text style={styles.archiveArrow}>{'>'}</Text>
            </TouchableOpacity>
          </LinearGradient>

          <View style={styles.sideRail}>
            <LinearGradient
              colors={['rgba(15, 18, 52, 0.98)', 'rgba(19, 17, 55, 0.96)']}
              style={styles.sideCard}
            >
              <View style={styles.sideHeader}>
                <View style={[styles.sideIcon, { backgroundColor: 'rgba(183,119,255,0.22)' }]}>
                  <Text style={[styles.sideIconText, { color: '#b777ff' }]}>S</Text>
                </View>
                <Text style={styles.sideTitle}>Safety Tip</Text>
              </View>
              <ImageBackground
                source={resourcesCard}
                resizeMode="cover"
                imageStyle={styles.tipImage}
                style={styles.tipImageWrap}
              >
                <LinearGradient
                  colors={['rgba(14,15,48,0.18)', 'rgba(14,15,48,0.9)']}
                  style={StyleSheet.absoluteFill}
                />
              </ImageBackground>
              <Text style={styles.tipText}>
                You can use code words with trusted contacts to ask for help without alerting others.
              </Text>
              <TouchableOpacity
                style={styles.learnMoreBtn}
                onPress={() => navigation.navigate('SafetyPlan')}
                activeOpacity={0.82}
              >
                <Text style={styles.learnMoreText}>Learn more</Text>
                <Text style={styles.learnMoreText}>{'>'}</Text>
              </TouchableOpacity>
            </LinearGradient>

            <LinearGradient
              colors={['rgba(13, 18, 49, 0.98)', 'rgba(10, 12, 38, 0.98)']}
              style={styles.sideCard}
            >
              <Text style={styles.sideTitle}>Quick Help</Text>
              <View style={styles.helpList}>
                {QUICK_HELP.map((item, idx) => (
                  <TouchableOpacity
                    key={item.name}
                    activeOpacity={0.84}
                    style={[styles.helpRow, idx < QUICK_HELP.length - 1 && styles.helpRowBorder]}
                    onPress={() => openQuickHelp(item)}
                  >
                    <View style={[styles.helpIcon, { backgroundColor: `${item.accent}24` }]}>
                      <Text style={[styles.helpIconText, { color: item.accent }]}>{item.icon}</Text>
                    </View>
                    <View style={styles.helpCopy}>
                      <Text style={styles.helpName}>{item.name}</Text>
                      <Text style={styles.helpDesc}>{item.desc}</Text>
                    </View>
                    <Text style={styles.rowArrow}>{'>'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.allResourcesBtn}
                onPress={() => navigation.navigate('Resources')}
                activeOpacity={0.82}
              >
                <Text style={styles.allResourcesText}>View all resources</Text>
                <Text style={styles.allResourcesText}>{'>'}</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </View>

        <LinearGradient
          colors={['rgba(15, 18, 52, 0.98)', 'rgba(36, 20, 79, 0.9)']}
          style={styles.footerCard}
        >
          <ImageBackground
            source={resourcesCard}
            resizeMode="cover"
            imageStyle={styles.footerImage}
            style={styles.footerArt}
          >
            <LinearGradient
              colors={['rgba(36,20,79,0.12)', 'rgba(36,20,79,0.86)']}
              style={StyleSheet.absoluteFill}
            />
          </ImageBackground>
          <View style={styles.footerCopy}>
            <Text style={styles.footerTitle}>You matter.</Text>
            <Text style={styles.footerText}>Reaching out is brave. Support is always available.</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.86}
            style={styles.footerBtn}
            onPress={() => navigation.navigate('Resources')}
          >
            <Text style={styles.footerBtnIcon}>R</Text>
            <Text style={styles.footerBtnText}>Go to Resources</Text>
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
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(199,140,255,0.24)',
    borderRadius: 18,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  iconButtonText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  title: { color: '#fff', fontSize: 23, fontWeight: '900' },
  hero: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  heroImage: { borderRadius: 22 },
  heroCopy: { maxWidth: 430, paddingHorizontal: 28, zIndex: 2 },
  heroCopyNarrow: { maxWidth: 360, paddingHorizontal: 22 },
  heroTitle: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 47,
    marginBottom: 14,
  },
  heroTitleNarrow: { fontSize: 31, lineHeight: 38 },
  heroTitleAccent: { color: '#9f58ff' },
  heroText: {
    color: '#e8e1f5',
    fontSize: 17,
    lineHeight: 26,
    marginBottom: 24,
  },
  encryptedBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(149,110,255,0.24)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 62,
    paddingHorizontal: 16,
  },
  encryptedIcon: {
    alignItems: 'center',
    borderColor: '#b777ff',
    borderRadius: 6,
    borderWidth: 2,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  encryptedIconText: { color: '#b777ff', fontSize: 15, fontWeight: '900' },
  encryptedLabel: { color: '#d9bcff', fontSize: 14, fontWeight: '900' },
  encryptedSub: { color: '#d5cde6', fontSize: 13, marginTop: 3 },
  quickGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 22,
  },
  quickGridNarrow: {
    flexDirection: 'column',
  },
  quickCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 18, 49, 0.94)',
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 145,
    padding: 18,
  },
  quickCardNarrow: { minHeight: 108, width: '100%' },
  quickIconCircle: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  quickIconText: { fontSize: 22, fontWeight: '900' },
  quickCopy: { flex: 1 },
  quickLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
    marginBottom: 8,
  },
  quickDesc: { color: '#cfc8dd', fontSize: 13, lineHeight: 19 },
  quickArrow: { color: '#a99cc5', fontSize: 24, fontWeight: '300' },
  mainGrid: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  mainGridNarrow: {
    flexDirection: 'column',
  },
  section: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 20,
  },
  conversationSection: { flex: 1.9, width: '100%' },
  sideRail: { flex: 1, gap: 14, width: '100%' },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  sectionActions: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  newMsgBtn: {
    backgroundColor: '#4d2aa4',
    borderRadius: 22,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  newMsgText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  filterPill: {
    alignItems: 'center',
    borderColor: 'rgba(149,110,255,0.26)',
    borderRadius: 21,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 16,
  },
  filterText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  filterArrow: { color: '#c7b6ff', fontSize: 12, fontWeight: '900' },
  itemList: {
    backgroundColor: 'rgba(6, 9, 28, 0.44)',
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  convRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 90,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'relative',
  },
  convRowBorder: { borderBottomColor: 'rgba(255,255,255,0.07)', borderBottomWidth: 1 },
  convAvatar: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 1.5,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  convAvatarText: { fontSize: 22, fontWeight: '900' },
  avatarImageWrap: {
    alignItems: 'center',
    backgroundColor: '#0b102f',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 56,
  },
  avatarImage: {
    height: 76,
    opacity: 0.72,
    position: 'absolute',
    width: 108,
  },
  avatarInitial: { color: '#fff', fontSize: 19, fontWeight: '900', zIndex: 2 },
  onlineDot: {
    backgroundColor: '#10B981',
    borderColor: '#050715',
    borderRadius: 6,
    borderWidth: 2,
    height: 12,
    left: 55,
    position: 'absolute',
    top: 25,
    width: 12,
    zIndex: 3,
  },
  convInfo: { flex: 1, minWidth: 0 },
  convTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  convName: { color: '#fff', flex: 1, fontSize: 18, fontWeight: '900' },
  convTime: { color: '#aaa3bd', fontSize: 13 },
  convPreview: { color: '#cfc8dd', fontSize: 14, lineHeight: 20 },
  rowArrow: { color: '#9b90b6', fontSize: 23, fontWeight: '300' },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#5d35b4',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  unreadText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  archiveLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  archiveText: { color: '#c084fc', fontSize: 15, fontWeight: '800' },
  archiveIcon: { color: '#c084fc', fontSize: 14, fontWeight: '900' },
  archiveArrow: { color: '#c084fc', fontSize: 22, marginLeft: 'auto' },
  sideCard: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 20,
  },
  sideHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 16 },
  sideIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sideIconText: { fontSize: 18, fontWeight: '900' },
  sideTitle: { color: '#fff', fontSize: 19, fontWeight: '900' },
  tipImageWrap: {
    alignSelf: 'center',
    borderRadius: 14,
    height: 130,
    marginBottom: 14,
    overflow: 'hidden',
    width: '100%',
  },
  tipImage: { borderRadius: 14 },
  tipText: {
    color: '#d8d1e8',
    fontSize: 15,
    lineHeight: 23,
    marginBottom: 16,
    textAlign: 'center',
  },
  learnMoreBtn: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  learnMoreText: { color: '#c084fc', fontSize: 16, fontWeight: '900' },
  helpList: { marginTop: 12 },
  helpRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    paddingVertical: 10,
  },
  helpRowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  helpIcon: {
    alignItems: 'center',
    borderRadius: 21,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  helpIconText: { fontSize: 18, fontWeight: '900' },
  helpCopy: { flex: 1, minWidth: 0 },
  helpName: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 4 },
  helpDesc: { color: '#bfb8ce', fontSize: 13, lineHeight: 18 },
  allResourcesBtn: {
    alignItems: 'center',
    borderColor: 'rgba(149,110,255,0.28)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  allResourcesText: { color: '#c084fc', fontSize: 15, fontWeight: '900' },
  footerCard: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    minHeight: 124,
    overflow: 'hidden',
    padding: 22,
  },
  footerArt: {
    borderRadius: 14,
    height: 82,
    overflow: 'hidden',
    width: 145,
  },
  footerImage: { borderRadius: 14 },
  footerCopy: { flex: 1, minWidth: 190 },
  footerTitle: { color: '#fff', fontSize: 24, fontWeight: '900', marginBottom: 6 },
  footerText: { color: '#d8d1e8', fontSize: 16, lineHeight: 23 },
  footerBtn: {
    alignItems: 'center',
    backgroundColor: '#7d3df1',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 22,
  },
  footerBtnIcon: { color: '#fff', fontSize: 17, fontWeight: '900' },
  footerBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
