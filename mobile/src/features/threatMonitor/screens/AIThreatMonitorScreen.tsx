import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useCameraPermissions } from 'expo-camera';

import PermissionCard from '../../../components/PermissionCard';
import CrowdMetricsPanel from '../components/CrowdMetricsPanel';
import DetectionOverlay from '../components/DetectionOverlay';
import MonitorControls from '../components/MonitorControls';
import ThreatDashboard from '../components/ThreatDashboard';
import { isAiMonitorEnabled } from '../config/threatMonitorConfig';
import { useThreatMonitor } from '../hooks/useThreatMonitor';
import { claimForEmergency } from '../services/CameraOwnershipService';
import { BesVisionView } from '../services/besVision';
import { runDetectionHarness } from '../services/detectionHarness';

const STATUS_LABEL = {
  idle: 'Off',
  starting: 'Starting…',
  running: 'Monitoring',
  paused: 'Paused',
  error: 'Stopped',
} as const;

// AI Monitor (beta): live on-device people detection, plus (in AI
// development/test builds only) the threat dashboard. It only observes and
// advises — nothing here triggers Emergency, calls or alerts anyone.
export default function AIThreatMonitorScreen() {
  // The screen is registered in every build; without the rollout flag it
  // never touches the camera, even if something navigates here directly.
  if (!isAiMonitorEnabled()) return <MonitorUnavailable />;
  return <AIMonitor />;
}

function MonitorUnavailable() {
  const navigation = useNavigation<any>();
  return (
    <SafeAreaView style={styles.safe} testID="ai-monitor-unavailable">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} testID="ai-monitor-back-btn">
          <Text style={styles.headerButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>AI Monitor</Text>
      </View>
      <Text style={styles.unavailable}>AI Monitor isn’t available in this version of Bes.</Text>
    </SafeAreaView>
  );
}

