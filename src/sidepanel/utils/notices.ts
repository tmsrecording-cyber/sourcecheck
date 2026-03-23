import type { TranscriptFetchDebugEntry } from '../../../shared/types';

export type SidepanelNoticeTone = 'accent' | 'success' | 'warning';

export interface SidepanelNotice {
  id: string;
  title: string;
  message: string;
  tone: SidepanelNoticeTone;
}

export interface PendingSidepanelNotice extends Omit<SidepanelNotice, 'id'> {
  dedupeKey: string;
}

export const buildSettingsSavedNotice = (): PendingSidepanelNotice => ({
  dedupeKey: 'settings-saved',
  title: 'Settings saved',
  message: 'API key saved.',
  tone: 'success',
});

export const buildAskReadyNotice = (): PendingSidepanelNotice => ({
  dedupeKey: 'ask-ready',
  title: 'Answer ready',
  message: 'See HISTORY for the answer.',
  tone: 'accent',
});

export const getLatestTranscriptFallbackNotice = (
  entries: TranscriptFetchDebugEntry[],
  lastSeenAt: number,
): { entryAt: number; notice: PendingSidepanelNotice } | null => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.at <= lastSeenAt) {
      break;
    }

    if (entry.source === 'panel' && entry.step === 'parse_success') {
      return {
        entryAt: entry.at,
        notice: {
          dedupeKey: `fallback:${entry.at}`,
          title: 'Backup transcript active',
          message: 'Using YouTube transcript panel.',
          tone: 'accent',
        },
      };
    }
  }

  return null;
};
