import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockPostSocialShare = jest.fn();
const mockGetPublishOptions = jest.fn();

jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ addListener: () => ({ remove: () => {} }) }),
}));

jest.mock('../../services/socialSharingService', () => ({
  DEFAULT_PRIVACY_LEVEL: { tiktok: 'SELF_ONLY', instagram: 'PUBLIC' },
  postSocialShare: (...args: unknown[]) => mockPostSocialShare(...args),
  getPublishOptions: (...args: unknown[]) => mockGetPublishOptions(...args),
}));

jest.mock('../../services/analyticsService', () => ({ trackEvent: jest.fn() }));

import SocialShareOverlay, { SHARE_PROMPT_SECONDS } from '../SocialShareOverlay';
import { ApiError } from '../../services/apiClient';

async function openReview() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('social-share-prompt-share'));
  });
}
const requestIds = () => mockPostSocialShare.mock.calls.map(([, , options]) => options.requestId);

const tiktok = {
  provider: 'tiktok' as const,
  status: 'connected' as const,
  providerUsername: 'me',
  enabledForEmergency: true,
  createdAt: '',
  updatedAt: '',
};

const segment = { segment: { sequence: 3 }, localUri: 'file:///seg-3.mp4', status: 'done' as const };

function renderOverlay(overrides: Partial<React.ComponentProps<typeof SocialShareOverlay>> = {}) {
  const props = {
    emergencyId: 'em_1',
    recording: true,
    providers: [tiktok],
    resolveShareSegment: jest.fn().mockResolvedValue(segment),
    openRequest: 0,
    onShared: jest.fn(),
    ...overrides,
  };
  const utils = render(<SocialShareOverlay {...props} />);
  return { ...utils, props };
}