function AIMonitor() {
  const navigation = useNavigation<any>();
  const [permission, requestPermission] = useCameraPermissions();
  const monitor = useThreatMonitor();
  const [sosBusy, setSosBusy] = useState(false);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });

  const granted = permission?.granted === true;

  // Release the camera first, then hand over to Emergency's countdown.
  const onSos = async () => {
    if (sosBusy) return;
    setSosBusy(true);
    try {
      await claimForEmergency();
    } finally {
      setSosBusy(false);
      navigation.navigate('Emergency');
    }
  };

  const onStart = async () => {
    if (!granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    monitor.start();
  };

  return (
    <SafeAreaView style={styles.safe} testID="ai-monitor-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} testID="ai-monitor-back-btn">
          <Text style={styles.headerButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>AI Monitor</Text>
        {/* Long-press runs the validation harness on pushed test images. */}
        <TouchableOpacity style={styles.beta} onLongPress={() => void runDetectionHarness()} testID="ai-monitor-beta">
          <Text style={styles.betaText}>Beta</Text>
        </TouchableOpacity>
      </View>

      <View
        style={styles.cameraBox}
        testID="ai-monitor-camera-box"
        onLayout={(e) => setViewSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {BesVisionView && (
          <BesVisionView style={StyleSheet.absoluteFill} testID="ai-monitor-camera" {...monitor.cameraProps} />
        )}
        {monitor.status === 'running' && monitor.frame && (
          <DetectionOverlay people={monitor.frame.detections} frameSize={monitor.frameSize} viewSize={viewSize} />
        )}
        {!monitor.cameraProps.active && (
          <View style={styles.cameraIdle}>
            <Text style={styles.idleText}>Camera is off</Text>
          </View>
        )}
        <View style={styles.statusChip} testID="ai-monitor-status" accessibilityLabel={`ai-monitor-status-${monitor.status}`}>
          <View style={[styles.dot, monitor.status === 'running' && styles.dotOn]} />
          <Text style={styles.statusText}>{STATUS_LABEL[monitor.status]}</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} testID="ai-monitor-scroll">
        <CrowdMetricsPanel frame={monitor.status === 'running' ? monitor.frame : null} />

        {monitor.message && (
          <Text style={styles.message} testID="ai-monitor-message">
            {monitor.message}
          </Text>
        )}

        {!granted && permission && (
          <>
            <PermissionCard
              icon="📷"
              title="Camera"
              description="AI Monitor needs the camera to see people around you."
              granted={false}
              onRequest={() => {
                if (permission.canAskAgain) void requestPermission();
                else void Linking.openSettings();
              }}
            />
            {!permission.canAskAgain && (
              <TouchableOpacity onPress={() => Linking.openSettings()} testID="ai-monitor-open-settings">
                <Text style={styles.link}>Camera access is off. Open Settings to allow it.</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Controls and SOS sit above the dashboard: never pushed down by events. */}
        <MonitorControls
          status={monitor.status}
          onStart={onStart}
          onPause={monitor.pause}
          onResume={monitor.resume}
          onStop={() => monitor.stop('user')}
        />

        <TouchableOpacity
          style={[styles.sos, sosBusy && styles.disabled]}
          onPress={onSos}
          disabled={sosBusy}
          testID="ai-monitor-sos-btn"
          accessibilityLabel="ai-monitor-sos-btn"
        >
          <Text style={styles.sosText}>SOS — Emergency</Text>
        </TouchableOpacity>

        {/* Threat dashboard: AI development/test builds only. Without the
            threat flag the screen stays the Phase 1 people monitor. */}
        {monitor.threatsEnabled && (
          <ThreatDashboard
            threatsEnabled
            detection={monitor.detection}
            detectors={monitor.detectors}
            events={monitor.events}
            reliability={monitor.status === 'running' ? monitor.assessment?.sourceReliability ?? null : null}
            onClearEvents={monitor.clearEvents}
          />
        )}

        {monitor.testHooks && (
          <View style={styles.testTools} testID="ai-test-tools">
            <Text style={styles.testTitle}>Test build tools</Text>
            {(
              [
                ['ai-test-replay-fall', 'Replay fall clip', () => monitor.testHooks?.replay('fall-forward')],
                ['ai-test-replay-panic', 'Replay crowd panic clip', () => monitor.testHooks?.replay('panic-flee-one-way')],
                ['ai-test-fail-analysis', 'Simulate analysis failure', () => monitor.testHooks?.failAnalysis()],
              ] as const
            ).map(([id, label, onPress]) => (
              <TouchableOpacity key={id} onPress={onPress} testID={id} accessibilityLabel={id} style={styles.testBtn}>
                <Text style={styles.testBtnText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.privacy} testID="ai-monitor-privacy-note">
          Processed on this phone. Nothing is recorded or uploaded.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#050715' },
  header: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8 },
  headerButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  headerButtonText: { color: '#fff', fontSize: 28, fontWeight: '500' },
  title: { color: '#fff', flex: 1, fontSize: 19, fontWeight: '900' },
  beta: { backgroundColor: 'rgba(122,87,214,0.25)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  betaText: { color: '#c9b8ff', fontSize: 12, fontWeight: '800' },
  cameraBox: {
    backgroundColor: '#000',
    borderRadius: 20,
    height: 280,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  cameraIdle: { backgroundColor: '#000', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
  idleText: { color: '#8e88a8', fontSize: 15, fontWeight: '700' },
  statusChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 6,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: 'absolute',
    top: 12,
  },
  dot: { backgroundColor: '#8e88a8', borderRadius: 4, height: 8, width: 8 },
  dotOn: { backgroundColor: '#34d399' },
  statusText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  scroll: { flex: 1 },
  body: { gap: 12, padding: 16, paddingBottom: 32 },
  message: { color: '#fbbf24', fontSize: 14, fontWeight: '700' },
  link: { color: '#c9b8ff', fontSize: 14, fontWeight: '700' },
  sos: { alignItems: 'center', backgroundColor: '#ef445b', borderRadius: 14, paddingVertical: 14 },
  sosText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  disabled: { opacity: 0.6 },
  privacy: { color: '#a8a0bf', fontSize: 13, textAlign: 'center' },
  testTools: { borderColor: 'rgba(255,255,255,0.15)', borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, gap: 6, padding: 10 },
  testTitle: { color: '#8e88a8', fontSize: 12, fontWeight: '800' },
  testBtn: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  testBtnText: { color: '#c9b8ff', fontSize: 13, fontWeight: '800' },
  unavailable: { color: '#a8a0bf', fontSize: 15, fontWeight: '700', padding: 24, textAlign: 'center' },
});
