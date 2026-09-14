import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import GooglePlayBadge from './GooglePlayBadge';

type Props = { placement: 'hero' | 'footer'; style?: StyleProp<ViewStyle> };

// Web-only: native installs already have the app, so this renders nothing
// there rather than showing a visitor their own already-installed app.
// A future AppStoreBadge slots in beside GooglePlayBadge here once iOS
// ships — no iOS scaffolding exists yet.
export default function StoreBadges({ placement, style }: Props) {
  if (Platform.OS !== 'web') return null;

  return (
    <View style={[styles.row, style]}>
      <GooglePlayBadge placement={placement} />
      <Text style={styles.note}>Available now on Android</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  note: { color: '#d8cdef', fontSize: 13, fontWeight: '600' },
});
