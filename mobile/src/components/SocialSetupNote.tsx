import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type SocialSetupState = 'not_connected' | 'premium_required' | 'reconnect_needed';

const COPY: Record<SocialSetupState, string> = {
  not_connected: "Social sharing isn't set up — recording continues.",
  premium_required: 'Sharing to TikTok or Instagram is a Premium feature — recording continues.',
  reconnect_needed: 'Reconnect TikTok or Instagram in Settings to share — recording continues.',
};

// A quiet, inline note at the bottom of the emergency screen (never an
// overlay, no countdown, never takes focus) — so it can't cover the camera,
// recording status or emergency controls, or slow anything down.
export default function SocialSetupNote({
  state,
  onRemind,
  onDismiss,
}: {
  state: SocialSetupState;
  onRemind: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.note} testID="emergency-social-setup-note" accessibilityLabel="emergency-social-setup-note">
      <Text style={styles.text}>{COPY[state]}</Text>
      <TouchableOpacity onPress={onRemind} testID="emergency-social-setup-remind">
        <Text style={styles.action}>Remind me after</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        testID="emergency-social-setup-dismiss"
        accessibilityLabel="Dismiss"
      >
        <Text style={styles.close}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    maxWidth: 620,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  text: { color: '#a8a0bf', flex: 1, fontSize: 12, fontWeight: '600' },
  action: { color: '#f472b6', fontSize: 12, fontWeight: '800' },
  close: { color: '#a8a0bf', fontSize: 18, fontWeight: '700', lineHeight: 18 },
});
