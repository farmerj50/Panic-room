import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePinLock } from '../context/PinLockContext';

export const DECOY_ENABLED_KEY = 'panicroom_decoy_enabled';

export default function DecoySettingsScreen() {
  const navigation = useNavigation<any>();
  const { hasPin } = usePinLock();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(DECOY_ENABLED_KEY).then((value) => {
      setEnabled(value === 'true');
      setLoaded(true);
    });
  }, []);

  const toggle = async (value: boolean) => {
    setEnabled(value);
    await AsyncStorage.setItem(DECOY_ENABLED_KEY, value ? 'true' : 'false');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity activeOpacity={0.82} onPress={() => navigation.goBack()} style={styles.iconButton}>
          <Text style={styles.iconButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Decoy Mode</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.scroll}>
        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>Enable Decoy Mode</Text>
              <Text style={styles.rowDesc}>
                Shows a calculator instead of Bes when triggered. Bes keeps running underneath.
              </Text>
            </View>
            {loaded && (
              <Switch
                value={enabled}
                onValueChange={toggle}
                trackColor={{ false: 'rgba(255,255,255,0.12)', true: 'rgba(147,76,255,0.7)' }}
                thumbColor={enabled ? '#d4abff' : '#6b6388'}
                ios_backgroundColor="rgba(255,255,255,0.12)"
                testID="decoy-enabled-switch"
              />
            )}
          </View>
        </LinearGradient>

        {enabled && !hasPin && (
          <LinearGradient colors={['rgba(78, 12, 25, 0.42)', 'rgba(13, 18, 49, 0.97)']} style={[styles.card, styles.nudgeCard]}>
            <Text style={styles.nudgeText}>
              You don't have a PIN set, so anyone can exit the decoy. Set a PIN in App Lock for a secure exit.
            </Text>
          </LinearGradient>
        )}

        <LinearGradient colors={['rgba(13, 18, 49, 0.97)', 'rgba(10, 12, 38, 0.97)']} style={styles.card}>
          <Text style={styles.helpTitle}>How to use it</Text>
          <Text style={styles.helpText}>
            Long-press the "Profile" title at the top of your Profile screen to open the decoy.{'\n\n'}
            To get back to Bes, long-press the calculator's display{hasPin ? ' and enter your PIN' : ''}.
          </Text>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    marginBottom: 6,
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
  title: { color: '#fff', fontSize: 20, fontWeight: '900' },
  scroll: { padding: 18, gap: 16, maxWidth: 520, width: '100%', alignSelf: 'center' },
  card: {
    borderColor: 'rgba(149, 110, 255, 0.24)',
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  nudgeCard: { borderColor: 'rgba(239,68,91,0.42)' },
  nudgeText: { color: '#ffb8c2', fontSize: 13, lineHeight: 19 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  rowCopy: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  rowDesc: { color: '#a9a1bd', fontSize: 13, lineHeight: 19 },
  helpTitle: { color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  helpText: { color: '#a9a1bd', fontSize: 13, lineHeight: 20 },
});
