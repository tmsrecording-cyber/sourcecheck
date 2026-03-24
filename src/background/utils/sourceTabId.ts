import type { TranscriptSourceType } from '../../../shared/types';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const MEET_MEETING_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

export const getSourceIdFromTabUrl = (
  tabUrl: string | undefined,
  sourceType?: TranscriptSourceType,
): string | null => {
  if (!tabUrl) {
    return null;
  }

  try {
    const url = new URL(tabUrl);

    if (sourceType === 'meet' || url.hostname === 'meet.google.com') {
      if (url.hostname !== 'meet.google.com') {
        return null;
      }
      const pathSourceId = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return MEET_MEETING_CODE.test(pathSourceId) ? pathSourceId.toLowerCase() : null;
    }

    if (sourceType === 'youtube' || YOUTUBE_HOSTS.has(url.hostname)) {
      if (!YOUTUBE_HOSTS.has(url.hostname) || url.pathname !== '/watch') {
        return null;
      }
      return url.searchParams.get('v');
    }

    return null;
  } catch {
    return null;
  }
};
