import { useEffect } from 'react';
import {
  Image,
  ImageBackground,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { useEmergencyContext } from '../context/EmergencyContext';
import { TabParamList } from '../navigation/types';

import heroBg from '../../assets/images/hero-bg.png';
import teenGroup from '../../assets/images/teen-group.png';
import emergencyCard from '../../assets/images/emergency-card.png';
import safetyPlanCard from '../../assets/images/safety-plan-card.png';
import resourcesCard from '../../assets/images/resources-card.png';
import journalCard from '../../assets/images/journal-card.png';

type Nav = BottomTabNavigationProp<TabParamList>;
type RouteName = keyof TabParamList;

const NAV_ITEMS: Array<{ label: string; route: RouteName }> = [
  { label: 'Home', route: 'Home' },
  { label: 'Resources', route: 'Resources' },
  { label: 'Safety Plan', route: 'SafetyPlan' },
  { label: 'Journal', route: 'Journal' },
  { label: 'Support', route: 'Messages' },
];

const FEATURE_CARDS = [
  {
    title: 'Emergency Help',
    description:
      'Get help fast. Share your location, alert trusted contacts, and access emergency tools.',
    image: emergencyCard,
    route: 'Emergency' as RouteName,
    icon: '!',
    iconColor: '#ff6b7d',
    overlay: ['rgba(70, 14, 34, 0.95)', 'rgba(43, 12, 51, 0.58)', 'rgba(9, 11, 28, 0.12)'] as [
      string,
      string,
      string,
    ],
  },
  {
    title: 'Safety Plan',
    description:
      'Create a safety plan, save safe places, and prepare for any situation.',
    image: safetyPlanCard,
    route: 'SafetyPlan' as RouteName,
    icon: 'V',
    iconColor: '#39d4d0',
    overlay: ['rgba(7, 55, 62, 0.95)', 'rgba(10, 46, 65, 0.62)', 'rgba(9, 11, 28, 0.08)'] as [
      string,
      string,
      string,
    ],
  },
  {
    title: 'Resources',
    description:
      'Find shelters, hotlines, youth services, and trafficking support organizations.',
    image: resourcesCard,
    route: 'Resources' as RouteName,
    icon: 'R',
    iconColor: '#a56dff',
    overlay: ['rgba(25, 22, 80, 0.95)', 'rgba(33, 18, 75, 0.56)', 'rgba(9, 11, 28, 0.08)'] as [
      string,
      string,
      string,
    ],
  },
  {
    title: 'Journal',
    description:
      'A private space to write, reflect, and take care of your mental health.',
    image: journalCard,
    route: 'Journal' as RouteName,
    icon: 'J',
    iconColor: '#b778ff',
    overlay: ['rgba(53, 20, 84, 0.95)', 'rgba(48, 23, 82, 0.52)', 'rgba(9, 11, 28, 0.08)'] as [
      string,
      string,
      string,
    ],
  },
];

const AUDIENCE_CHIPS = [
  'Teens',
  'Young Adults',
  'Adults',
  'Seniors',
  'LGBTQ+',
  'All Ethnicities',
];

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { loadContacts } = useEmergencyContext();
  const { width, height } = useWindowDimensions();

  const isWide = width >= 900;
  const isDesktop = width >= 1180;
  const heroHeight = isWide ? Math.min(Math.max(height * 0.47, 450), 560) : 680;

  useEffect(() => {
    loadContacts();
  }, []);

  const goTo = (route: RouteName) => {
    navigation.navigate(route);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#050715" />

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWide ? 30 : 42 }]}
      >
        <ImageBackground
          source={heroBg}
          resizeMode="cover"
          style={[styles.hero, { minHeight: heroHeight }]}
          imageStyle={styles.heroImage}
        >
          <LinearGradient
            colors={[
              'rgba(3, 6, 20, 0.68)',
              'rgba(10, 5, 36, 0.18)',
              'rgba(4, 7, 21, 0.92)',
            ]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />

          <Image
            source={teenGroup}
            resizeMode="contain"
            style={[
              styles.heroPeople,
              isWide ? styles.heroPeopleWide : styles.heroPeopleNarrow,
            ]}
          />

          <SafeAreaView edges={['top']} style={styles.safeHero}>
            <View style={[styles.header, !isWide && styles.headerCompact]}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => goTo('Home')}
                style={styles.brand}
              >
                <View style={styles.logoMark}>
                  <View style={styles.logoHeart} />
                </View>
                <Text style={styles.brandText}>PanicRoom</Text>
              </TouchableOpacity>

              {isWide && (
                <View style={styles.topNav}>
                  {NAV_ITEMS.map((item) => (
                    <TouchableOpacity
                      key={item.label}
                      activeOpacity={0.78}
                      onPress={() => goTo(item.route)}
                      style={styles.topNavItem}
                    >
                      <Text
                        style={[
                          styles.topNavText,
                          item.route === 'Home' && styles.topNavTextActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                      {item.route === 'Home' && <View style={styles.activeLine} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.headerActions}>
                {isDesktop && (
                  <TouchableOpacity
                    activeOpacity={0.84}
                    onPress={() => goTo('Profile')}
                    style={styles.matterPill}
                  >
                    <Text style={styles.matterText}>You matter</Text>
                    <View style={styles.smallHeart} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => goTo('Emergency')}
                  style={styles.shieldButton}
                >
                  <View style={styles.smallShield} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={[styles.heroBody, !isWide && styles.heroBodyCompact]}>
              <View style={[styles.heroCopy, !isWide && styles.heroCopyCompact]}>
                <Text style={[styles.heroTitle, !isWide && styles.heroTitleCompact]}>
                  You are{'\n'}not alone.
                </Text>
                <Text style={styles.heroSubtitle}>
                  Private support, emergency help, and trusted connections when you need them
                  most.
                </Text>
                <TouchableOpacity
                  activeOpacity={0.84}
                  onPress={() => goTo('Emergency')}
                  style={styles.helpButton}
                >
                  <Text style={styles.helpText}>I Need Help Now</Text>
                  <View style={styles.helpShield}>
                    <View style={styles.helpShieldInner} />
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.78}
                  onPress={() => goTo('Profile')}
                  style={styles.learnButton}
                >
                  <Text style={styles.learnText}>Learn More</Text>
                  <Text style={styles.learnArrow}>-&gt;</Text>
                </TouchableOpacity>
              </View>

              {isWide && (
                <>
                  <Text style={styles.heroNote}>It's okay to ask for help</Text>
                  <View style={styles.quotePill}>
                    <Text style={styles.quoteText}>
                      "You are brave. You are strong. You matter."
                    </Text>
                    <View style={styles.quoteHeart} />
                  </View>
                </>
              )}
            </View>
          </SafeAreaView>
        </ImageBackground>

        <View style={[styles.pageContent, { maxWidth: isDesktop ? 1520 : 980 }]}>
          <View style={[styles.featureGrid, !isWide && styles.stackedGrid]}>
            {FEATURE_CARDS.map((card) => (
              <TouchableOpacity
                key={card.title}
                activeOpacity={0.88}
                onPress={() => goTo(card.route)}
                style={[styles.featureShell, isWide ? styles.featureShellWide : styles.fullWidth]}
              >
                <ImageBackground
                  source={card.image}
                  resizeMode="cover"
                  style={styles.featureCard}
                  imageStyle={styles.cardImage}
                >
                  <LinearGradient
                    colors={card.overlay}
                    locations={[0, 0.56, 1]}
                    start={{ x: 0, y: 0.2 }}
                    end={{ x: 1, y: 0.8 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={styles.featureContent}>
                    <View
                      style={[
                        styles.featureIcon,
                        {
                          borderColor: `${card.iconColor}88`,
                          backgroundColor: `${card.iconColor}26`,
                        },
                      ]}
                    >
                      <Text style={[styles.featureIconText, { color: card.iconColor }]}>
                        {card.icon}
                      </Text>
                    </View>
                    <Text style={styles.featureTitle}>{card.title}</Text>
                    <Text style={styles.featureDescription}>{card.description}</Text>
                    <View style={styles.openPill}>
                      <Text style={styles.openText}>Open</Text>
                      <Text style={styles.openArrow}>-&gt;</Text>
                    </View>
                  </View>
                </ImageBackground>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.panelGrid, !isWide && styles.stackedGrid]}>
            <LinearGradient
              colors={['rgba(12, 15, 43, 0.96)', 'rgba(18, 13, 57, 0.94)']}
              style={[styles.panel, styles.everyonePanel, isWide ? styles.everyoneWide : styles.fullWidth]}
            >
              <View style={styles.panelCopy}>
                <Text style={styles.panelTitle}>We are here for everyone.</Text>
                <Text style={styles.panelSubtitle}>
                  No matter who you are, where you're from, or what you're going through.
                </Text>
              </View>
              <Image source={teenGroup} resizeMode="cover" style={styles.everyoneImage} />
              <View style={styles.chipRow}>
                {AUDIENCE_CHIPS.map((chip) => (
                  <View key={chip} style={styles.audienceChip}>
                    <View style={styles.chipDot} />
                    <Text style={styles.chipText}>{chip}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>

            <LinearGradient
              colors={['rgba(9, 13, 39, 0.98)', 'rgba(17, 20, 55, 0.94)']}
              style={[styles.panel, styles.privacyPanel, isWide ? styles.sidePanel : styles.fullWidth]}
            >
              <Text style={styles.panelTitle}>Discreet. Private. Always.</Text>
              {[
                'No one will know unless you tell them.',
                'Hide the app. Lock the app.',
                'Your safety is our priority.',
              ].map((line) => (
                <View key={line} style={styles.checkRow}>
                  <View style={styles.lineIcon}>
                    <View style={styles.lineIconDot} />
                  </View>
                  <Text style={styles.checkText}>{line}</Text>
                </View>
              ))}
              <View style={styles.moonGlow} />
            </LinearGradient>

            <LinearGradient
              colors={['rgba(20, 18, 58, 0.98)', 'rgba(28, 15, 63, 0.94)']}
              style={[styles.panel, styles.hiddenPanel, isWide ? styles.sidePanel : styles.fullWidth]}
            >
              <View style={styles.hiddenCopy}>
                <Text style={styles.panelTitle}>Hidden Emergency Access</Text>
                <Text style={styles.panelSubtitle}>
                  Keep yourself safe. Use a discreet way to open emergency tools.
                </Text>
                {['Tap the shield icon', 'Long press the logo', 'Tap the logo 3 times'].map(
                  (line) => (
                    <View key={line} style={styles.hiddenRow}>
                      <View style={styles.hiddenShield} />
                      <Text style={styles.hiddenText}>{line}</Text>
                    </View>
                  ),
                )}
              </View>
              <View style={styles.phoneMock}>
                <View style={styles.phoneNotch} />
                <View style={styles.phoneLogo}>
                  <View style={styles.phoneLogoHeart} />
                </View>
                <Text style={styles.phoneText}>PanicRoom</Text>
                <View style={styles.finger} />
              </View>
            </LinearGradient>
          </View>
        </View>
      </ScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050715',
  },
  scrollContent: {
    backgroundColor: '#050715',
  },
  hero: {
    width: '100%',
    overflow: 'hidden',
  },
  heroImage: {
    opacity: 0.94,
  },
  safeHero: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 12,
    zIndex: 3,
  },
  headerCompact: {
    paddingHorizontal: 18,
  },
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  logoMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(128, 70, 255, 0.18)',
    borderColor: 'rgba(178, 116, 255, 0.78)',
    borderRadius: 18,
    borderWidth: 2,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  logoHeart: {
    backgroundColor: '#ead5ff',
    borderRadius: 9,
    height: 18,
    transform: [{ rotate: '45deg' }],
    width: 18,
  },
  brandText: {
    color: '#f6efff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
  },
  topNav: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 34,
  },
  topNavItem: {
    alignItems: 'center',
    minHeight: 34,
  },
  topNavText: {
    color: '#d8cdef',
    fontSize: 16,
    fontWeight: '500',
  },
  topNavTextActive: {
    color: '#f2dcff',
  },
  activeLine: {
    backgroundColor: '#bd7cff',
    borderRadius: 2,
    height: 3,
    marginTop: 7,
    width: 46,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  matterPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(94, 40, 138, 0.52)',
    borderColor: 'rgba(183, 119, 255, 0.78)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  matterText: {
    color: '#e7c9ff',
    fontSize: 14,
    fontWeight: '700',
  },
  smallHeart: {
    backgroundColor: '#cf99ff',
    borderRadius: 6,
    height: 12,
    transform: [{ rotate: '45deg' }],
    width: 12,
  },
  shieldButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.11)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 26,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  smallShield: {
    borderBottomColor: '#eef1ff',
    borderBottomWidth: 14,
    borderLeftColor: 'transparent',
    borderLeftWidth: 10,
    borderRightColor: 'transparent',
    borderRightWidth: 10,
    height: 0,
    width: 22,
  },
  heroPeople: {
    opacity: 0.96,
    position: 'absolute',
    zIndex: 1,
  },
  heroPeopleWide: {
    bottom: -38,
    height: '86%',
    right: 22,
    width: '76%',
  },
  heroPeopleNarrow: {
    bottom: 10,
    height: 350,
    right: -160,
    width: 620,
  },
  heroBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 72,
    paddingTop: 10,
    zIndex: 2,
  },
  heroBodyCompact: {
    justifyContent: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 54,
  },
  heroCopy: {
    maxWidth: 430,
  },
  heroCopyCompact: {
    maxWidth: 360,
  },
  heroTitle: {
    color: '#d9c3ff',
    fontSize: 64,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 68,
    marginBottom: 14,
    textShadowColor: 'rgba(160, 96, 255, 0.52)',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 18,
  },
  heroTitleCompact: {
    fontSize: 48,
    lineHeight: 52,
  },
  heroSubtitle: {
    color: '#efe8ff',
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 20,
    maxWidth: 330,
  },
  helpButton: {
    alignItems: 'center',
    backgroundColor: '#9a4fff',
    borderRadius: 26,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
    maxWidth: 286,
    minHeight: 54,
    paddingHorizontal: 24,
    shadowColor: '#9a4fff',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.34,
    shadowRadius: 20,
  },
  helpText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  helpShield: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 12,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  helpShieldInner: {
    borderBottomColor: '#ffffff',
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderRightColor: 'transparent',
    borderRightWidth: 7,
    height: 0,
    width: 15,
  },
  learnButton: {
    alignItems: 'center',
    borderColor: 'rgba(208, 155, 255, 0.72)',
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 28,
    justifyContent: 'center',
    marginTop: 14,
    maxWidth: 230,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  learnText: {
    color: '#e6d7ff',
    fontSize: 15,
    fontWeight: '700',
  },
  learnArrow: {
    color: '#f0ddff',
    fontSize: 16,
    fontWeight: '700',
  },
  heroNote: {
    color: '#e6c9ff',
    fontSize: 20,
    fontStyle: 'italic',
    fontWeight: '500',
    left: '29%',
    lineHeight: 26,
    position: 'absolute',
    top: '25%',
    width: 180,
  },
  quotePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(11, 13, 38, 0.54)',
    borderColor: 'rgba(174, 102, 255, 0.56)',
    borderRadius: 17,
    borderWidth: 1,
    bottom: 26,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    left: '45%',
    minHeight: 52,
    paddingHorizontal: 28,
    position: 'absolute',
    width: '34%',
  },
  quoteText: {
    color: '#f5dcff',
    fontSize: 18,
    fontStyle: 'italic',
    fontWeight: '600',
  },
  quoteHeart: {
    backgroundColor: '#c78cff',
    borderRadius: 5,
    height: 10,
    transform: [{ rotate: '45deg' }],
    width: 10,
  },
  pageContent: {
    alignSelf: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    width: '100%',
  },
  featureGrid: {
    flexDirection: 'row',
    gap: 14,
  },
  stackedGrid: {
    flexDirection: 'column',
  },
  featureShell: {
    minWidth: 0,
  },
  featureShellWide: {
    flex: 1,
  },
  fullWidth: {
    width: '100%',
  },
  featureCard: {
    borderColor: 'rgba(171, 122, 255, 0.32)',
    borderRadius: 12,
    borderWidth: 1,
    height: 238,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  cardImage: {
    borderRadius: 12,
  },
  featureContent: {
    height: '100%',
    justifyContent: 'center',
    maxWidth: 250,
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  featureIcon: {
    alignItems: 'center',
    borderRadius: 25,
    borderWidth: 1,
    height: 50,
    justifyContent: 'center',
    marginBottom: 16,
    width: 50,
  },
  featureIconText: {
    fontSize: 22,
    fontWeight: '900',
  },
  featureTitle: {
    color: '#f8f4ff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 12,
  },
  featureDescription: {
    color: '#ece8f8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  openPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  openText: {
    color: '#f5efff',
    fontSize: 14,
    fontWeight: '700',
  },
  openArrow: {
    color: '#f5efff',
    fontSize: 14,
    fontWeight: '700',
  },
  panelGrid: {
    flexDirection: 'row',
    gap: 14,
  },
  panel: {
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 240,
    overflow: 'hidden',
    padding: 22,
  },
  everyonePanel: {
    justifyContent: 'space-between',
  },
  everyoneWide: {
    flex: 2,
  },
  sidePanel: {
    flex: 1,
  },
  panelCopy: {
    zIndex: 2,
  },
  panelTitle: {
    color: '#faf7ff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 8,
  },
  panelSubtitle: {
    color: '#d4cce5',
    fontSize: 13,
    lineHeight: 19,
  },
  everyoneImage: {
    alignSelf: 'center',
    height: 108,
    marginTop: 8,
    opacity: 0.95,
    width: '100%',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  audienceChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(92, 61, 168, 0.42)',
    borderColor: 'rgba(164, 120, 255, 0.22)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 30,
    paddingHorizontal: 12,
  },
  chipDot: {
    backgroundColor: '#b777ff',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  chipText: {
    color: '#f2eaff',
    fontSize: 12,
    fontWeight: '700',
  },
  privacyPanel: {
    justifyContent: 'center',
  },
  checkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  lineIcon: {
    alignItems: 'center',
    borderColor: 'rgba(222, 211, 255, 0.45)',
    borderRadius: 11,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  lineIconDot: {
    backgroundColor: '#c8b6ff',
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  checkText: {
    color: '#e1dce9',
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  moonGlow: {
    backgroundColor: 'rgba(124, 83, 212, 0.22)',
    borderRadius: 34,
    bottom: 20,
    height: 68,
    position: 'absolute',
    right: 24,
    width: 68,
  },
  hiddenPanel: {
    flexDirection: 'row',
    paddingRight: 12,
  },
  hiddenCopy: {
    flex: 1,
    zIndex: 2,
  },
  hiddenRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  hiddenShield: {
    borderBottomColor: '#d7c2ff',
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderLeftWidth: 6,
    borderRightColor: 'transparent',
    borderRightWidth: 6,
    height: 0,
    width: 14,
  },
  hiddenText: {
    color: '#eee8ff',
    flex: 1,
    fontSize: 13,
  },
  phoneMock: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#080b1f',
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 28,
    borderWidth: 2,
    height: 220,
    justifyContent: 'center',
    marginLeft: 8,
    overflow: 'hidden',
    width: 112,
  },
  phoneNotch: {
    backgroundColor: '#020412',
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    height: 16,
    position: 'absolute',
    top: 0,
    width: 48,
  },
  phoneLogo: {
    alignItems: 'center',
    backgroundColor: 'rgba(158, 84, 255, 0.22)',
    borderColor: 'rgba(199, 140, 255, 0.65)',
    borderRadius: 18,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    marginBottom: 12,
    width: 48,
  },
  phoneLogoHeart: {
    backgroundColor: '#e4ccff',
    borderRadius: 7,
    height: 14,
    transform: [{ rotate: '45deg' }],
    width: 14,
  },
  phoneText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  finger: {
    backgroundColor: '#d69a75',
    borderRadius: 16,
    bottom: -8,
    height: 64,
    position: 'absolute',
    right: 24,
    transform: [{ rotate: '-14deg' }],
    width: 24,
  },
  bottomNavWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(5, 8, 25, 0.92)',
    borderTopColor: 'rgba(122, 87, 214, 0.3)',
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
  },
  bottomNav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    width: '100%',
  },
  bottomItem: {
    alignItems: 'center',
    borderRadius: 22,
    flex: 1,
    gap: 5,
    justifyContent: 'center',
    minHeight: 52,
    minWidth: 0,
  },
  bottomItemActive: {
    backgroundColor: 'rgba(94, 39, 168, 0.58)',
  },
  bottomIconText: {
    color: '#d9d1ee',
    fontSize: 17,
    fontWeight: '800',
  },
  bottomIconTextActive: {
    color: '#cf99ff',
  },
  bottomLabel: {
    color: '#ded8ec',
    fontSize: 12,
    fontWeight: '600',
  },
  bottomLabelActive: {
    color: '#f3e6ff',
  },
  emergencyDock: {
    alignItems: 'center',
    flex: 1,
    gap: 5,
    justifyContent: 'center',
    minHeight: 78,
    minWidth: 0,
  },
  emergencyGlow: {
    alignItems: 'center',
    backgroundColor: '#f05464',
    borderColor: 'rgba(255, 184, 193, 0.74)',
    borderRadius: 33,
    borderWidth: 2,
    height: 66,
    justifyContent: 'center',
    marginTop: -34,
    shadowColor: '#f05464',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.42,
    shadowRadius: 18,
    width: 66,
  },
  emergencyIcon: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    lineHeight: 38,
  },
  emergencyLabel: {
    color: '#f7dfe5',
    fontSize: 12,
    fontWeight: '700',
  },
});
