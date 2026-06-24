import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  ImageBackground,
  ImageSourcePropType,
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
import teenGroup from '../../assets/images/teen-group.png';
import safetyPlanCard from '../../assets/images/safety-plan-card.png';
import resourcesCard from '../../assets/images/resources-card.png';
import journalCard from '../../assets/images/journal-card.png';

type StepId =
  | 'safeLocations'
  | 'trustedPerson'
  | 'goBag'
  | 'emergencyContacts'
  | 'exitPlan'
  | 'safeWord'
  | 'evidenceVault';

type SafetyPlanState = {
  completed: StepId[];
  safeWord: string;
  notes: string;
  escapeDestination: string;
  transportation: string;
  travelTime: string;
  safeLocations: string[];
  goBagChecked: string[];
};

const GO_BAG_ITEMS = [
  'Photo ID / Passport',
  'Cash',
  'Medications',
  'Phone charger',
  'Important documents',
  'Change of clothes',
  'Emergency contact numbers',
  'Keys',
];

const STORAGE_KEY = 'safetyPlan';

const STEPS: Array<{
  id: StepId;
  title: string;
  desc: string;
  action: string;
  icon: string;
  color: string;
  image?: ImageSourcePropType;
  route?: string;
}> = [
  {
    id: 'safeLocations',
    title: 'Safe Locations',
    desc: 'Add places you can go quickly if you need help.',
    action: 'Add Location',
    icon: 'L',
    color: '#ff6b9a',
    image: safetyPlanCard,
  },
  {
    id: 'trustedPerson',
    title: 'Trusted Person',
    desc: 'Choose someone you trust who will believe you and help you.',
    action: 'Add Contact',
    icon: 'P',
    color: '#b777ff',
    image: teenGroup,
    route: 'Contacts',
  },
  {
    id: 'goBag',
    title: 'Emergency Go Bag',
    desc: 'Pack ID, cash, medicine, documents, charger, and essentials.',
    action: 'Create Checklist',
    icon: 'B',
    color: '#f59e0b',
  },
  {
    id: 'emergencyContacts',
    title: 'Emergency Contacts',
    desc: 'Save hotlines, trusted people, and important numbers.',
    action: 'Manage Contacts',
    icon: 'C',
    color: '#4aa8ff',
    image: resourcesCard,
    route: 'Contacts',
  },
  {
    id: 'exitPlan',
    title: 'Exit Plan',
    desc: 'Plan your route, destination, transportation, and timing.',
    action: 'Create Plan',
    icon: 'E',
    color: '#facc15',
    image: safetyPlanCard,
  },
  {
    id: 'safeWord',
    title: 'Safe Word',
    desc: 'Create a code word trusted people will recognize.',
    action: 'Set Safe Word',
    icon: 'W',
    color: '#c084fc',
  },
  {
    id: 'evidenceVault',
    title: 'Evidence Vault',
    desc: 'Securely store photos, videos, audio, and notes.',
    action: 'Open Vault',
    icon: 'V',
    color: '#4ee1d5',
    route: 'Evidence',
  },
];

function withCompletedStep(completed: StepId[], id: StepId): StepId[] {
  return completed.includes(id) ? completed : [...completed, id];
}

const defaultPlan: SafetyPlanState = {
  completed: [],
  safeWord: '',
  notes: '',
  escapeDestination: '',
  transportation: '',
  travelTime: '',
  safeLocations: [],
  goBagChecked: [],
};

