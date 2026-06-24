import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getEmergencies } from '../services/emergencyService';
import { Emergency } from '../types/Emergency';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function EvidenceScreen() {
  const navigation = useNavigation();
  const [events, setEvents] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEmergencies()
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Evidence</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#7C3AED" style={{ marginTop: 40 }} />
      ) : events.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📁</Text>
          <Text style={styles.emptyText}>No events recorded yet</Text>
          <Text style={styles.emptySubText}>Emergency events will appear here</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {events.map((ev) => (
            <View key={ev.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.statusDot, ev.status === 'ACTIVE' ? styles.active : styles.resolved]} />
                <Text style={styles.statusText}>{ev.status}</Text>
                <Text style={styles.dateText}>{fmtDate(ev.createdAt)}</Text>
              </View>

              {ev.latitude != null && (
                <TouchableOpacity
                  onPress={() =>
                    Linking.openURL(`https://maps.google.com/?q=${ev.latitude},${ev.longitude}`)
                  }
                >
                  <Text style={styles.location}>
                    📍 {ev.latitude?.toFixed(5)}, {ev.longitude?.toFixed(5)}
                  </Text>
                </TouchableOpacity>
              )}

              <View style={styles.media}>
                {ev.videoUrl ? (
                  <TouchableOpacity onPress={() => Linking.openURL(ev.videoUrl!)}>
                    <Text style={styles.mediaLink}>🎥 View Video</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.mediaNone}>No video</Text>
                )}
                {ev.audioUrl ? (
                  <TouchableOpacity onPress={() => Linking.openURL(ev.audioUrl!)}>
                    <Text style={styles.mediaLink}>🎙️ Play Audio</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.mediaNone}>No audio</Text>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D1117' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#fff', fontSize: 24 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  scroll: { padding: 16, paddingBottom: 40 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { fontSize: 56 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 16 },
  emptySubText: { color: '#888', fontSize: 13, marginTop: 6 },
  card: {
    backgroundColor: '#1e2235',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  active: { backgroundColor: '#e74c3c' },
  resolved: { backgroundColor: '#10B981' },
  statusText: { color: '#fff', fontWeight: '700', fontSize: 13, flex: 1 },
  dateText: { color: '#666', fontSize: 12 },
  location: { color: '#4ECDC4', fontSize: 13, marginBottom: 10 },
  media: { flexDirection: 'row', gap: 16 },
  mediaLink: { color: '#a29bfe', fontSize: 13, fontWeight: '600' },
  mediaNone: { color: '#555', fontSize: 13 },
});
