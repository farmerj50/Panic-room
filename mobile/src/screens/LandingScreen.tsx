import {
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { UnauthStackParamList } from '../navigation/types';
import heroBg from '../../assets/images/hero-bg.png';

type Nav = NativeStackNavigationProp<UnauthStackParamList, 'Landing'>;

export default function LandingScreen() {
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const isWide = width >= 760;

  return (
    <SafeAreaView style={styles.safe}>
      <ImageBackground source={heroBg} resizeMode="cover" imageStyle={styles.heroImage} style={styles.hero}>
        <LinearGradient
          colors={['rgba(5,7,24,0.98)', 'rgba(15,17,50,0.86)', 'rgba(18,14,46,0.32)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.layout, !isWide && styles.layoutNarrow]}>
          <Text style={styles.brand} testID="landing-brand">PanicRoom</Text>
          <Text style={styles.title}>Private access for your safety data.</Text>
          <Text style={styles.text}>
            Create an account, add a trusted contact, and prepare emergency access in one setup flow.
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => navigation.navigate('Auth', { mode: 'register' })}
              style={styles.primaryButton}
              testID="landing-create-account-btn"
              accessibilityLabel="landing-create-account-btn"
            >
              <Text style={styles.primaryText}>Create Account</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => navigation.navigate('Auth', { mode: 'login' })}
              style={styles.secondaryButton}
              testID="landing-sign-in-btn"
              accessibilityLabel="landing-sign-in-btn"
            >
              <Text style={styles.secondaryText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#050715', flex: 1 },
  hero: { flex: 1, overflow: 'hidden' },
  heroImage: {},
  layout: {
    flex: 1,
    justifyContent: 'center',
    maxWidth: 640,
    padding: 34,
  },
  layoutNarrow: {
    justifyContent: 'center',
    padding: 22,
  },
  brand: { color: '#d9bcff', fontSize: 18, fontWeight: '900', marginBottom: 14 },
  title: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '900',
    lineHeight: 48,
    marginBottom: 16,
  },
  text: { color: '#e8e1f5', fontSize: 17, lineHeight: 26 },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 28,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#ef445b',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 20,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(217, 188, 255, 0.42)',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 20,
  },
  primaryText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondaryText: { color: '#d9bcff', fontSize: 14, fontWeight: '900' },
});
