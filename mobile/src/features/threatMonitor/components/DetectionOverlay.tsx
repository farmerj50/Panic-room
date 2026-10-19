import { StyleSheet, Text, View } from 'react-native';

import type { TrackedPerson } from '../models/types';
import { mapBoxToView } from '../services/overlayGeometry';
import { PROXIMITY_LABEL, PROXIMITY_SYMBOL, type PersonProximity } from '../services/ProximityEstimator';

type Props = {
  people: TrackedPerson[];
  frameSize: { width: number; height: number } | null;
  viewSize: { width: number; height: number };
  mirrored?: boolean;
  // Per-person getting closer / moving away, when that feature is on.
  proximity?: Map<number, PersonProximity> | null;
};

// Boxes and temporary track numbers over the live preview. Display only.
export default function DetectionOverlay({ people, frameSize, viewSize, mirrored, proximity }: Props) {
  if (!frameSize) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="ai-monitor-overlay">
      {people.map((p) => {
        const rect = mapBoxToView(p.boundingBox, frameSize, viewSize, { mirrored });
        if (!rect) return null;
        const fast = p.motion.suddenChange;
        const state = proximity?.get(p.trackId)?.state;
        return (
          <View
            key={p.trackId}
            style={[styles.box, fast && styles.boxFast, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }]}
            testID={`ai-monitor-box-${p.trackId}`}
          >
            <Text style={[styles.label, fast && styles.labelFast]}>#{p.trackId}</Text>
            {state && (
              <Text
                style={[styles.chip, state === 'APPROACHING' && styles.chipCloser]}
                numberOfLines={1}
                testID={`ai-monitor-proximity-${p.trackId}`}
                accessibilityLabel={`ai-monitor-proximity-${p.trackId}-${state}`}
              >
                {PROXIMITY_SYMBOL[state]} {PROXIMITY_LABEL[state]}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderColor: '#34d399', borderRadius: 6, borderWidth: 2, position: 'absolute' },
  boxFast: { borderColor: '#fbbf24' },
  label: {
    backgroundColor: '#34d399',
    borderRadius: 4,
    color: '#04140d',
    fontSize: 11,
    fontWeight: '900',
    left: -2,
    overflow: 'hidden',
    paddingHorizontal: 4,
    position: 'absolute',
    top: -2,
  },
  labelFast: { backgroundColor: '#fbbf24' },
  chip: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    left: -2,
    overflow: 'hidden',
    paddingHorizontal: 4,
    position: 'absolute',
    top: 16,
  },
  chipCloser: { color: '#fbbf24' },
});
