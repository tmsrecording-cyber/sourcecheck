import { describe, expect, it } from 'vitest';

import {
  buildModelChangedNotice,
  buildSettingsSavedNotice,
  getLatestTranscriptFallbackNotice,
} from '../../src/sidepanel/utils/notices';

describe('sidepanel notices', () => {
  it('builds a stable settings-saved notice', () => {
    expect(buildSettingsSavedNotice()).toEqual({
      dedupeKey: 'settings-saved',
      title: 'Settings saved',
      message: 'Your API key is ready for the next checks.',
      tone: 'success',
    });
  });

  it('builds BYOK model-change notices with the selected model label', () => {
    expect(
      buildModelChangedNotice('gemini-3.1-flash-lite-preview', true),
    ).toEqual({
      dedupeKey: 'model:gemini-3.1-flash-lite-preview',
      title: 'Model changed',
      message: 'Now using Flash 3.1 Lite.',
      tone: 'accent',
    });
  });

  it('falls back to the managed-model notice when BYOK is inactive', () => {
    expect(
      buildModelChangedNotice('gemini-3-flash-preview', false),
    ).toEqual({
      dedupeKey: 'model:gemini-2.5-flash:managed',
      title: 'Managed model active',
      message: 'SourceCheck is using Flash 2.5.',
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
        title: 'Fallback transcript active',
        message: 'Using the YouTube transcript panel for this video.',
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
