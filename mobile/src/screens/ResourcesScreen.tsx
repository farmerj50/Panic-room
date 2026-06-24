import { useMemo, useState } from 'react';
import {
  ImageBackground,
  Linking,
  Modal,
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

import teenGroup from '../../assets/images/teen-group.png';

type ResourceAction = {
  label: 'Call' | 'Text' | 'Find' | 'Open';
  type: 'call' | 'text' | 'link';
  value: string;
  body?: string;
};

type ResourceItem = {
  name: string;
  desc: string;
  accent: string;
  actions: ResourceAction[];
};

type ResourceSection = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  filter: FilterId;
  items: ResourceItem[];
};

type TextCardState = {
  item: ResourceItem;
  action: ResourceAction;
} | null;

type FilterId = 'all' | 'hotlines' | 'shelter' | 'legal' | 'health' | 'youth' | 'lgbtq';

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'hotlines', label: 'Hotlines' },
  { id: 'shelter', label: 'Shelter' },
  { id: 'legal', label: 'Legal' },
  { id: 'health', label: 'Health' },
  { id: 'youth', label: 'Youth' },
  { id: 'lgbtq', label: 'LGBTQ+' },
];

const RESOURCES: ResourceSection[] = [
  {
    id: 'crisis',
    title: 'Crisis Hotlines',
    subtitle: '24/7 support. Confidential and free.',
    icon: 'C',
    color: '#ff5f8f',
    filter: 'hotlines',
    items: [
      {
        name: '988 Suicide & Crisis Lifeline',
        desc: '988 - 24/7 support for emotional distress',
        accent: '#6d7dff',
        actions: [
          { label: 'Call', type: 'call', value: '988' },
          { label: 'Text', type: 'text', value: '988' },
        ],
      },
      {
        name: 'Crisis Text Line',
        desc: 'Text HOME to 741741 for crisis support',
        accent: '#f59e0b',
        actions: [{ label: 'Text', type: 'text', value: '741741', body: 'HOME' }],
      },
      {
        name: 'Emergency Services',
        desc: '911 - police, fire, medical emergency',
        accent: '#ef445b',
        actions: [{ label: 'Call', type: 'call', value: '911' }],
      },
    ],
  },
  {
    id: 'trafficking',
    title: 'Trafficking Support',
    subtitle: 'Specialized support and safety planning.',
    icon: 'T',
    color: '#60a5fa',
    filter: 'hotlines',
    items: [
      {
        name: 'National Human Trafficking Hotline',
        desc: '1-888-373-7888 - 24/7 confidential',
        accent: '#60a5fa',
        actions: [
          { label: 'Call', type: 'call', value: '18883737888' },
          { label: 'Text', type: 'text', value: '233733', body: 'HELP' },
        ],
      },
      {
        name: 'BeFree Text Line',
        desc: 'Text HELP or INFO to 233733',
        accent: '#38bdf8',
        actions: [{ label: 'Text', type: 'text', value: '233733', body: 'HELP' }],
      },
    ],
  },
  {
    id: 'shelter',
    title: 'Shelters & Safe Places',
    subtitle: 'Find a safe place to stay.',
    icon: 'S',
    color: '#4ee1d5',
    filter: 'shelter',
    items: [
      {
        name: 'Find a Shelter Near You',
        desc: 'Search shelters by location',
        accent: '#4ee1d5',
        actions: [{ label: 'Find', type: 'link', value: 'https://www.domesticshelters.org/help' }],
      },
      {
        name: 'National DV Hotline',
        desc: '1-800-799-7233 - 24/7 support',
        accent: '#b777ff',
        actions: [
          { label: 'Call', type: 'call', value: '18007997233' },
          { label: 'Text', type: 'text', value: '88788', body: 'START' },
        ],
      },
    ],
  },
  {
    id: 'legal',
    title: 'Legal Aid',
    subtitle: 'Know your rights and options.',
    icon: 'L',
    color: '#c084fc',
    filter: 'legal',
    items: [
      {
        name: 'Legal Services Corporation',
        desc: 'Find free legal aid near you',
        accent: '#c084fc',
        actions: [{ label: 'Open', type: 'link', value: 'https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help' }],
      },
      {
        name: 'WomensLaw Legal Information',
        desc: 'Plain-language legal resources and state guides',
        accent: '#a78bfa',
        actions: [{ label: 'Open', type: 'link', value: 'https://www.womenslaw.org/' }],
      },
    ],
  },
  {
    id: 'health',
    title: 'Medical Help',
    subtitle: 'Health and emotional support resources.',
    icon: 'H',
    color: '#f472b6',
    filter: 'health',
    items: [
      {
        name: 'RAINN National Sexual Assault Hotline',
        desc: '1-800-656-4673 - confidential support',
        accent: '#f472b6',
        actions: [
          { label: 'Call', type: 'call', value: '18006564673' },
          { label: 'Open', type: 'link', value: 'https://www.rainn.org/resources' },
        ],
      },
      {
        name: 'SAMHSA National Helpline',
        desc: '1-800-662-4357 - treatment referrals',
        accent: '#34d399',
        actions: [{ label: 'Call', type: 'call', value: '18006624357' }],
      },
    ],
  },
  {
    id: 'youth',
    title: 'Youth Services',
    subtitle: 'Support for teens and young adults.',
    icon: 'Y',
    color: '#facc15',
    filter: 'youth',
    items: [
      {
        name: 'National Runaway Safeline',
        desc: '1-800-786-2929 - teens and young adults',
        accent: '#facc15',
        actions: [
          { label: 'Call', type: 'call', value: '18007862929' },
          { label: 'Text', type: 'text', value: '66008', body: '66008' },
        ],
      },
      {
        name: 'Boys Town Hotline',
        desc: '1-800-448-3000 - all youth',
        accent: '#f59e0b',
        actions: [{ label: 'Call', type: 'call', value: '18004483000' }],
      },
    ],
  },
  {
    id: 'lgbtq',
    title: 'LGBTQ+ Support',
    subtitle: 'You deserve support and acceptance.',
    icon: 'Q',
    color: '#b777ff',
    filter: 'lgbtq',
    items: [
      {
        name: 'The Trevor Project',
        desc: '1-866-488-7386 - LGBTQ+ youth crisis',
        accent: '#b777ff',
        actions: [
          { label: 'Call', type: 'call', value: '18664887386' },
          { label: 'Text', type: 'text', value: '678678', body: 'START' },
        ],
      },
      {
        name: 'Trans Lifeline',
        desc: '1-877-565-8860 - peer support',
        accent: '#9b5cff',
        actions: [{ label: 'Call', type: 'call', value: '18775658860' }],
      },
    ],
  },
];