describe('SocialShareOverlay', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPostSocialShare.mockReset().mockResolvedValue({ provider: 'tiktok', status: 'posted', privacyLevel: 'SELF_ONLY' });
    mockGetPublishOptions.mockReset().mockResolvedValue({ privacyLevels: ['SELF_ONLY'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('the auto prompt appears once recording starts', () => {
    renderOverlay();
    expect(screen.getByTestId('social-share-prompt')).toBeTruthy();
  });

  test('never prompts with no connected providers, or before recording', () => {
    renderOverlay({ providers: [] });
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();
    screen.unmount();
    renderOverlay({ recording: false });
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();
  });

  test('countdown expiry only hides the prompt — nothing is posted or cut', async () => {
    const { props } = renderOverlay();
    // One tick per act: each second's timer is scheduled by the re-render
    // that the previous tick caused.
    for (let s = SHARE_PROMPT_SECONDS; s > 0; s -= 1) {
      expect(screen.getByTestId('social-share-countdown')).toHaveTextContent(`Continuing without sharing in ${s}…`);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();
    expect(mockPostSocialShare).not.toHaveBeenCalled();
    expect(props.resolveShareSegment).not.toHaveBeenCalled();
  });

  test('Skip hides the prompt, posts nothing, and the prompt never returns', async () => {
    const { props, rerender } = renderOverlay();
    fireEvent.press(screen.getByTestId('social-share-prompt-skip'));
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();

    rerender(<SocialShareOverlay {...props} recording={false} />);
    rerender(<SocialShareOverlay {...props} recording />);
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();
    expect(mockPostSocialShare).not.toHaveBeenCalled();
  });

  test('Share Emergency only opens the review step — it does not post', async () => {
    renderOverlay();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-prompt-share'));
    });
    expect(screen.getByTestId('social-share-publishing')).toBeTruthy();
    // Well past the prompt's countdown: still on review, still nothing posted.
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(screen.getByTestId('social-share-publishing')).toBeTruthy();
    expect(mockPostSocialShare).not.toHaveBeenCalled();
  });

  test('the second explicit tap posts the resolved segment with caption and the most private allowed level', async () => {
    const { props } = renderOverlay();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-prompt-share'));
    });
    fireEvent.changeText(screen.getByTestId('social-share-caption'), 'Being followed');
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-publish'));
    });

    expect(props.resolveShareSegment).toHaveBeenCalledTimes(1);
    expect(mockPostSocialShare).toHaveBeenCalledTimes(1);
    expect(mockPostSocialShare).toHaveBeenCalledWith('tiktok', 'em_1', {
      privacyLevel: 'SELF_ONLY',
      caption: 'Being followed',
      sequence: 3,
      requestId: expect.any(String),
    });
    expect(screen.getByTestId('social-share-result')).toBeTruthy();
    expect(props.onShared).toHaveBeenCalledWith(expect.objectContaining({ status: 'posted' }));
  });

  test('public TikTok stays disabled while TikTok only allows SELF_ONLY', async () => {
    renderOverlay();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-prompt-share'));
    });
    expect(screen.getByTestId('social-share-privacy-PUBLIC_TO_EVERYONE').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  test('Share is disabled when no video could be resolved', async () => {
    renderOverlay({ resolveShareSegment: jest.fn().mockResolvedValue(null) });
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-prompt-share'));
    });
    expect(screen.getByTestId('social-share-retry-video')).toBeTruthy();
    fireEvent.press(screen.getByTestId('social-share-publish'));
    expect(mockPostSocialShare).not.toHaveBeenCalled();
  });

  test("with two accounts: one picker, preselected, and Continue opens that provider's review — no second picker", async () => {
    const instagram = { ...tiktok, provider: 'instagram' as const, providerUsername: 'bes_safety' };
    mockGetPublishOptions.mockResolvedValue({ privacyLevels: ['PUBLIC'] });
    renderOverlay({ providers: [tiktok, instagram] });
    fireEvent.press(screen.getByTestId('social-share-prompt-share'));

    expect(screen.getByTestId('social-share-pick')).toBeTruthy();
    expect(screen.getByText('@bes_safety')).toBeTruthy();
    expect(screen.getByTestId('social-share-pick-tiktok').props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(screen.getByTestId('social-share-pick-instagram'));
    expect(screen.getByTestId('social-share-pick-instagram').props.accessibilityState).toEqual({ selected: true });
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-pick-continue'));
    });

    expect(screen.queryByTestId('social-share-pick')).toBeNull();
    expect(screen.getByTestId('social-share-publishing')).toBeTruthy();
    expect(screen.getAllByText('Share to Instagram')).toHaveLength(2); // header + button
    expect(mockGetPublishOptions).toHaveBeenCalledWith('instagram');
    expect(mockPostSocialShare).not.toHaveBeenCalled();
  });

  test('Cancel on the picker posts nothing and closes', () => {
    const instagram = { ...tiktok, provider: 'instagram' as const };
    renderOverlay({ providers: [tiktok, instagram] });
    fireEvent.press(screen.getByTestId('social-share-prompt-share'));
    fireEvent.press(screen.getByTestId('social-share-pick-cancel'));
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();
    expect(mockPostSocialShare).not.toHaveBeenCalled();
  });

  test('the manual Share button opens the review step directly', async () => {
    const { props, rerender } = renderOverlay({ recording: false });
    expect(screen.queryByTestId('social-share-overlay')).toBeNull();
    await act(async () => {
      rerender(<SocialShareOverlay {...props} openRequest={1} />);
    });
    expect(screen.getByTestId('social-share-publishing')).toBeTruthy();
    expect(mockPostSocialShare).not.toHaveBeenCalled();
  });

  test('a double tap on Share publishes exactly once', async () => {
    let resolvePost: (v: unknown) => void = () => {};
    mockPostSocialShare.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
    renderOverlay();
    await openReview();
    const publishButton = screen.getByTestId('social-share-publish');
    await act(async () => {
      fireEvent.press(publishButton);
      fireEvent.press(publishButton);
    });
    expect(mockPostSocialShare).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePost({ provider: 'tiktok', status: 'posted', privacyLevel: 'SELF_ONLY' });
    });
    expect(screen.getByTestId('social-share-result')).toBeTruthy();
  });

  test('the automatic retry for a not-yet-uploaded clip reuses the same request id', async () => {
    mockPostSocialShare
      .mockRejectedValueOnce(new ApiError('No video available to share yet.', 400, 'no_video'))
      .mockResolvedValue({ provider: 'tiktok', status: 'posted', privacyLevel: 'SELF_ONLY' });
    renderOverlay();
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-publish'));
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPostSocialShare).toHaveBeenCalledTimes(2);
    const [first, second] = requestIds();
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
  });

  test('a share still in progress on the server is waited out with the same id, never re-posted under a new one', async () => {
    mockPostSocialShare
      .mockRejectedValueOnce(new ApiError('This share is already in progress.', 409, 'share_in_progress'))
      .mockResolvedValue({ provider: 'tiktok', status: 'posted', privacyLevel: 'SELF_ONLY' });
    renderOverlay();
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-publish'));
    });
    expect(screen.getByTestId('social-share-progress')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    expect(mockPostSocialShare).toHaveBeenCalledTimes(2);
    expect(new Set(requestIds()).size).toBe(1);
    expect(screen.getByTestId('social-share-result')).toBeTruthy();
  });

  test('a new deliberate share gets a new request id', async () => {
    renderOverlay();
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-publish'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-done'));
    });
    screen.unmount();
    renderOverlay({ openRequest: 0 });
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-publish'));
    });
    const [first, second] = requestIds();
    expect(second).not.toBe(first);
  });

  test('an expired authorization shows an actionable reconnect message and reports it', async () => {
    mockPostSocialShare.mockResolvedValue({
      provider: 'tiktok',
      status: 'failed',
      code: 'reauth_required',
      error: 'Reconnect TikTok in Settings → Social Sharing to share.',
    });
    const onResult = jest.fn();
    const { props } = renderOverlay({ onResult });
    await openReview();
    await act(async () => {
      fireEvent.press(screen.getByTestId('social-share-publish'));
    });
    expect(screen.getByText('Reconnect TikTok')).toBeTruthy();
    expect(screen.getByText(/Reconnect TikTok in Settings → Social Sharing to share. Recording continues./)).toBeTruthy();
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ code: 'reauth_required' }));
    expect(props.onShared).not.toHaveBeenCalled();
  });
});
