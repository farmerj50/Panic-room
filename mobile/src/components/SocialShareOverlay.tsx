import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { ApiError } from '../services/apiClient';
import type { ShareableSegmentEntry } from '../services/shareSegment';
import {
  DEFAULT_PRIVACY_LEVEL,
  getPublishOptions,
  postSocialShare,
  type SocialConnection,
  type SocialPrivacyLevel,
  type SocialProvider,
  type SocialShareResult,
} from '../services/socialSharingService';

// Emergency Social Sharing — the auto Share prompt and the Publishing flow.
// Rendered inside EmergencyLiveScreen as an absolute-fill overlay, never a
// navigation push, so the live camera/recording is never affected by a
// screen losing focus. Nothing here can reach the activation pipeline: the
// only side effects are the injected resolveShareSegment (reuses an existing
// segment first, see shareSegment.ts) and postSocialShare.
//
// Posting always takes two explicit taps — "Share Emergency" on the prompt,
// then "Share to …" on the review screen. The prompt's countdown expiring
// only hides it.

export const SHARE_PROMPT_SECONDS = 5;
const NO_VIDEO_RETRY_DELAY_MS = 3000;

const PROVIDER_LABELS: Record<SocialProvider, string> = { tiktok: 'TikTok', instagram: 'Instagram' };
const PROVIDER_HOME_URLS: Record<SocialProvider, string> = {
  tiktok: 'https://www.tiktok.com/',
  instagram: 'https://www.instagram.com/',
};

// Most private first — the first allowed one is the default selection.
const TIKTOK_PRIVACY_ORDER = ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'];
const PRIVACY_LABELS: Record<string, string> = {
  SELF_ONLY: 'Only me',
  MUTUAL_FOLLOW_FRIENDS: 'Friends',
  FOLLOWER_OF_CREATOR: 'Followers',
  PUBLIC_TO_EVERYONE: 'Public',
  PUBLIC: 'Public',
};

type Phase = 'hidden' | 'prompt' | 'pick' | 'publishing' | 'progress' | 'result';
type SegmentState = { kind: 'loading' } | { kind: 'ready'; entry: ShareableSegmentEntry } | { kind: 'none' };
type Outcome = SocialShareResult | { provider: SocialProvider; status: 'failed'; error: string };

type Props = {
  emergencyId: string;
  recording: boolean;
  providers: SocialConnection[];
  resolveShareSegment: () => Promise<ShareableSegmentEntry | null>;
  // Bumped by the manual Share button — opens the flow at the review step.
  openRequest: number;
  onShared: (result: SocialShareResult) => void;
};

function SegmentPreview({ uri }: { uri: string }) {
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setFailed(true);
    });
    return () => sub.remove();
  }, [player]);

  if (failed) {
    return (
      <View style={styles.previewPlaceholder}>
        <Text style={styles.muted}>Preview unavailable — the uploaded clip will still be posted.</Text>
      </View>
    );
  }
  return (
    <View style={styles.preview} testID="social-share-preview">
      <VideoView player={player} style={styles.previewVideo} nativeControls={false} contentFit="cover" />
    </View>
  );
}

