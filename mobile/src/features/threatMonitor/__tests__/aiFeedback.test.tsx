import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import ThreatDashboard from '../components/ThreatDashboard';
import type { DetectionState, DetectorStatus } from '../threat/events/detectionState';
import type { ThreatEvent } from '../threat/events/ThreatEventLog';
import { addFeedback, feedbackExport, getFeedbackOptIn, listFeedback, setFeedbackOptIn } from '../threat/feedback/feedbackStore';
import { FROZEN_FINGERPRINT, thresholdFingerprint } from '../threat/validation/frozen';

const event = (id: string, type: ThreatEvent['type'] = 'fall'): ThreatEvent => ({
  id,
  type,
  sessionId: 's1',
  trackIds: [1],
  status: 'ongoing',
  severity: 'high',
  evidence: 'strong',
  calibrated: false,
  firstSeenAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_002_000,
  repeats: 0,
  indicators: [{ id: 'fall-fast', label: 'Went from upright to lying in 0.6 s', weight: 0.6 }],
  recommendedActions: ['Check whether the person needs help, if it is safe'],
  candidateIds: ['c1'],
});
const detection: DetectionState = { kind: 'candidates', title: 'Possible threat seen', detail: '' };
const detectors: DetectorStatus[] = [];

function renderDashboard(events: ThreatEvent[]) {
  return render(<ThreatDashboard threatsEnabled detection={detection} detectors={detectors} events={events} reliability={null} onClearEvents={() => {}} />);
}

describe('AI feedback', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is off by default and saves nothing until the user opts in', async () => {
    expect(await getFeedbackOptIn()).toBe(false);
    expect(await addFeedback({ kind: 'false_warning', eventType: 'fall' })).toBeNull();
    expect(await listFeedback()).toEqual([]);
    renderDashboard([event('e1')]);
    await waitFor(() => expect(screen.getByLabelText('ai-feedback-optin-off')).toBeTruthy());
    expect(screen.queryByTestId('ai-feedback-buttons')).toBeNull();
    expect(screen.queryByTestId('ai-feedback-missed-open')).toBeNull();
  });

  it('after opting in, confirms, corrects the type, and flags false warnings', async () => {
    renderDashboard([event('e1'), event('e2', 'crowd_panic'), event('e3', 'crowd_surge')]);
    await act(async () => {
      fireEvent(screen.getByTestId('ai-feedback-optin'), 'valueChange', true);
    });
    await waitFor(() => expect(screen.getAllByTestId('ai-feedback-buttons')).toHaveLength(3));

    await act(async () => fireEvent.press(screen.getAllByTestId('ai-feedback-correct')[0]));
    await act(async () => fireEvent.press(screen.getAllByTestId('ai-feedback-wrong-type')[0]));
    await act(async () => fireEvent.press(screen.getByTestId('ai-feedback-type-other')));
    await act(async () => fireEvent.press(screen.getAllByTestId('ai-feedback-false')[0]));

    await waitFor(() => expect(screen.getAllByTestId('ai-feedback-done')).toHaveLength(3));
    const saved = await listFeedback();
    expect(saved.map((f) => [f.kind, f.eventType, f.correctedType ?? null]).sort()).toEqual([
      ['confirmed', 'fall', null],
      ['false_warning', 'crowd_surge', null],
      ['wrong_type', 'crowd_panic', 'other'],
    ]);
    // Only what the user saw: type, times, wording. No images, tracks or location.
    for (const f of saved) {
      expect(Object.keys(f)).not.toEqual(expect.arrayContaining(['trackIds']));
      expect(f.indicators).toEqual(['Went from upright to lying in 0.6 s']);
    }
    expect(screen.getByTestId('ai-feedback-count').props.children.join('')).toContain('3 feedback notes');
  });

  it('reports a missed event', async () => {
    await setFeedbackOptIn(true);
    renderDashboard([]);
    await waitFor(() => expect(screen.getByTestId('ai-feedback-missed-open')).toBeTruthy());
    fireEvent.press(screen.getByTestId('ai-feedback-missed-open'));
    fireEvent.press(screen.getByTestId('ai-feedback-missed-type-fall'));
    await act(async () => fireEvent.press(screen.getByTestId('ai-feedback-missed-when-just_now')));
    await waitFor(() => expect(screen.getByTestId('ai-feedback-missed-done')).toBeTruthy());
    expect((await listFeedback())[0]).toEqual(expect.objectContaining({ kind: 'missed', correctedType: 'fall', missedWhen: 'just_now' }));
  });

  it('can be deleted, and exports as plain text the user shares themselves', async () => {
    await setFeedbackOptIn(true);
    await addFeedback({ kind: 'false_warning', eventType: 'fall' });
    expect(JSON.parse(feedbackExport(await listFeedback())).entries).toHaveLength(1);
    renderDashboard([]);
    await waitFor(() => expect(screen.getByTestId('ai-feedback-delete')).toBeTruthy());
    await act(async () => fireEvent.press(screen.getByTestId('ai-feedback-delete')));
    expect(await listFeedback()).toEqual([]);
  });

  it('never changes the live detectors', async () => {
    await setFeedbackOptIn(true);
    for (let i = 0; i < 20; i += 1) await addFeedback({ kind: 'false_warning', eventType: 'fall' });
    expect(thresholdFingerprint()).toBe(FROZEN_FINGERPRINT);
  });
});
