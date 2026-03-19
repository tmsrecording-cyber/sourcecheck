import { describe, expect, it } from 'vitest';

import {
  isMetadataOnlyVideoChange,
  shouldPreserveStateOnRefresh,
} from '../../src/background/utils/session-transition';

const baseVideo = {
  videoId: 'video-123',
  title: 'Fixture Video',
  channel: 'Fixture Channel',
  sourceTabId: 7,
};

describe('session refresh regression', () => {
  it('treats matching video and page session as metadata-only', () => {
    expect(
      isMetadataOnlyVideoChange(
        { ...baseVideo, pageSessionId: 'session-a' },
        { ...baseVideo, pageSessionId: 'session-a' }
      )
    ).toBe(true);
  });

  it('preserves state on same-tab refresh with a new page session id', () => {
    expect(
      shouldPreserveStateOnRefresh({
        currentVideo: { ...baseVideo, pageSessionId: 'session-a' },
        nextVideo: { ...baseVideo, pageSessionId: 'session-b' },
        hasRestoredState: true,
      })
    ).toBe(true);
  });

  it('does not preserve state for a different tab even when the video id matches', () => {
    expect(
      shouldPreserveStateOnRefresh({
        currentVideo: { ...baseVideo, pageSessionId: 'session-a', sourceTabId: 7 },
        nextVideo: { ...baseVideo, pageSessionId: 'session-b', sourceTabId: 8 },
        hasRestoredState: true,
      })
    ).toBe(false);
  });

  it('does not preserve state when there is nothing restored yet', () => {
    expect(
      shouldPreserveStateOnRefresh({
        currentVideo: { ...baseVideo, pageSessionId: 'session-a' },
        nextVideo: { ...baseVideo, pageSessionId: 'session-b' },
        hasRestoredState: false,
      })
    ).toBe(false);
  });
});
