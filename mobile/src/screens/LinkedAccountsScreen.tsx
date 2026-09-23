import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Share,
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

import { useSubscription } from '../context/SubscriptionContext';
import { ApiError } from '../services/apiClient';
import SettingRow from '../components/SettingRow';
import {
  acceptInvite,
  createInvite,
  getLinksToMe,
  getOwnedLinks,
  previewInvite,
  revokeLink,
  updateLinkPermissions,
  type InvitePreview,
  type LinkToMe,
  type OwnedLink,
  type RelationshipType,
} from '../services/accountLinkService';

const RELATIONSHIP_OPTIONS: Array<{ value: RelationshipType; label: string }> = [
  { value: 'child', label: 'Child' },
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
];

// This app has no deep-link/QR infra — invites are a typed, shareable code
// only (see accountLinkService.js). Not tied to a real feature-flag yet;
// remove this constant + the banner below once emergency/location
// delivery to linked viewers actually ships.
const SHARING_NOT_LIVE_YET_COPY =
  "Live sharing for linked accounts is being rolled out. Permissions you set now are saved and will take effect automatically once enabled.";

function relationshipLabel(type: RelationshipType) {
  return RELATIONSHIP_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function relationshipColor(type: RelationshipType) {
  if (type === 'child') return '#f59e0b';
  if (type === 'family') return '#4aa8ff';
  return '#17b8ac';
}

const REASON_COPY: Record<string, string> = {
  invalid_code: "That code isn't valid. Double-check it and try again.",
  expired: 'This invite code has expired. Ask for a new one.',
  too_many_attempts: 'Too many attempts on this code. Ask for a new invite.',
  owner_at_cap: "This person has already reached their Bes Pro linked-account limit.",
  cannot_link_self: "You can't link your own account.",
};

export default function LinkedAccountsScreen() {
  const navigation = useNavigation<any>();
  const { isPremium, linkedAccountLimit } = useSubscription();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const pageMaxWidth = isWide ? 1180 : 620;

  const [ownedLinks, setOwnedLinks] = useState<OwnedLink[]>([]);
  const [linksToMe, setLinksToMe] = useState<LinkToMe[]>([]);
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [relationship, setRelationship] = useState<RelationshipType>('family');
  const [inviting, setInviting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [accepting, setAccepting] = useState(false);

  const activeLinks = ownedLinks.filter((link) => link.status !== 'revoked');
  const atLinkCap = linkedAccountLimit > 0 && activeLinks.length >= linkedAccountLimit;

  const loadAll = useCallback(async () => {
    try {
      const [owned, toMe] = await Promise.all([getOwnedLinks(), getLinksToMe()]);
      setOwnedLinks(owned);
      setLinksToMe(toMe);
    } catch {
      // Network hiccup — leave whatever was last loaded rather than clearing it.
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Profile');
  };

  const handleInviteTrigger = () => {
    if (!isPremium) {
      navigation.navigate('Paywall', { reason: 'linked-accounts' });
      return;
    }
    if (atLinkCap) {
      Alert.alert(
        'Linked account limit reached',
        `You've reached your Bes Pro linked-account limit of ${linkedAccountLimit}. Remove an existing linked account before adding another.`,
      );
      return;
    }
    setGeneratedCode(null);
    setShowInviteForm((current) => !current);
  };

  const handleCreateInvite = async () => {
    setInviting(true);
    try {
      const created = await createInvite(relationship);
      setGeneratedCode(created.code);
      await loadAll();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'LINKED_ACCOUNT_LIMIT_REACHED') {
        setShowInviteForm(false);
        Alert.alert('Linked account limit reached', error.message);
      } else {
        Alert.alert('Error', 'Could not create invite. Check your connection.');
      }
    } finally {
      setInviting(false);
    }
  };

  const handleShareCode = async (code: string) => {
    try {
      await Share.share({ message: `Join me on Bes — enter this code in your app to link accounts: ${code}` });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const handleLookUpCode = async () => {
    if (!codeInput.trim()) return;
    setLookingUp(true);
    try {
      const result = await previewInvite(codeInput.trim());
      setPreview(result);
    } catch (error) {
      const code = error instanceof ApiError ? error.code : undefined;
      Alert.alert('Invalid code', (code && REASON_COPY[code]) || 'Could not look up that code.');
    } finally {
      setLookingUp(false);
    }
  };

  const handleAcceptInvite = async () => {
    setAccepting(true);
    try {
      await acceptInvite(codeInput.trim());
      setPreview(null);
      setCodeInput('');
      setShowCodeEntry(false);
      await loadAll();
      Alert.alert('Linked', "You're now linked. You can review or revoke this anytime.");
    } catch (error) {
      const errCode = error instanceof ApiError ? error.code : undefined;
      Alert.alert('Could not accept invite', (errCode && REASON_COPY[errCode]) || 'Please try again.');
      setPreview(null);
    } finally {
      setAccepting(false);
    }
  };

  const handleRevokeOwned = (link: OwnedLink) => {
    Alert.alert(
      link.status === 'pending' ? 'Cancel invite?' : 'Remove linked account?',
      link.status === 'pending'
        ? 'This invite code will no longer work.'
        : `This person will no longer be linked to your account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: link.status === 'pending' ? 'Cancel Invite' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await revokeLink(link.id);
              await loadAll();
            } catch {
              Alert.alert('Error', 'Could not remove this link. Check your connection.');
            }
          },
        },
      ],
    );
  };

  const handleRevokeLinkedToMe = (link: LinkToMe) => {
    Alert.alert('Revoke this connection?', `${link.ownerName} will no longer see your shared safety status.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            await revokeLink(link.id);
            await loadAll();
          } catch {
            Alert.alert('Error', 'Could not revoke this link. Check your connection.');
          }
        },
      },
    ]);
  };

  const handleTogglePermission = async (
    link: OwnedLink,
    key: 'emergencyAlerts' | 'liveLocationDuringEmergency',
    value: boolean,
  ) => {
    try {
      const updated = await updateLinkPermissions(link.id, { [key]: value });
      setOwnedLinks((current) => current.map((l) => (l.id === updated.id ? updated : l)));
    } catch {
      Alert.alert('Error', 'Could not update permissions. Check your connection.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} testID="linked-accounts-screen" accessible accessibilityLabel="linked-accounts-screen">
      <ScrollView
        contentContainerStyle={[styles.scroll, { maxWidth: pageMaxWidth }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack} style={styles.headerButton} activeOpacity={0.82}>
            <Text style={styles.headerButtonText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Linked Accounts</Text>
          <TouchableOpacity onPress={handleInviteTrigger} style={styles.addTopButton} activeOpacity={0.82}>
            <Text style={styles.addTopText}>+</Text>
          </TouchableOpacity>
        </View>

        <LinearGradient
          colors={['rgba(12, 16, 45, 0.98)', 'rgba(10, 12, 38, 0.94)']}
          style={[styles.hero, !isWide && styles.heroNarrow]}
        >
          <View style={[styles.heroIcon, !isWide && styles.heroIconNarrow]}>
            <Text style={styles.heroIconText}>L</Text>
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>
              Your circle. Your <Text style={styles.heroAccent}>consent.</Text>
            </Text>
            <Text style={styles.heroText}>
              Invite family or friends to link their own Bes account with yours. They choose what to
              share, and can revoke it anytime — this is different from Trusted Contacts.
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.banner}>
          <Text style={styles.bannerText}>{SHARING_NOT_LIVE_YET_COPY}</Text>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Your Linked Accounts</Text>
          <Text style={styles.limitText}>
            {activeLinks.length}/{linkedAccountLimit || 5}
          </Text>
        </View>

        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          {activeLinks.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Text style={styles.emptyIconText}>L</Text>
              </View>
              <Text style={styles.emptyTitle}>No linked accounts yet</Text>
              <Text style={styles.emptyText}>Invite someone below.</Text>
            </View>
          ) : (
            activeLinks.map((link, index) => {
              const color = relationshipColor(link.relationshipType);
              const expanded = expandedLinkId === link.id;
              return (
                <View key={link.id}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.row, index < activeLinks.length - 1 && !expanded && styles.rowBorder]}
                    onPress={() => setExpandedLinkId(expanded ? null : link.id)}
                    disabled={link.status === 'pending'}
                  >
                    <View style={[styles.avatar, { backgroundColor: `${color}33`, borderColor: `${color}88` }]}>
                      <Text style={[styles.avatarText, { color }]}>{relationshipLabel(link.relationshipType).charAt(0)}</Text>
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>
                        {link.status === 'pending' ? 'Invite pending' : link.linkedUserName}
                      </Text>
                      <Text style={styles.rowSubtitle}>
                        {relationshipLabel(link.relationshipType)}
                        {link.status === 'pending' ? ' — code not yet redeemed' : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.82}
                      style={styles.removeButton}
                      onPress={() => handleRevokeOwned(link)}
                    >
                      <Text style={styles.removeButtonText}>
                        {link.status === 'pending' ? 'Cancel' : 'Remove'}
                      </Text>
                    </TouchableOpacity>
                    {link.status === 'active' && <Text style={styles.rowArrow}>{expanded ? 'v' : '>'}</Text>}
                  </TouchableOpacity>

                  {expanded && link.status === 'active' && (
                    <View style={styles.permissionsPanel}>
                      <SettingRow
                        title="Emergency alerts"
                        description="They'll be notified when you activate an emergency."
                        value={link.permissions.emergencyAlerts}
                        onToggle={(v) => handleTogglePermission(link, 'emergencyAlerts', v)}
                      />
                      <View style={styles.permissionsDivider} />
                      <SettingRow
                        title="Live location during emergency"
                        description="They'll see your live location only while an emergency is active."
                        value={link.permissions.liveLocationDuringEmergency}
                        onToggle={(v) => handleTogglePermission(link, 'liveLocationDuringEmergency', v)}
                      />
                      <View style={styles.permissionsDivider} />
                      <View style={styles.bgLocationRow}>
                        <Text style={styles.bgLocationTitle}>
                          Background location: {link.permissions.backgroundLocation ? 'On' : 'Off'}
                        </Text>
                        <Text style={styles.bgLocationDesc}>
                          Only the linked person can enable this from their own Bes settings.
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </LinearGradient>

        <TouchableOpacity
          activeOpacity={0.86}
          style={styles.dashedCard}
          onPress={handleInviteTrigger}
          testID="linked-accounts-invite-toggle-btn"
          accessibilityLabel="linked-accounts-invite-toggle-btn"
        >
          <View style={styles.addIconCircle}>
            <Text style={styles.addIconText}>+</Text>
          </View>
          <View style={styles.addCopy}>
            <Text style={styles.addTitle}>
              {!isPremium ? 'Unlock Linked Accounts' : atLinkCap ? 'Linked Account Limit Reached' : 'Invite Person'}
            </Text>
            <Text style={styles.addText}>
              {!isPremium
                ? 'Bes Pro lets you invite up to 5 family or friends to link accounts.'
                : atLinkCap
                  ? `You've reached your Bes Pro linked-account limit of ${linkedAccountLimit}. Remove an existing linked account before adding another.`
                  : 'Invite a family member or friend to link their Bes account with yours.'}
            </Text>
          </View>
        </TouchableOpacity>

        {showInviteForm && isPremium && !atLinkCap && (
          <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.form}>
            {!generatedCode ? (
              <>
                <Text style={styles.formTitle}>Relationship</Text>
                <View style={styles.relationshipRow}>
                  {RELATIONSHIP_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      activeOpacity={0.84}
                      style={[styles.relationshipChip, relationship === option.value && styles.relationshipChipActive]}
                      onPress={() => setRelationship(option.value)}
                    >
                      <Text
                        style={[
                          styles.relationshipChipText,
                          relationship === option.value && styles.relationshipChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, inviting && styles.disabledButton]}
                  onPress={handleCreateInvite}
                  disabled={inviting}
                  activeOpacity={0.84}
                  testID="linked-accounts-create-invite-btn"
                  accessibilityLabel="linked-accounts-create-invite-btn"
                >
                  <Text style={styles.primaryButtonText}>{inviting ? 'Creating...' : 'Create Invite Code'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.formTitle}>Share this code</Text>
                <Text style={styles.codeText}>{generatedCode}</Text>
                <Text style={styles.codeHint}>
                  Send this to the person you're inviting. They'll enter it in their own Bes app to accept.
                </Text>
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => handleShareCode(generatedCode)}
                  activeOpacity={0.84}
                >
                  <Text style={styles.primaryButtonText}>Share Code</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setShowInviteForm(false);
                    setGeneratedCode(null);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.secondaryButtonText}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </LinearGradient>
        )}

        <TouchableOpacity
          activeOpacity={0.86}
          style={styles.dashedCard}
          onPress={() => {
            setPreview(null);
            setCodeInput('');
            setShowCodeEntry((current) => !current);
          }}
          testID="linked-accounts-code-entry-toggle-btn"
          accessibilityLabel="linked-accounts-code-entry-toggle-btn"
        >
          <View style={styles.addIconCircle}>
            <Text style={styles.addIconText}>#</Text>
          </View>
          <View style={styles.addCopy}>
            <Text style={styles.addTitle}>Have a code?</Text>
            <Text style={styles.addText}>Enter an invite code someone shared with you.</Text>
          </View>
        </TouchableOpacity>

        {showCodeEntry && (
          <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.form}>
            {!preview ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="XXXX-XXXX-XX"
                  placeholderTextColor="#7f7899"
                  value={codeInput}
                  onChangeText={setCodeInput}
                  autoCapitalize="characters"
                  testID="linked-accounts-code-input"
                  accessibilityLabel="linked-accounts-code-input"
                />
                <TouchableOpacity
                  style={[styles.primaryButton, lookingUp && styles.disabledButton]}
                  onPress={handleLookUpCode}
                  disabled={lookingUp}
                  activeOpacity={0.84}
                  testID="linked-accounts-lookup-btn"
                  accessibilityLabel="linked-accounts-lookup-btn"
                >
                  <Text style={styles.primaryButtonText}>{lookingUp ? 'Looking up...' : 'Look Up'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.formTitle}>
                  {preview.ownerName} invited you to link accounts as {relationshipLabel(preview.relationshipType)}
                </Text>
                <Text style={styles.consentIntro}>This connection may share:</Text>
                {preview.sharesEmergencyAlerts && <Text style={styles.consentBullet}>• Emergency alerts</Text>}
                {preview.sharesLiveLocationDuringEmergency && (
                  <Text style={styles.consentBullet}>• Live location during an emergency</Text>
                )}
                <Text style={styles.codeHint}>You can revoke this connection anytime.</Text>
                <TouchableOpacity
                  style={[styles.primaryButton, accepting && styles.disabledButton]}
                  onPress={handleAcceptInvite}
                  disabled={accepting}
                  activeOpacity={0.84}
                  testID="linked-accounts-accept-btn"
                  accessibilityLabel="linked-accounts-accept-btn"
                >
                  <Text style={styles.primaryButtonText}>{accepting ? 'Accepting...' : 'Accept Link'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => setPreview(null)} activeOpacity={0.7}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </LinearGradient>
        )}

        {linksToMe.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Linked to Your Account</Text>
            </View>
            <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
              {linksToMe.map((link, index) => {
                const color = relationshipColor(link.relationshipType);
                return (
                  <View
                    key={link.id}
                    style={[styles.row, index < linksToMe.length - 1 && styles.rowBorder]}
                  >
                    <View style={[styles.avatar, { backgroundColor: `${color}33`, borderColor: `${color}88` }]}>
                      <Text style={[styles.avatarText, { color }]}>{link.ownerName.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{link.ownerName}</Text>
                      <Text style={styles.rowSubtitle}>{relationshipLabel(link.relationshipType)}</Text>
                    </View>
                    <TouchableOpacity
                      activeOpacity={0.82}
                      style={styles.removeButton}
                      onPress={() => handleRevokeLinkedToMe(link)}
                    >
                      <Text style={styles.removeButtonText}>Revoke</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </LinearGradient>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
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
  headerButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
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
    marginBottom: 16,
    minHeight: 178,
    overflow: 'hidden',
    padding: 28,
  },
  heroNarrow: { alignItems: 'flex-start', flexDirection: 'column' },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(137, 76, 255, 0.24)',
    borderRadius: 56,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  heroIconNarrow: { borderRadius: 42, height: 84, width: 84 },
  heroIconText: { color: '#b777ff', fontSize: 38, fontWeight: '900' },
  heroCopy: { flex: 1, minWidth: 260, zIndex: 2 },
  heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900', lineHeight: 36, marginBottom: 12 },
  heroAccent: { color: '#9f58ff' },
  heroText: { color: '#d8d2e8', fontSize: 15, lineHeight: 22, maxWidth: 620 },
  banner: {
    backgroundColor: 'rgba(90,78,148,0.16)',
    borderColor: 'rgba(149,110,255,0.28)',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
    padding: 14,
  },
  bannerText: { color: '#c7bfe0', fontSize: 12, lineHeight: 18 },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '900' },
  limitText: { color: '#918aaa', fontSize: 13, fontWeight: '700' },
  card: {
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  emptyState: { alignItems: 'center', minHeight: 160, justifyContent: 'center' },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.2)',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    marginBottom: 12,
    width: 56,
  },
  emptyIconText: { color: '#b777ff', fontSize: 22, fontWeight: '900' },
  emptyTitle: { color: '#fff', fontSize: 16, fontWeight: '900', marginBottom: 4 },
  emptyText: { color: '#a9a1bd', fontSize: 13 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    minHeight: 76,
    paddingVertical: 14,
  },
  rowBorder: { borderBottomColor: 'rgba(255,255,255,0.08)', borderBottomWidth: 1 },
  avatar: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: { fontSize: 18, fontWeight: '900' },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 3 },
  rowSubtitle: { color: '#a9a1bd', fontSize: 12 },
  rowArrow: { color: '#9b94ac', fontSize: 22, fontWeight: '300' },
  removeButton: {
    alignItems: 'center',
    borderColor: 'rgba(239,68,91,0.5)',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  removeButtonText: { color: '#ff6b7d', fontSize: 12, fontWeight: '900' },
  permissionsPanel: {
    borderBottomColor: 'rgba(255,255,255,0.08)',
    borderBottomWidth: 1,
    gap: 14,
    paddingBottom: 18,
    paddingTop: 4,
  },
  permissionsDivider: { backgroundColor: 'rgba(90,78,148,0.18)', height: 1 },
  bgLocationRow: { gap: 4 },
  bgLocationTitle: { color: '#f0ecfb', fontSize: 14, fontWeight: '800' },
  bgLocationDesc: { color: '#8b84aa', fontSize: 12, lineHeight: 18 },
  dashedCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(13, 18, 49, 0.8)',
    borderColor: 'rgba(149, 110, 255, 0.45)',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
    minHeight: 96,
    padding: 20,
  },
  addIconCircle: {
    alignItems: 'center',
    backgroundColor: 'rgba(137,76,255,0.18)',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  addIconText: { color: '#a461ff', fontSize: 32, fontWeight: '300', lineHeight: 34 },
  addCopy: { flex: 1, minWidth: 0 },
  addTitle: { color: '#b777ff', fontSize: 16, fontWeight: '900', marginBottom: 4 },
  addText: { color: '#aaa4bb', fontSize: 13, lineHeight: 19 },
  form: {
    borderColor: 'rgba(149, 110, 255, 0.26)',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    padding: 20,
  },
  formTitle: { color: '#fff', fontSize: 15, fontWeight: '900', marginBottom: 14 },
  relationshipRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  relationshipChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(149,110,255,0.24)',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  relationshipChipActive: { backgroundColor: '#7c3aed', borderColor: '#9d65ff' },
  relationshipChipText: { color: '#b9b0cd', fontSize: 13, fontWeight: '900' },
  relationshipChipTextActive: { color: '#fff' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    justifyContent: 'center',
    marginBottom: 10,
    minHeight: 50,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  secondaryButtonText: { color: '#918aaa', fontSize: 13, fontWeight: '800' },
  disabledButton: { opacity: 0.62 },
  codeText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 10,
    textAlign: 'center',
  },
  codeHint: { color: '#a9a1bd', fontSize: 12, lineHeight: 18, marginBottom: 16, textAlign: 'center' },
  input: {
    backgroundColor: 'rgba(5, 7, 21, 0.78)',
    borderColor: 'rgba(149,110,255,0.22)',
    borderRadius: 12,
    borderWidth: 1,
    color: '#fff',
    fontSize: 15,
    marginBottom: 14,
    minHeight: 50,
    outlineStyle: 'none' as never,
    paddingHorizontal: 14,
    textAlign: 'center',
  },
  consentIntro: { color: '#a9a1bd', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  consentBullet: { color: '#e4ccff', fontSize: 13, lineHeight: 20 },
});
