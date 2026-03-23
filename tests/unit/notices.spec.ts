import { describe, expect, it } from 'vitest';

import {
  buildAskReadyNotice,
  buildSettingsSavedNotice,
  getLatestTranscriptFallbackNotice,
} from '../../src/sidepanel/utils/notices';

describe('sidepanel notices', () => {
  it('builds a stable settings-saved notice', () => {
    expect(buildSettingsSavedNotice()).toEqual({
      dedupeKey: 'settings-saved',
      title: 'Settings saved',
      message: 'API key saved.',
      tone: 'success',
    });
  });

  it('builds ask-ready notice for live answers', () => {
    expect(buildAskReadyNotice()).toEqual({
      dedupeKey: 'ask-ready',
      title: 'Answer ready',
      message: 'See HISTORY for the answer.',
      tone: 'accent',
    });
  });

  it('detects unseen transcript panel fallback recoveries', () => {
    expect(
      getLatestTranscriptFallbackNotice(
        [
          { at: 10, source: 'html', step: 'fetch_started', message: 'fetching timedtext' },
          { at: 20, source: 'panel', step: 'parse_success', message: 'latched-panel chunks=8' },
        ],
        0,
      ),
    ).toEqual({
      entryAt: 20,
      notice: {
        dedupeKey: 'fallback:20',
        title: 'Backup transcript active',
        message: 'Using YouTube transcript panel.',
        tone: 'accent',
      },
    });
  });

  it('ignores transcript fallback entries that were already surfaced', () => {
    expect(
      getLatestTranscriptFallbackNotice(
        [
          { at: 10, source: 'panel', step: 'parse_success', message: 'latched-panel chunks=8' },
        ],
        10,
      ),
    ).toBeNull();
  });
});
