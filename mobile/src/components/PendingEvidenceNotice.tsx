import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  discardUnuploadedClips,
  getClipQueueSummary,
  resumeClipQueue,
  subscribeToClipQueue,
  type QueueSummary,
} from '../services/segmentQueue';
import { formatMegabytes } from '../services/storageMonitor';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Emergency recordings still on this phone (not yet uploaded). They are
// never deleted automatically — only with the explicit, confirmed action here.
export default function PendingEvidenceNotice() {
  const [summary, setSummary] = useState<QueueSummary | null>(null);

  const refresh = useCallback(() => {
    getClipQueueSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    return subscribeToClipQueue(refresh);
  }, [refresh]);

  if (!summary) return null;
  const unsent = summary.waiting + summary.conflict;
  if (unsent === 0 && summary.lost === 0) return null;

  const confirmDiscard = () => {
    Alert.alert(
      `Delete ${plural(unsent + summary.lost, 'clip')} that were never uploaded?`,
      'These recordings exist only on this phone. Deleting them cannot be undone.',
      [
        { text: 'Keep them', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void discardUnuploadedClips().then(refresh); } },
      ],
    );
  };

  return (
    <View style={styles.card} testID="pending-evidence-notice" accessible accessibilityLabel="pending-evidence-notice">
      {unsent > 0 && (
        <Text style={styles.text}>
          {plural(unsent, 'recording')} waiting to upload ({formatMegabytes(summary.bytes)}). They stay on this phone until
          they're uploaded.
        </Text>
      )}
      {summary.conflict > 0 && (
        <Text style={styles.muted}>{plural(summary.conflict, 'recording')} couldn't be matched to its emergency and is kept here.</Text>
      )}
      {summary.lost > 0 && (
        <Text style={styles.muted}>{plural(summary.lost, 'recording')} could not be recovered after the app closed unexpectedly.</Text>
      )}
      <View style={styles.actions}>
        {summary.waiting > 0 && (
          <TouchableOpacity onPress={() => { void resumeClipQueue().then(refresh); }} testID="pending-evidence-retry-btn">
            <Text style={styles.action}>Upload now</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={confirmDiscard} testID="pending-evidence-delete-btn">
          <Text style={styles.danger}>Delete unsent recordings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(251,191,36,0.10)',
    borderColor: 'rgba(251,191,36,0.5)',
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 14,
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600' },
  muted: { color: '#c9c3d9', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 4 },
  action: { color: '#fbbf24', fontSize: 13, fontWeight: '800' },
  danger: { color: '#f87171', fontSize: 13, fontWeight: '700' },
});
