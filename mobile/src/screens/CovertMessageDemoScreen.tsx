import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { useTourTarget } from '../context/TourContext';

// Read-only example. Imports nothing from covert-messaging, crypto, network,
// or subscription code, so it can't encrypt, send, or open the paywall.
export default function CovertMessageDemoScreen() {
  const navigation = useNavigation<any>();
  const bubbleRef = useTourTarget<View>('covert-demo-bubble');

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} activeOpacity={0.8}>
          <Text style={styles.backText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>How Covert Messaging looks</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.intro}>
          A covert message hides your words inside an ordinary-looking image, so the message itself
          doesn’t stand out. This is an example only.
        </Text>

        <View ref={bubbleRef} style={styles.bubble}>
          <Text style={styles.bubbleLabel}>Example</Text>
          <Text style={styles.bubbleText}>Hey, are we still on for Saturday? Call me when you can.</Text>
          <Text style={styles.bubbleHint}>Shown as an ordinary message. The hidden text stays inside the image.</Text>
        </View>

        <Text style={styles.note}>Nothing is sent, encrypted, or purchased on this screen.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  back: { padding: 8 },
  backText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', flexShrink: 1 },
  body: { padding: 16, gap: 16 },
  intro: { color: '#d8d2e8', fontSize: 14, lineHeight: 21 },
  bubble: {
    backgroundColor: '#0d1231',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(199,140,255,0.4)',
    padding: 18,
    gap: 8,
  },
  bubbleLabel: { color: '#9e8fc2', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 22 },
  bubbleHint: { color: '#9e8fc2', fontSize: 12, marginTop: 4 },
  note: { color: '#9e8fc2', fontSize: 12 },
});