export default function ResourcesScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  const [textCard, setTextCard] = useState<TextCardState>(null);
  const isWide = width >= 820;

  const filteredSections = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return RESOURCES.map((section) => {
      const sectionMatchesFilter = filter === 'all' || section.filter === filter;
      if (!sectionMatchesFilter) return null;

      const items = section.items.filter((item) => {
        if (!normalizedQuery) return true;
        return `${section.title} ${item.name} ${item.desc}`.toLowerCase().includes(normalizedQuery);
      });

      return items.length ? { ...section, items } : null;
    }).filter(Boolean) as ResourceSection[];
  }, [filter, query]);

  const getActionUrl = (action: ResourceAction) => {
    const encodedBody = action.body ? encodeURIComponent(action.body) : '';

    if (action.type === 'call') return `tel:${action.value}`;
    if (action.type === 'text') return `sms:${action.value}${encodedBody ? `?body=${encodedBody}` : ''}`;
    return action.value;
  };

  const openAction = async (action: ResourceAction, item: ResourceItem) => {
    if (action.type === 'text' && Platform.OS === 'web') {
      setTextCard({ item, action });
      return;
    }

    await Linking.openURL(getActionUrl(action));
  };

  const openTextApp = async () => {
    if (!textCard) return;
    await Linking.openURL(getActionUrl(textCard.action));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.page, { maxWidth: isWide ? 960 : 620 }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>{'<'}</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Resources</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>♡</Text>
            </TouchableOpacity>
          </View>

          <ImageBackground source={teenGroup} resizeMode="cover" imageStyle={styles.heroImage} style={styles.hero}>
            <LinearGradient
              colors={['rgba(12, 10, 42, 0.98)', 'rgba(14, 14, 45, 0.68)', 'rgba(14, 14, 45, 0.08)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>
                <Text style={styles.heroTitleAccent}>Help</Text> is here.
              </Text>
              <Text style={styles.heroText}>
                You are not alone. These resources are free, confidential, and here to support you.
              </Text>
            </View>
          </ImageBackground>

          <View style={styles.searchBox}>
            <Text style={styles.searchIcon}>Q</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search for help (shelter, legal, youth)"
              placeholderTextColor="#918aaa"
              style={styles.searchInput}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {FILTERS.map((item) => {
              const active = filter === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  activeOpacity={0.82}
                  onPress={() => setFilter(item.id)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {filteredSections.map((section) => (
            <View key={section.id} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionIcon, { backgroundColor: `${section.color}24` }]}>
                  <Text style={[styles.sectionIconText, { color: section.color }]}>
                    {section.icon}
                  </Text>
                </View>
                <View style={styles.sectionTitleBlock}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
                </View>
                {filter === 'all' && (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    style={styles.viewAllBtn}
                    onPress={() => setFilter(section.filter)}
                  >
                    <Text style={styles.viewAllText}>View all</Text>
                    <Text style={styles.viewAllArrow}>{'>'}</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.itemList}>
                {section.items.map((item) => (
                  <View
                    key={item.name}
                    style={[styles.resourceRow, !isWide && styles.resourceRowCompact]}
                  >
                    <View style={[styles.itemIcon, { backgroundColor: `${item.accent}26` }]}>
                      <Text style={[styles.itemIconText, { color: item.accent }]}>
                        {section.icon}
                      </Text>
                    </View>

                    <View style={styles.itemCopy}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemDesc}>{item.desc}</Text>
                    </View>

                    <View style={[styles.actionRow, !isWide && styles.actionRowCompact]}>
                      {item.actions.map((action) => (
                        <TouchableOpacity
                          key={`${item.name}-${action.label}-${action.value}`}
                          activeOpacity={0.82}
                          onPress={() => openAction(action, item)}
                          style={[styles.actionButton, { borderColor: `${item.accent}66` }]}
                        >
                          <Text style={[styles.actionText, { color: item.accent }]}>
                            {action.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ))}

          <LinearGradient
            colors={['rgba(91, 42, 173, 0.42)', 'rgba(239, 68, 91, 0.22)']}
            style={[styles.emergencyCard, !isWide && styles.emergencyCardCompact]}
          >
            <View style={styles.emergencyIconBox}>
              <Text style={styles.emergencyIcon}>!</Text>
            </View>
            <View style={styles.emergencyCopy}>
              <Text style={styles.emergencyTitle}>Need help now?</Text>
              <Text style={styles.emergencyText}>
                If you are in immediate danger, use the emergency button.
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.emergencyButton}
              onPress={() => navigation.navigate('Emergency')}
            >
              <Text style={styles.emergencyButtonText}>Go to Emergency</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      </ScrollView>

      <Modal
        animationType="fade"
        transparent
        visible={textCard !== null}
        onRequestClose={() => setTextCard(null)}
      >
        <View style={styles.textModalBackdrop}>
          {textCard && (
            <View style={styles.textModalCard}>
              <View style={styles.textModalHeader}>
                <View style={[styles.textModalIcon, { backgroundColor: `${textCard.item.accent}24` }]}>
                  <Text style={[styles.textModalIconText, { color: textCard.item.accent }]}>T</Text>
                </View>
                <View style={styles.textModalTitleBlock}>
                  <Text style={styles.textModalLabel}>Text Resource</Text>
                  <Text style={styles.textModalTitle}>{textCard.item.name}</Text>
                </View>
              </View>

              <Text style={styles.textModalDesc}>{textCard.item.desc}</Text>

              <View style={styles.textDetailGroup}>
                <View style={styles.textDetailRow}>
                  <Text style={styles.textDetailLabel}>To</Text>
                  <Text selectable style={styles.textDetailValue}>{textCard.action.value}</Text>
                </View>

                {textCard.action.body ? (
                  <View style={styles.textDetailRow}>
                    <Text style={styles.textDetailLabel}>Message</Text>
                    <Text selectable style={styles.textDetailValue}>{textCard.action.body}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.textModalActions}>
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={styles.textModalSecondary}
                  onPress={() => setTextCard(null)}
                >
                  <Text style={styles.textModalSecondaryText}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={[styles.textModalPrimary, { backgroundColor: textCard.item.accent }]}
                  onPress={openTextApp}
                >
                  <Text style={styles.textModalPrimaryText}>Open text app</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  scroll: {
    alignItems: 'center',
    paddingBottom: 118,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  page: {
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  iconButtonText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 0 },
  hero: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 22,
    borderWidth: 1,
    height: 190,
    justifyContent: 'center',
    marginBottom: 18,
    overflow: 'hidden',
  },
  heroImage: {
    borderRadius: 22,
  },
  heroCopy: {
    maxWidth: 360,
    paddingHorizontal: 28,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: '900',
    lineHeight: 42,
    marginBottom: 10,
  },
  heroTitleAccent: {
    color: '#b777ff',
  },
  heroText: {
    color: '#f0ecfb',
    fontSize: 16,
    lineHeight: 24,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(20, 20, 49, 0.92)',
    borderColor: 'rgba(151, 131, 205, 0.32)',
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  searchIcon: { color: '#bfb6d6', fontSize: 16, fontWeight: '900' },
  searchInput: {
    color: '#fff',
    flex: 1,
    fontSize: 15,
    minHeight: 48,
    outlineStyle: 'none' as never,
  },
  filters: {
    gap: 10,
    paddingBottom: 14,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 15, 43, 0.8)',
    borderColor: 'rgba(151, 131, 205, 0.28)',
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 18,
  },
  filterChipActive: {
    backgroundColor: '#8b4dff',
    borderColor: '#ad86ff',
  },
  filterText: { color: '#f0eaff', fontSize: 13, fontWeight: '800' },
  filterTextActive: { color: '#fff' },
  section: {
    backgroundColor: 'rgba(10, 17, 49, 0.88)',
    borderColor: 'rgba(90, 78, 148, 0.32)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
    padding: 16,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  sectionIcon: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  sectionIconText: { fontSize: 17, fontWeight: '900' },
  sectionTitleBlock: { flex: 1 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 2 },
  sectionSubtitle: { color: '#b9b0cd', fontSize: 13, lineHeight: 18 },
  viewAllBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  viewAllText: { color: '#c084fc', fontSize: 13, fontWeight: '800' },
  viewAllArrow: { color: '#c084fc', fontSize: 16, fontWeight: '900' },
  itemList: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  resourceRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255,255,255,0.07)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 74,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  resourceRowCompact: {
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  itemIcon: {
    alignItems: 'center',
    borderRadius: 12,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  itemIconText: { fontSize: 19, fontWeight: '900' },
  itemCopy: {
    flex: 1,
    minWidth: 120,
  },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 4 },
  itemDesc: { color: '#c7c0d8', fontSize: 13, lineHeight: 18 },
  actionRow: {
    flexDirection: 'row',
    flexShrink: 0,
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  actionRowCompact: {
    alignSelf: 'stretch',
    justifyContent: 'flex-start',
    marginLeft: 60,
  },
  actionButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    minWidth: 76,
    paddingHorizontal: 14,
  },
  actionText: { fontSize: 13, fontWeight: '900' },
  emergencyCard: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.22)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
    overflow: 'hidden',
    padding: 18,
  },
  emergencyCardCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  emergencyIconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(183, 119, 255, 0.22)',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  emergencyIcon: { color: '#fff', fontSize: 30, fontWeight: '900' },
  emergencyCopy: { flex: 1, minWidth: 160 },
  emergencyTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 5 },
  emergencyText: { color: '#ded8ec', fontSize: 13, lineHeight: 19 },
  emergencyButton: {
    alignItems: 'center',
    backgroundColor: '#ef445b',
    borderRadius: 24,
    minHeight: 48,
    paddingHorizontal: 22,
    justifyContent: 'center',
  },
  emergencyButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  textModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 4, 14, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  textModalCard: {
    backgroundColor: '#111632',
    borderColor: 'rgba(183, 119, 255, 0.34)',
    borderRadius: 18,
    borderWidth: 1,
    maxWidth: 440,
    padding: 20,
    width: '100%',
  },
  textModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  textModalIcon: {
    alignItems: 'center',
    borderRadius: 18,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  textModalIconText: { fontSize: 17, fontWeight: '900' },
  textModalTitleBlock: { flex: 1, minWidth: 0 },
  textModalLabel: { color: '#b9b0cd', fontSize: 12, fontWeight: '800', marginBottom: 3 },
  textModalTitle: { color: '#fff', fontSize: 18, fontWeight: '900', lineHeight: 24 },
  textModalDesc: { color: '#d8d1e8', fontSize: 14, lineHeight: 21, marginBottom: 16 },
  textDetailGroup: {
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    marginBottom: 18,
    padding: 14,
  },
  textDetailRow: {
    gap: 6,
  },
  textDetailLabel: { color: '#9e96b6', fontSize: 12, fontWeight: '800' },
  textDetailValue: { color: '#fff', fontSize: 18, fontWeight: '900', lineHeight: 25 },
  textModalActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
  },
  textModalSecondary: {
    alignItems: 'center',
    borderColor: 'rgba(199, 180, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 18,
  },
  textModalPrimary: {
    alignItems: 'center',
    borderRadius: 18,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 18,
  },
  textModalSecondaryText: { color: '#d9bcff', fontSize: 13, fontWeight: '900' },
  textModalPrimaryText: { color: '#050715', fontSize: 13, fontWeight: '900' },
});