export default function SocialShareOverlay({
  emergencyId,
  recording,
  providers,
  resolveShareSegment,
  openRequest,
  onShared,
}: Props) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [countdown, setCountdown] = useState(SHARE_PROMPT_SECONDS);
  const [provider, setProvider] = useState<SocialProvider | null>(null);
  const [segment, setSegment] = useState<SegmentState>({ kind: 'loading' });
  const [privacyLevels, setPrivacyLevels] = useState<SocialPrivacyLevel[] | null>(null);
  const [privacyLevel, setPrivacyLevel] = useState<SocialPrivacyLevel | null>(null);
  const [caption, setCaption] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pickSelection, setPickSelection] = useState<SocialProvider | null>(null);

  const promptShownRef = useRef(false);
  // Bumped whenever the user leaves the flow, so late async results from an
  // abandoned review/progress step never move the UI.
  const flowRef = useRef(0);

  // ── Auto prompt: once per emergency, never posts on its own ─────────────
  useEffect(() => {
    if (promptShownRef.current || !recording || providers.length === 0) return;
    promptShownRef.current = true;
    setCountdown(SHARE_PROMPT_SECONDS);
    setPhase('prompt');
  }, [recording, providers.length]);

  useEffect(() => {
    if (phase !== 'prompt') return;
    if (countdown <= 0) {
      setPhase('hidden'); // timeout = dismiss. Never shares.
      return;
    }
    const t = setTimeout(() => setCountdown((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  const close = useCallback(() => {
    flowRef.current += 1;
    setPhase('hidden');
  }, []);

  const loadSegment = useCallback(async () => {
    const flow = flowRef.current;
    setSegment({ kind: 'loading' });
    const entry = await resolveShareSegment().catch(() => null);
    if (flow !== flowRef.current) return;
    setSegment(entry ? { kind: 'ready', entry } : { kind: 'none' });
  }, [resolveShareSegment]);

  const startReview = useCallback(
    (selected: SocialProvider) => {
      flowRef.current += 1;
      const flow = flowRef.current;
      setProvider(selected);
      setCaption('');
      setOutcome(null);
      setPrivacyLevels(null);
      setPrivacyLevel(DEFAULT_PRIVACY_LEVEL[selected]);
      setPhase('publishing');
      void loadSegment();

      getPublishOptions(selected)
        .then((r) => r.privacyLevels)
        .catch(() => [DEFAULT_PRIVACY_LEVEL[selected]])
        .then((levels) => {
          if (flow !== flowRef.current) return;
          const allowed = levels.length > 0 ? levels : [DEFAULT_PRIVACY_LEVEL[selected]];
          setPrivacyLevels(allowed);
          const mostPrivate =
            selected === 'tiktok' ? TIKTOK_PRIVACY_ORDER.find((l) => allowed.includes(l)) ?? allowed[0] : allowed[0];
          setPrivacyLevel(mostPrivate);
        });
    },
    [loadSegment],
  );

  const openFlow = useCallback(() => {
    if (providers.length === 0) return;
    // One destination is chosen exactly once: a single connected account
    // goes straight to its review; several get one picker, whose Continue
    // opens that provider's review directly — never a second picker.
    if (providers.length === 1) startReview(providers[0].provider);
    else {
      flowRef.current += 1;
      setPickSelection(providers[0].provider);
      setPhase('pick');
    }
  }, [providers, startReview]);

  // Manual Share button.
  const lastOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === lastOpenRequest.current) return;
    lastOpenRequest.current = openRequest;
    promptShownRef.current = true; // the manual path supersedes the auto prompt
    openFlow();
  }, [openRequest, openFlow]);

  const publish = useCallback(async () => {
    if (!provider || segment.kind !== 'ready') return;
    const flow = flowRef.current;
    const options = { privacyLevel: privacyLevel ?? DEFAULT_PRIVACY_LEVEL[provider], caption, sequence: segment.entry.segment.sequence };
    setPhase('progress');

    let result: Outcome;
    try {
      try {
        result = await postSocialShare(provider, emergencyId, options);
      } catch (error) {
        // The segment's metadata may land a beat after its upload settles.
        if (!(error instanceof ApiError && error.code === 'no_video')) throw error;
        await new Promise((r) => setTimeout(r, NO_VIDEO_RETRY_DELAY_MS));
        result = await postSocialShare(provider, emergencyId, options);
      }
    } catch (error) {
      result = {
        provider,
        status: 'failed',
        error: error instanceof Error && error.message ? error.message : 'Could not share right now.',
      };
    }

    // Reported even if the user cancelled the progress view — the post may
    // have gone through in the background.
    if (result.status !== 'failed') onShared(result as SocialShareResult);
    if (flow !== flowRef.current) return;
    setOutcome(result);
    setPhase('result');
  }, [caption, emergencyId, onShared, privacyLevel, provider, segment]);

  if (phase === 'hidden') return null;

  const label = provider ? PROVIDER_LABELS[provider] : '';
  const handleFor = (p: SocialProvider) => {
    const username = providers.find((c) => c.provider === p)?.providerUsername;
    return username ? `@${username}` : null;
  };

  return (
    <View style={styles.backdrop} testID="social-share-overlay">
      <View style={styles.card}>
        {phase === 'prompt' && (
          <View testID="social-share-prompt">
            <Text style={styles.title}>Share this emergency?</Text>
            <Text style={styles.subtitle}>
              Post your live video to {providers.map((p) => PROVIDER_LABELS[p.provider]).join(' or ')}. Nothing is
              posted unless you choose to.
            </Text>
            <View style={styles.countdownPill}>
              <View style={styles.countdownDot} />
              <Text style={styles.countdownText} testID="social-share-countdown">
                Continuing without sharing in {countdown}…
              </Text>
            </View>
            <PrimaryButton label="Share Emergency" onPress={openFlow} testID="social-share-prompt-share" />
            <QuietButton label="Skip" onPress={close} testID="social-share-prompt-skip" />
          </View>
        )}

        {phase === 'pick' && (
          <View testID="social-share-pick">
            <Text style={styles.title}>Share Emergency Video</Text>
            <Text style={styles.subtitle}>Choose where you want to share this recording.</Text>
            <View style={styles.rows}>
              {providers.map((p) => {
                const selected = pickSelection === p.provider;
                return (
                  <TouchableOpacity
                    key={p.provider}
                    activeOpacity={0.85}
                    style={[styles.providerRow, selected && styles.providerRowSelected]}
                    onPress={() => setPickSelection(p.provider)}
                    testID={`social-share-pick-${p.provider}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${PROVIDER_LABELS[p.provider]}${handleFor(p.provider) ? `, ${handleFor(p.provider)}` : ''}`}
                  >
                    <ProviderIcon provider={p.provider} />
                    <View style={styles.providerCopy}>
                      <Text style={styles.providerName}>{PROVIDER_LABELS[p.provider]}</Text>
                      {handleFor(p.provider) && <Text style={styles.providerHandle}>{handleFor(p.provider)}</Text>}
                    </View>
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            <PrimaryButton
              label="Continue"
              disabled={!pickSelection}
              onPress={() => pickSelection && startReview(pickSelection)}
              testID="social-share-pick-continue"
            />
            <QuietButton label="Cancel" onPress={close} testID="social-share-pick-cancel" />
          </View>
        )}

        {phase === 'publishing' && provider && (
          <View testID="social-share-publishing">
            <View style={styles.headerRow}>
              <ProviderIcon provider={provider} size={40} />
              <View style={styles.providerCopy}>
                <Text style={styles.headerTitle}>Share to {label}</Text>
                {handleFor(provider) && <Text style={styles.providerHandle}>{handleFor(provider)}</Text>}
              </View>
            </View>

            {segment.kind === 'loading' && (
              <View style={styles.previewPlaceholder}>
                <ActivityIndicator color={C.red} />
                <Text style={styles.muted}>Preparing video…</Text>
              </View>
            )}
            {segment.kind === 'ready' && <SegmentPreview uri={segment.entry.localUri} />}
            {segment.kind === 'none' && (
              <View style={styles.previewPlaceholder}>
                <Text style={styles.muted}>No video available yet. Recording continues.</Text>
                <TouchableOpacity onPress={() => void loadSegment()} testID="social-share-retry-video">
                  <Text style={styles.link}>Try again</Text>
                </TouchableOpacity>
              </View>
            )}

            <TextInput
              style={styles.input}
              value={caption}
              onChangeText={setCaption}
              placeholder="Add a caption (optional)"
              placeholderTextColor={C.faint}
              maxLength={2200}
              multiline
              testID="social-share-caption"
            />

            <Text style={styles.sectionLabel}>WHO CAN SEE THIS</Text>
            {provider === 'instagram' ? (
              <>
                <View style={styles.chipRow}>
                  <View style={[styles.chip, styles.chipSelected]}>
                    <Text style={[styles.chipText, styles.chipTextSelected]}>Public</Text>
                  </View>
                </View>
                <Text style={styles.note}>Instagram Reels are always posted publicly.</Text>
              </>
            ) : privacyLevels === null ? (
              <ActivityIndicator color={C.red} style={styles.chipSpinner} />
            ) : (
              <>
                <View style={styles.chipRow}>
                  {TIKTOK_PRIVACY_ORDER.map((level) => {
                    const allowed = privacyLevels.includes(level);
                    const selected = privacyLevel === level;
                    return (
                      <TouchableOpacity
                        key={level}
                        disabled={!allowed}
                        onPress={() => setPrivacyLevel(level)}
                        style={[styles.chip, selected && styles.chipSelected, !allowed && styles.chipDisabled]}
                        testID={`social-share-privacy-${level}`}
                        accessibilityState={{ disabled: !allowed, selected }}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{PRIVACY_LABELS[level]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {!privacyLevels.includes('PUBLIC_TO_EVERYONE') && (
                  <Text style={styles.note}>Public posting isn't available for Bes on TikTok yet.</Text>
                )}
              </>
            )}

            <PrimaryButton
              label={`Share to ${label}`}
              disabled={segment.kind !== 'ready'}
              onPress={() => void publish()}
              testID="social-share-publish"
            />
            <QuietButton label="Cancel" onPress={close} testID="social-share-cancel" />
          </View>
        )}

        {phase === 'progress' && provider && (
          <View testID="social-share-progress">
            <View style={styles.headerRow}>
              <ProviderIcon provider={provider} size={40} />
              <Text style={[styles.headerTitle, styles.providerCopy]}>Sharing to {label}…</Text>
            </View>
            <View style={styles.steps}>
              {['Preparing video', 'Uploading', 'Finalizing'].map((step) => (
                <View key={step} style={styles.stepRow}>
                  <ActivityIndicator size="small" color={C.red} />
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
            <QuietButton label="Back to emergency" onPress={close} testID="social-share-progress-cancel" />
            <Text style={styles.note}>The post may still finish in the background.</Text>
          </View>
        )}

        {phase === 'result' && outcome && (
          <View testID="social-share-result">
            <View style={[styles.resultBadge, outcome.status === 'failed' ? styles.resultBadgeFail : styles.resultBadgeOk]}>
              <Text style={styles.resultBadgeText}>{outcome.status === 'failed' ? '!' : '✓'}</Text>
            </View>
            <Text style={[styles.title, styles.centered]}>
              {outcome.status === 'posted'
                ? 'Shared successfully'
                : outcome.status === 'processing'
                  ? `${label} is still processing`
                  : 'Could not share'}
            </Text>
            <Text style={[styles.subtitle, styles.centered]}>
              {outcome.status === 'failed'
                ? `${outcome.error || 'Please try again later.'} Recording continues.`
                : `${
                    outcome.privacyLevel === 'SELF_ONLY'
                      ? `Posted to your ${label} as visible to you only.`
                      : `Posted to ${label}.`
                  } It may take a moment to appear in the app.`}
            </Text>
            <PrimaryButton label="Return to Emergency" onPress={close} testID="social-share-done" />
            {outcome.status !== 'failed' && (
              <QuietButton
                label={`Open ${label}`}
                onPress={() => Linking.openURL(PROVIDER_HOME_URLS[outcome.provider]).catch(() => {})}
                testID="social-share-view-post"
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const PROVIDER_ICONS: Record<SocialProvider, number> = {
  instagram: require('../../assets/social/instagram.png'),
  tiktok: require('../../assets/social/tiktok.png'),
};

function ProviderIcon({ provider, size = 48 }: { provider: SocialProvider; size?: number }) {
  return (
    <Image
      source={PROVIDER_ICONS[provider]}
      style={{ borderRadius: size * 0.24, height: size, width: size }}
      accessibilityIgnoresInvertColors
    />
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.primaryBtn, disabled && styles.btnDisabled]}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

function QuietButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity activeOpacity={0.7} style={styles.quietBtn} onPress={onPress} testID={testID} accessibilityRole="button">
      <Text style={styles.quietText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Bes emergency palette: near-black translucent surfaces, the same red as
// Call 911 / the REC dot / the countdown, and quiet greys for secondary text.
const C = {
  red: '#ef445b',
  redTint: 'rgba(239,68,91,0.12)',
  card: '#141418', // opaque: any translucency let the live screen's text bleed through
  cardBorder: 'rgba(255,255,255,0.12)',
  row: 'rgba(255,255,255,0.03)',
  rowBorder: 'rgba(255,255,255,0.10)',
  text: '#ffffff',
  sub: '#a1a1aa',
  faint: '#71717a',
  green: '#22c55e',
};

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 20,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  card: {
    backgroundColor: C.card,
    borderColor: C.cardBorder,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 420,
    paddingHorizontal: 22,
    paddingVertical: 24,
    width: '100%',
  },
  title: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.2 },
  subtitle: { color: C.sub, fontSize: 15, lineHeight: 21, marginTop: 6 },
  centered: { textAlign: 'center' },
  muted: { color: C.sub, fontSize: 13, lineHeight: 18, marginTop: 8, textAlign: 'center' },
  note: { color: C.faint, fontSize: 12, lineHeight: 17, marginTop: 8 },
  link: { color: C.red, fontWeight: '800', marginTop: 8 },

  countdownPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: C.redTint,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  countdownDot: { backgroundColor: C.red, borderRadius: 4, height: 8, width: 8 },
  countdownText: { color: '#fca5b1', fontSize: 13, fontWeight: '700' },

  rows: { gap: 12, marginTop: 20 },
  providerRow: {
    alignItems: 'center',
    backgroundColor: C.row,
    borderColor: C.rowBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  providerRowSelected: { borderColor: 'rgba(239,68,91,0.55)' },
  providerCopy: { flex: 1, minWidth: 0 },
  providerName: { color: C.text, fontSize: 17, fontWeight: '700' },
  providerHandle: { color: C.sub, fontSize: 14, marginTop: 2 },
  radio: {
    alignItems: 'center',
    borderColor: '#d4d4d8',
    borderRadius: 13,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  radioSelected: { borderColor: C.red },
  radioDot: { backgroundColor: C.red, borderRadius: 7, height: 14, width: 14 },

  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 16 },
  headerTitle: { color: C.text, fontSize: 19, fontWeight: '800' },

  // Explicit height: aspectRatio alone (with only a maxHeight) gives a
  // centered, childless box zero width, so the video never showed.
  preview: {
    alignSelf: 'center',
    aspectRatio: 9 / 16,
    backgroundColor: '#000',
    borderRadius: 12,
    height: 200,
    marginBottom: 4,
    overflow: 'hidden',
  },
  previewVideo: { height: '100%', width: '100%' },
  previewPlaceholder: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: C.row,
    borderColor: C.rowBorder,
    borderRadius: 12,
    borderWidth: 1,
    height: 120,
    justifyContent: 'center',
    marginBottom: 4,
    padding: 12,
  },
  input: {
    backgroundColor: C.row,
    borderColor: C.rowBorder,
    borderRadius: 12,
    borderWidth: 1,
    color: C.text,
    fontSize: 15,
    marginTop: 14,
    maxHeight: 90,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sectionLabel: { color: C.faint, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8, marginTop: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipSpinner: { alignSelf: 'flex-start' },
  chip: {
    borderColor: C.rowBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipSelected: { backgroundColor: C.redTint, borderColor: C.red },
  chipDisabled: { opacity: 0.35 },
  chipText: { color: '#d4d4d8', fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: C.text },

  steps: { gap: 14, marginBottom: 6, marginTop: 4 },
  stepRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  stepText: { color: C.text, fontSize: 15 },

  resultBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 28,
    borderWidth: 2,
    height: 56,
    justifyContent: 'center',
    marginBottom: 14,
    width: 56,
  },
  resultBadgeOk: { backgroundColor: 'rgba(34,197,94,0.12)', borderColor: C.green },
  resultBadgeFail: { backgroundColor: C.redTint, borderColor: C.red },
  resultBadgeText: { color: C.text, fontSize: 26, fontWeight: '900' },

  primaryBtn: {
    alignItems: 'center',
    backgroundColor: C.red,
    borderRadius: 14,
    marginTop: 22,
    paddingVertical: 15,
  },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  btnDisabled: { opacity: 0.4 },
  quietBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 12 },
  quietText: { color: C.sub, fontSize: 16, fontWeight: '600' },
});