export default function SafetyScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const pageMaxWidth = isWide ? 1000 : 620;
  const pageWidth = Math.min(Math.max(width - 36, 320), pageMaxWidth);
  const layoutGap = 14;
  const progressPanelWidth = isWide ? 300 : pageWidth;
  const cardsGridWidth = isWide ? pageWidth - progressPanelWidth - layoutGap : pageWidth;
  const stepCardWidth = isWide ? (cardsGridWidth - layoutGap) / 2 : pageWidth;
  const utilityCardWidth = isWide ? (pageWidth - layoutGap * 2) / 3 : pageWidth;
  const [plan, setPlan] = useState<SafetyPlanState>(defaultPlan);
  const [saving, setSaving] = useState(false);
  const [expandedStep, setExpandedStep] = useState<StepId | null>(null);
  const [newLocation, setNewLocation] = useState('');
  const [editEscape, setEditEscape] = useState(false);

  useEffect(() => {
    getPrivateData<SafetyPlanState>(STORAGE_KEY)
      .then(async (stored) => {
        if (stored) {
          setPlan({ ...defaultPlan, ...stored });
          await AsyncStorage.removeItem(STORAGE_KEY);
          return;
        }

        const local = await AsyncStorage.getItem(STORAGE_KEY);
        if (local) {
          const parsed = { ...defaultPlan, ...JSON.parse(local) };
          setPlan(parsed);
          await savePrivateData(STORAGE_KEY, parsed);
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => {});
  }, []);

  const completedSet = useMemo(() => new Set(plan.completed), [plan.completed]);
  const percent = Math.round((plan.completed.length / STEPS.length) * 100);

  const persist = async (next: SafetyPlanState) => {
    setPlan(next);
    await savePrivateData(STORAGE_KEY, next);
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const toggleStep = async (id: StepId) => {
    const exists = completedSet.has(id);
    const next = {
      ...plan,
      completed: exists
        ? plan.completed.filter((stepId) => stepId !== id)
        : [...plan.completed, id],
    };
    await persist(next);
  };

  const updatePlan = async (patch: Partial<SafetyPlanState>) => {
    await persist({ ...plan, ...patch });
  };

  const addLocation = async () => {
    const loc = newLocation.trim();
    if (!loc) return;
    const updated = [...plan.safeLocations, loc];
    await updatePlan({ safeLocations: updated, completed: withCompletedStep(plan.completed, 'safeLocations') });
    setNewLocation('');
  };

  const removeLocation = async (idx: number) => {
    const updated = plan.safeLocations.filter((_, i) => i !== idx);
    await updatePlan({ safeLocations: updated });
  };

  const toggleGoBagItem = async (item: string) => {
    const already = plan.goBagChecked.includes(item);
    const updated = already ? plan.goBagChecked.filter((i) => i !== item) : [...plan.goBagChecked, item];
    const allDone = GO_BAG_ITEMS.every((i) => updated.includes(i));
    await updatePlan({
      goBagChecked: updated,
      completed: allDone
        ? withCompletedStep(plan.completed, 'goBag')
        : plan.completed.filter((id) => id !== 'goBag'),
    });
  };

  const saveSafeWord = async () => {
    const word = plan.safeWord.trim();
    if (!word) return;
    await updatePlan({ safeWord: word, completed: withCompletedStep(plan.completed, 'safeWord') });
    setExpandedStep(null);
  };

  const saveExitPlan = async () => {
    if (!plan.escapeDestination.trim()) return;
    await updatePlan({ completed: withCompletedStep(plan.completed, 'exitPlan') });
    setEditEscape(false);
  };

  const handleAction = async (step: (typeof STEPS)[number]) => {
    if (step.route) {
      navigation.navigate(step.route);
      return;
    }
    // Steps with inline input panels
    if (['safeLocations', 'goBag', 'safeWord', 'exitPlan'].includes(step.id)) {
      setExpandedStep(expandedStep === step.id ? null : step.id as StepId);
      return;
    }
    await toggleStep(step.id);
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await persist(plan);
      Alert.alert('Saved', 'Your safety plan notes were saved to your encrypted account storage.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.page, { maxWidth: pageMaxWidth }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.navigate('Home')} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>{'<'}</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Safety Plan</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.iconButton}>
              <Text style={styles.iconButtonText}>♡</Text>
            </TouchableOpacity>
          </View>

          <ImageBackground source={heroBg} resizeMode="cover" style={styles.hero} imageStyle={styles.heroImage}>
            <LinearGradient
              colors={['rgba(8, 9, 31, 0.98)', 'rgba(13, 13, 45, 0.64)', 'rgba(13, 13, 45, 0.2)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <Image source={teenGroup} resizeMode="contain" style={styles.heroPeople} />
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>
                Build your{'\n'}
                <Text style={styles.heroTitleAccent}>safety plan</Text>
              </Text>
              <Text style={styles.heroText}>
                Your safety plan is private and only visible to you. Complete the steps below so
                you are prepared if you ever need help quickly.
              </Text>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Your Progress</Text>
                <Text style={styles.progressPercent}>{percent}% Complete</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${percent}%` }]} />
              </View>
            </View>
            {isWide && (
              <View style={styles.quoteCard}>
                <View style={styles.quoteIcon}>
                  <Text style={styles.quoteIconText}>♥</Text>
                </View>
                <Text style={styles.quoteText}>
                  Preparation gives you options when you need them most.
                </Text>
              </View>
            )}
          </ImageBackground>

          <View style={[styles.mainGrid, !isWide && styles.mainGridStacked]}>
            <View style={[styles.progressPanel, { width: progressPanelWidth }]}>
              <Text style={styles.panelTitle}>Plan Progress</Text>
              {STEPS.map((step) => {
                const complete = completedSet.has(step.id);
                return (
                  <TouchableOpacity
                    key={step.id}
                    activeOpacity={0.82}
                    style={styles.progressStep}
                    onPress={() => toggleStep(step.id)}
                  >
                    <View style={[styles.smallIcon, { backgroundColor: `${step.color}26` }]}>
                      <Text style={[styles.smallIconText, { color: step.color }]}>{step.icon}</Text>
                    </View>
                    <Text style={styles.progressStepText}>{step.title}</Text>
                    <View style={[styles.checkCircle, complete && styles.checkCircleDone]}>
                      {complete && <Text style={styles.checkText}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={styles.viewStepsButton} activeOpacity={0.82}>
                <Text style={styles.viewStepsText}>View All Steps</Text>
                <Text style={styles.viewStepsArrow}>{'>'}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.cardsGrid, { width: cardsGridWidth }]}>
              {STEPS.slice(0, 6).map((step) => {
                const complete = completedSet.has(step.id);
                const isExpanded = expandedStep === step.id;
                return (
                  <LinearGradient
                    key={step.id}
                    colors={['rgba(29, 23, 70, 0.96)', 'rgba(12, 18, 48, 0.96)']}
                    style={[styles.stepCard, { width: stepCardWidth }]}
                  >
                    {step.image && (
                      <ImageBackground source={step.image} resizeMode="cover" style={styles.cardImage}>
                        <LinearGradient
                          colors={['rgba(12,18,48,0.12)', 'rgba(12,18,48,0.92)']}
                          style={StyleSheet.absoluteFill}
                        />
                      </ImageBackground>
                    )}
                    <View style={[styles.cardIcon, { backgroundColor: `${step.color}24` }]}>
                      <Text style={[styles.cardIconText, { color: step.color }]}>{step.icon}</Text>
                    </View>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepDesc}>{step.desc}</Text>

                    {/* Inline expanded panels */}
                    {isExpanded && step.id === 'safeLocations' && (
                      <View style={styles.expandedPanel}>
                        <View style={styles.inputRow}>
                          <TextInput
                            value={newLocation}
                            onChangeText={setNewLocation}
                            placeholder="e.g. Aunt Maria's house"
                            placeholderTextColor="#8b84aa"
                            style={[styles.expandInput, { flex: 1 }]}
                          />
                          <TouchableOpacity style={styles.addBtn} onPress={addLocation}>
                            <Text style={styles.addBtnText}>Add</Text>
                          </TouchableOpacity>
                        </View>
                        {plan.safeLocations.map((loc, i) => (
                          <View key={i} style={styles.locationRow}>
                            <Text style={[styles.locationDot, { color: step.color }]}>•</Text>
                            <Text style={styles.locationText}>{loc}</Text>
                            <TouchableOpacity onPress={() => removeLocation(i)}>
                              <Text style={styles.removeText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}

                    {isExpanded && step.id === 'goBag' && (
                      <View style={styles.expandedPanel}>
                        {GO_BAG_ITEMS.map((item) => {
                          const checked = plan.goBagChecked.includes(item);
                          return (
                            <TouchableOpacity
                              key={item}
                              style={styles.checkRow}
                              onPress={() => toggleGoBagItem(item)}
                              activeOpacity={0.76}
                            >
                              <View style={[styles.checkBox, checked && styles.checkBoxDone]}>
                                {checked && <Text style={styles.checkBoxText}>✓</Text>}
                              </View>
                              <Text style={[styles.checkRowText, checked && styles.checkRowTextDone]}>
                                {item}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}

                    {isExpanded && step.id === 'exitPlan' && (
                      <View style={styles.expandedPanel}>
                        <Text style={styles.exitLabel}>Destination</Text>
                        <TextInput
                          value={plan.escapeDestination}
                          onChangeText={(v) => setPlan((c) => ({ ...c, escapeDestination: v }))}
                          placeholder="Safe house, shelter..."
                          placeholderTextColor="#8b84aa"
                          style={styles.expandInput}
                        />
                        <Text style={styles.exitLabel}>Transportation</Text>
                        <TextInput
                          value={plan.transportation}
                          onChangeText={(v) => setPlan((c) => ({ ...c, transportation: v }))}
                          placeholder="Uber, bus, walking..."
                          placeholderTextColor="#8b84aa"
                          style={styles.expandInput}
                        />
                        <Text style={styles.exitLabel}>Estimated Travel Time</Text>
                        <TextInput
                          value={plan.travelTime}
                          onChangeText={(v) => setPlan((c) => ({ ...c, travelTime: v }))}
                          placeholder="15 minutes..."
                          placeholderTextColor="#8b84aa"
                          style={styles.expandInput}
                        />
                        <TouchableOpacity style={styles.saveExitBtn} onPress={saveExitPlan} activeOpacity={0.84}>
                          <Text style={styles.saveExitBtnText}>Save Exit Plan ✓</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {isExpanded && step.id === 'safeWord' && (
                      <View style={styles.expandedPanel}>
                        <TextInput
                          value={plan.safeWord}
                          onChangeText={(safeWord) => setPlan((c) => ({ ...c, safeWord }))}
                          placeholder="e.g. Purple Moon"
                          placeholderTextColor="#8b84aa"
                          style={styles.expandInput}
                        />
                        <TouchableOpacity
                          style={[styles.saveExitBtn, { borderColor: '#c084fc' }]}
                          onPress={saveSafeWord}
                          activeOpacity={0.84}
                        >
                          <Text style={[styles.saveExitBtnText, { color: '#c084fc' }]}>
                            Save Safe Word ✓
                          </Text>
                        </TouchableOpacity>
                        {plan.safeWord ? (
                          <Text style={styles.currentWordText}>
                            Current: <Text style={{ color: '#c084fc' }}>{plan.safeWord}</Text>
                          </Text>
                        ) : null}
                      </View>
                    )}

                    <View style={styles.cardFooter}>
                      <TouchableOpacity
                        activeOpacity={0.84}
                        style={[styles.stepButton, { borderColor: `${step.color}88` }]}
                        onPress={() => handleAction(step)}
                      >
                        <Text style={[styles.stepButtonText, { color: step.color }]}>
                          {isExpanded ? 'Close' : step.action}
                        </Text>
                        <Text style={[styles.stepButtonText, { color: step.color }]}>
                          {isExpanded ? '∧' : '>'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.82}
                        style={[styles.statusPill, complete && styles.statusPillDone]}
                        onPress={() => toggleStep(step.id)}
                      >
                        <Text style={[styles.statusText, complete && styles.statusTextDone]}>
                          {complete ? 'Complete' : 'Open'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </LinearGradient>
                );
              })}
            </View>
          </View>

          <View style={[styles.utilityGrid, !isWide && styles.utilityGridStacked]}>
            <ImageBackground
              source={heroBg}
              resizeMode="cover"
              imageStyle={styles.utilityImage}
              style={[styles.utilityCard, { width: utilityCardWidth }]}
            >
              <LinearGradient
                colors={['rgba(8, 18, 45, 0.94)', 'rgba(8, 18, 45, 0.5)']}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.utilityTitle}>Quick Escape Plan</Text>
              <Text style={styles.utilityText}>Create a plan for when you need to leave quickly.</Text>
              {!editEscape ? (
                <>
                  <View style={styles.detailList}>
                    <Text style={styles.detailLine}>
                      Destination: {plan.escapeDestination || 'Not set'}
                    </Text>
                    <Text style={styles.detailLine}>
                      Transportation: {plan.transportation || 'Not set'}
                    </Text>
                    <Text style={styles.detailLine}>
                      Est. Travel Time: {plan.travelTime || 'Not set'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    style={styles.cyanButton}
                    onPress={() => setEditEscape(true)}
                  >
                    <Text style={styles.cyanButtonText}>Edit Escape Plan</Text>
                    <Text style={styles.cyanButtonText}>{'>'}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.exitLabel}>Destination</Text>
                  <TextInput
                    value={plan.escapeDestination}
                    onChangeText={(v) => setPlan((c) => ({ ...c, escapeDestination: v }))}
                    placeholder="Safe house, shelter..."
                    placeholderTextColor="#8b84aa"
                    style={styles.expandInput}
                  />
                  <Text style={styles.exitLabel}>Transportation</Text>
                  <TextInput
                    value={plan.transportation}
                    onChangeText={(v) => setPlan((c) => ({ ...c, transportation: v }))}
                    placeholder="Uber, bus, walking..."
                    placeholderTextColor="#8b84aa"
                    style={styles.expandInput}
                  />
                  <Text style={styles.exitLabel}>Estimated Time</Text>
                  <TextInput
                    value={plan.travelTime}
                    onChangeText={(v) => setPlan((c) => ({ ...c, travelTime: v }))}
                    placeholder="15 minutes..."
                    placeholderTextColor="#8b84aa"
                    style={styles.expandInput}
                  />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <TouchableOpacity activeOpacity={0.84} style={styles.cyanButton} onPress={saveExitPlan}>
                      <Text style={styles.cyanButtonText}>Save Plan ✓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.84}
                      style={[styles.cyanButton, { borderColor: '#5d5875' }]}
                      onPress={() => setEditEscape(false)}
                    >
                      <Text style={[styles.cyanButtonText, { color: '#9b91bb' }]}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ImageBackground>

            <LinearGradient
              colors={['rgba(11, 30, 55, 0.95)', 'rgba(15, 17, 50, 0.95)']}
              style={[styles.utilityCard, { width: utilityCardWidth }]}
            >
              <Text style={styles.utilityTitle}>Evidence Vault</Text>
              <Text style={styles.utilityText}>Securely store photos, videos, audio, and notes.</Text>
              <View style={styles.detailList}>
                <Text style={styles.detailLine}>Photos: 2 items</Text>
                <Text style={styles.detailLine}>Videos: 1 item</Text>
                <Text style={styles.detailLine}>Notes: 3 items</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.84}
                style={styles.cyanButton}
                onPress={() => navigation.navigate('Evidence')}
              >
                <Text style={styles.cyanButtonText}>Open Vault</Text>
                <Text style={styles.cyanButtonText}>{'>'}</Text>
              </TouchableOpacity>
              <Text style={styles.encryptedText}>All files are encrypted</Text>
            </LinearGradient>

            <ImageBackground
              source={journalCard}
              resizeMode="cover"
              imageStyle={styles.utilityImage}
              style={[styles.utilityCard, { width: utilityCardWidth }]}
            >
              <LinearGradient
                colors={['rgba(28, 17, 65, 0.96)', 'rgba(28, 17, 65, 0.62)']}
                style={StyleSheet.absoluteFill}
              />
              <Text style={styles.utilityTitle}>My Notes</Text>
              <Text style={styles.utilityText}>Write anything important to remember.</Text>
              <TextInput
                value={plan.notes}
                onChangeText={(notes) => setPlan((current) => ({ ...current, notes }))}
                placeholder="Add private notes..."
                placeholderTextColor="#9b91bb"
                multiline
                textAlignVertical="top"
                style={styles.notesInput}
              />
              <TouchableOpacity activeOpacity={0.84} style={styles.purpleButton} onPress={saveNotes}>
                <Text style={styles.purpleButtonText}>{saving ? 'Saving...' : 'Save Notes'}</Text>
                <Text style={styles.purpleButtonText}>{'>'}</Text>
              </TouchableOpacity>
            </ImageBackground>
          </View>

          <LinearGradient
            colors={['rgba(91, 42, 173, 0.42)', 'rgba(23, 26, 74, 0.94)']}
            style={styles.rememberCard}
          >
            <View style={styles.rememberShield}>
              <Text style={styles.rememberShieldText}>S</Text>
            </View>
            <View style={styles.rememberCopy}>
              <Text style={styles.rememberTitle}>Remember</Text>
              <Text style={styles.rememberText}>
                You are not responsible for anyone else's actions. Leaving is not giving up;
                it is choosing your life. You deserve safety, respect, and happiness.
              </Text>
            </View>
            {isWide && <Text style={styles.rememberAffirmation}>You matter. You are enough.</Text>}
          </LinearGradient>
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
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  iconButtonText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900' },
  hero: {
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 22,
    borderWidth: 1,
    height: 320,
    justifyContent: 'center',
    marginBottom: 16,
    overflow: 'hidden',
  },
  heroImage: { borderRadius: 22 },
  heroPeople: {
    bottom: -26,
    height: 300,
    position: 'absolute',
    right: -34,
    width: 640,
  },
  heroCopy: {
    maxWidth: 390,
    paddingHorizontal: 28,
    zIndex: 2,
  },
  heroTitle: {
    color: '#fff',
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 44,
    marginBottom: 10,
  },
  heroTitleAccent: { color: '#a05cff' },
  heroText: { color: '#f0ecfb', fontSize: 16, lineHeight: 24, marginBottom: 20 },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    maxWidth: 330,
  },
  progressLabel: { color: '#fff', fontSize: 13, fontWeight: '900' },
  progressPercent: { color: '#f0c9ff', fontSize: 13, fontWeight: '800' },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderRadius: 8,
    height: 16,
    maxWidth: 330,
    overflow: 'hidden',
  },
  progressFill: { backgroundColor: '#934cff', borderRadius: 8, height: '100%' },
  quoteCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(17, 17, 53, 0.82)',
    borderColor: 'rgba(172, 120, 255, 0.32)',
    borderRadius: 18,
    borderWidth: 1,
    bottom: 22,
    flexDirection: 'row',
    gap: 16,
    maxWidth: 320,
    padding: 20,
    position: 'absolute',
    right: 22,
  },
  quoteIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(147, 76, 255, 0.24)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  quoteIconText: { color: '#b777ff', fontSize: 16, fontWeight: '900' },
  quoteText: { color: '#efe8ff', flex: 1, fontSize: 16, lineHeight: 23 },
  mainGrid: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, marginBottom: 14 },
  mainGridStacked: { flexDirection: 'column' },
  fullWidth: { width: '100%' },
  progressPanel: {
    backgroundColor: 'rgba(14, 17, 48, 0.94)',
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    width: 300,
  },
  panelTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 14 },
  progressStep: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  smallIcon: {
    alignItems: 'center',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  smallIconText: { fontSize: 15, fontWeight: '900' },
  progressStepText: { color: '#f3f0ff', flex: 1, fontSize: 14, fontWeight: '800' },
  checkCircle: {
    alignItems: 'center',
    borderColor: '#5d5875',
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkCircleDone: { borderColor: '#35e1cf', backgroundColor: 'rgba(53,225,207,0.14)' },
  checkText: { color: '#35e1cf', fontSize: 13, fontWeight: '900' },
  viewStepsButton: {
    alignItems: 'center',
    borderColor: 'rgba(183,119,255,0.44)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  viewStepsText: { color: '#eadcff', fontSize: 13, fontWeight: '800' },
  viewStepsArrow: { color: '#eadcff', fontSize: 16, fontWeight: '900' },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  stepCard: {
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 210,
    overflow: 'hidden',
    padding: 20,
  },
  cardImage: {
    bottom: 0,
    height: 118,
    opacity: 0.38,
    position: 'absolute',
    right: 0,
    width: 190,
  },
  cardIcon: {
    alignItems: 'center',
    borderRadius: 20,
    height: 42,
    justifyContent: 'center',
    marginBottom: 12,
    width: 42,
  },
  cardIconText: { fontSize: 18, fontWeight: '900' },
  stepTitle: { color: '#ffc4e2', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  stepDesc: { color: '#e2dcf2', fontSize: 13, lineHeight: 20, marginBottom: 16 },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 'auto',
  },
  stepButton: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 16,
  },
  stepButtonText: { fontSize: 13, fontWeight: '900' },
  statusPill: {
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusPillDone: { borderColor: '#35e1cf', backgroundColor: 'rgba(53,225,207,0.12)' },
  statusText: { color: '#bdb5d7', fontSize: 12, fontWeight: '800' },
  statusTextDone: { color: '#35e1cf' },
  utilityGrid: { alignItems: 'flex-start', flexDirection: 'row', gap: 14, marginBottom: 14 },
  utilityGridStacked: { flexDirection: 'column' },
  utilityCard: {
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 280,
    overflow: 'hidden',
    padding: 20,
  },
  utilityImage: { borderRadius: 16 },
  utilityTitle: { color: '#fff', fontSize: 18, fontWeight: '900', marginBottom: 8 },
  utilityText: { color: '#e5def4', fontSize: 13, lineHeight: 20, marginBottom: 16 },
  detailList: { gap: 8, marginBottom: 18 },
  detailLine: { color: '#d8d0ec', fontSize: 13, lineHeight: 18 },
  cyanButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#35e1cf',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 'auto',
    minHeight: 38,
    paddingHorizontal: 16,
  },
  cyanButtonText: { color: '#35e1cf', fontSize: 13, fontWeight: '900' },
  encryptedText: { color: '#8f89aa', fontSize: 12, marginTop: 12 },
  notesInput: {
    backgroundColor: 'rgba(8, 10, 30, 0.78)',
    borderColor: 'rgba(183,119,255,0.24)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    minHeight: 92,
    outlineStyle: 'none' as never,
    padding: 12,
  },
  purpleButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#b777ff',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    minHeight: 38,
    paddingHorizontal: 16,
  },
  purpleButtonText: { color: '#d9bcff', fontSize: 13, fontWeight: '900' },
  rememberCard: {
    alignItems: 'center',
    borderColor: 'rgba(149, 110, 255, 0.28)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    padding: 20,
  },
  rememberShield: {
    alignItems: 'center',
    backgroundColor: 'rgba(183,119,255,0.24)',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  rememberShieldText: { color: '#d9bcff', fontSize: 24, fontWeight: '900' },
  rememberCopy: { flex: 1 },
  rememberTitle: { color: '#b777ff', fontSize: 18, fontWeight: '900', marginBottom: 5 },
  rememberText: { color: '#e5def4', fontSize: 13, lineHeight: 20 },
  rememberAffirmation: {
    color: '#cda7ff',
    fontSize: 16,
    fontWeight: '900',
    maxWidth: 300,
    textAlign: 'center',
  },
  expandedPanel: {
    backgroundColor: 'rgba(8, 10, 30, 0.72)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
    padding: 12,
  },
  inputRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  expandInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(183,119,255,0.32)',
    borderRadius: 10,
    borderWidth: 1,
    color: '#fff',
    fontSize: 14,
    minHeight: 38,
    outlineStyle: 'none' as never,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addBtn: {
    backgroundColor: 'rgba(147,76,255,0.22)',
    borderColor: '#934cff',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  addBtnText: { color: '#d4abff', fontSize: 13, fontWeight: '900' },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  locationDot: { fontSize: 18, fontWeight: '900' },
  locationText: { color: '#e2dcf2', flex: 1, fontSize: 13 },
  removeText: { color: '#ff6b9a', fontSize: 14, fontWeight: '900', paddingHorizontal: 4 },
  checkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
  },
  checkBox: {
    alignItems: 'center',
    borderColor: '#5d5875',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkBoxDone: { backgroundColor: 'rgba(53,225,207,0.18)', borderColor: '#35e1cf' },
  checkBoxText: { color: '#35e1cf', fontSize: 13, fontWeight: '900' },
  checkRowText: { color: '#c8c0e0', flex: 1, fontSize: 13 },
  checkRowTextDone: { color: '#7de8db', textDecorationLine: 'line-through' },
  exitLabel: {
    color: '#9b91bb',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: -4,
    textTransform: 'uppercase',
  },
  saveExitBtn: {
    alignSelf: 'flex-start',
    borderColor: '#35e1cf',
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveExitBtnText: { color: '#35e1cf', fontSize: 13, fontWeight: '900' },
  currentWordText: { color: '#9b91bb', fontSize: 12, marginTop: 4 },
});
