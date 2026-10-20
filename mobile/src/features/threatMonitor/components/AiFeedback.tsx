import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import type { ThreatEvent } from '../threat/events/ThreatEventLog';
import {
  addFeedback,
  clearFeedback,
  feedbackExport,
  feedbackForEvent,
  getFeedbackOptIn,
  listFeedback,
  setFeedbackOptIn,
  type FeedbackType,
} from '../threat/feedback/feedbackStore';
import { THREAT_LABEL } from '../threat/presentation';

const TYPES: FeedbackType[] = ['fall', 'crowd_panic', 'sudden_dispersal', 'crowd_surge', 'physical_confrontation', 'assault', 'other'];
const typeLabel = (t: FeedbackType) => (t === 'other' ? 'Something else' : THREAT_LABEL[t].replace(/^Possible /, '').replace(/^./, (c) => c.toUpperCase()));

// Opt-in state shared by the controls below.
export function useAiFeedback() {
  const [optedIn, setOptedIn] = useState(false);
  const [count, setCount] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    setOptedIn(await getFeedbackOptIn());
    setCount((await listFeedback()).length);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const toggle = useCallback(
    async (on: boolean) => {
      await setFeedbackOptIn(on);
      await refresh();
    },
    [refresh],
  );
  const answer = useCallback(
    async (event: ThreatEvent, kind: 'confirmed' | 'wrong_type' | 'false_warning', corrected?: FeedbackType) => {
      const saved = await addFeedback(feedbackForEvent(event, kind, corrected));
      if (saved) {
        setAnswers((a) => ({ ...a, [event.id]: kind === 'wrong_type' && corrected ? `Marked as: ${typeLabel(corrected)}` : kind === 'confirmed' ? 'Marked as correct' : 'Marked as a false warning' }));
        await refresh();
      }
    },
    [refresh],
  );
  const reportMissed = useCallback(
    async (type: FeedbackType, when: 'just_now' | 'last_5_min' | 'earlier') => {
      const saved = await addFeedback({ kind: 'missed', correctedType: type, missedWhen: when });
      await refresh();
      return saved != null;
    },
    [refresh],
  );
  return { optedIn, count, answers, toggle, answer, reportMissed, refresh };
}

export type AiFeedback = ReturnType<typeof useAiFeedback>;

// Settings row: opt in, see what's stored, share or delete it.
export function FeedbackSettings({ feedback }: { feedback: AiFeedback }) {
  return (
    <View style={styles.box} testID="ai-feedback-settings">
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text style={styles.title}>Help improve AI Monitor</Text>
          <Text style={styles.muted}>
            Lets you mark events as right or wrong and report missed ones. Saved on this phone only — no video, images or location. It never changes how
            detection works on its own.
          </Text>
        </View>
        <Switch value={feedback.optedIn} onValueChange={(v) => void feedback.toggle(v)} testID="ai-feedback-optin" accessibilityLabel={`ai-feedback-optin-${feedback.optedIn ? 'on' : 'off'}`} />
      </View>
      {feedback.count > 0 && (
        <View style={styles.row}>
          <Text style={[styles.muted, styles.flex]} testID="ai-feedback-count">
            {feedback.count} feedback {feedback.count === 1 ? 'note' : 'notes'} saved on this phone
          </Text>
          <TouchableOpacity onPress={async () => void Share.share({ message: feedbackExport(await listFeedback()) })} testID="ai-feedback-share">
            <Text style={styles.link}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              await clearFeedback();
              await feedback.refresh();
            }}
            testID="ai-feedback-delete"
          >
            <Text style={styles.link}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// On an event card, only when opted in.
export function EventFeedback({ event, feedback }: { event: ThreatEvent; feedback: AiFeedback }) {
  const [picking, setPicking] = useState(false);
  if (!feedback.optedIn) return null;
  const done = feedback.answers[event.id];
  if (done) {
    return (
      <Text style={styles.thanks} testID="ai-feedback-done">
        {done}. Thank you.
      </Text>
    );
  }
  if (picking) {
    return (
      <View style={styles.chips} testID="ai-feedback-pick-type">
        <Text style={styles.muted}>What was it?</Text>
        {TYPES.filter((t) => t !== event.type).map((t) => (
          <TouchableOpacity key={t} style={styles.chip} onPress={() => void feedback.answer(event, 'wrong_type', t)} testID={`ai-feedback-type-${t}`}>
            <Text style={styles.chipText}>{typeLabel(t)}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity onPress={() => setPicking(false)}>
          <Text style={styles.link}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <View style={styles.chips} testID="ai-feedback-buttons">
      <Text style={styles.muted}>Was this right?</Text>
      <TouchableOpacity style={styles.chip} onPress={() => void feedback.answer(event, 'confirmed')} testID="ai-feedback-correct">
        <Text style={styles.chipText}>Correct</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.chip} onPress={() => setPicking(true)} testID="ai-feedback-wrong-type">
        <Text style={styles.chipText}>Wrong type</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.chip} onPress={() => void feedback.answer(event, 'false_warning')} testID="ai-feedback-false">
        <Text style={styles.chipText}>False warning</Text>
      </TouchableOpacity>
    </View>
  );
}

// "Report a missed event", only when opted in.
export function MissedEventReport({ feedback }: { feedback: AiFeedback }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType | null>(null);
  const [sent, setSent] = useState(false);
  if (!feedback.optedIn) return null;
  if (sent) {
    return (
      <Text style={styles.thanks} testID="ai-feedback-missed-done">
        Missed event noted. Thank you.
      </Text>
    );
  }
  if (!open) {
    return (
      <TouchableOpacity onPress={() => setOpen(true)} testID="ai-feedback-missed-open">
        <Text style={styles.link}>Report a missed event</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.box} testID="ai-feedback-missed">
      <Text style={styles.title}>What did Bes miss?</Text>
      <View style={styles.chips}>
        {TYPES.map((t) => (
          <TouchableOpacity key={t} style={[styles.chip, type === t && styles.chipOn]} onPress={() => setType(t)} testID={`ai-feedback-missed-type-${t}`}>
            <Text style={styles.chipText}>{typeLabel(t)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {type && (
        <View style={styles.chips}>
          <Text style={styles.muted}>When?</Text>
          {(
            [
              ['just_now', 'Just now'],
              ['last_5_min', 'In the last 5 minutes'],
              ['earlier', 'Earlier'],
            ] as const
          ).map(([when, label]) => (
            <TouchableOpacity
              key={when}
              style={styles.chip}
              onPress={async () => {
                if (await feedback.reportMissed(type, when)) setSent(true);
              }}
              testID={`ai-feedback-missed-when-${when}`}
            >
              <Text style={styles.chipText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TouchableOpacity onPress={() => setOpen(false)}>
        <Text style={styles.link}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, borderWidth: 1, gap: 8, padding: 10 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  title: { color: '#fff', fontSize: 14, fontWeight: '900' },
  muted: { color: '#a8a0bf', fontSize: 12, fontWeight: '600' },
  link: { color: '#c9b8ff', fontSize: 13, fontWeight: '800' },
  chips: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: 'rgba(122,87,214,0.45)' },
  chipText: { color: '#e6e1f5', fontSize: 12, fontWeight: '800' },
  thanks: { color: '#34d399', fontSize: 12, fontWeight: '800', marginTop: 4 },
});
