import { StyleSheet, Switch, Text, View } from 'react-native';

// Extracted from EmergencySettingsScreen.tsx (where it originated as a
// private component) so LinkedAccountsScreen's permissions panel can reuse
// the same toggle-row look instead of inventing a new one.
export default function SettingRow({
  title, description, value, onToggle, loading, platform,
}: {
  title: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  loading?: boolean;
  platform?: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <View style={styles.settingTitleRow}>
          <Text style={styles.settingTitle}>{title}</Text>
          {platform && <Text style={styles.platformBadge}>{platform}</Text>}
        </View>
        <Text style={styles.settingDesc}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={loading ? undefined : onToggle}
        disabled={loading}
        trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(147,76,255,0.7)' }}
        thumbColor={value ? '#d4abff' : '#6b6388'}
        ios_backgroundColor="rgba(255,255,255,0.12)"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  settingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  settingCopy: { flex: 1 },
  settingTitleRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 5 },
  settingTitle: { color: '#f0ecfb', fontSize: 14, fontWeight: '800' },
  platformBadge: {
    backgroundColor: 'rgba(90,78,148,0.28)',
    borderRadius: 8,
    color: '#9b91bb',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  settingDesc: { color: '#8b84aa', fontSize: 12, lineHeight: 18 },
});
