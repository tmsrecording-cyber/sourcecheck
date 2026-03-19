import type { ActiveVideoContext } from '../../../shared/types';

type RefreshTransitionInput = {
  currentVideo: ActiveVideoContext | null;
  nextVideo: ActiveVideoContext;
  hasRestoredState: boolean;
};

const isSameSourceTab = (
  currentVideo: ActiveVideoContext | null,
  nextVideo: ActiveVideoContext
) => {
  if (typeof currentVideo?.sourceTabId !== 'number' || typeof nextVideo.sourceTabId !== 'number') {
    return false;
  }

  return currentVideo.sourceTabId === nextVideo.sourceTabId;
};

export const isMetadataOnlyVideoChange = (
  currentVideo: ActiveVideoContext | null,
  nextVideo: ActiveVideoContext
) =>
  Boolean(
    currentVideo &&
    currentVideo.videoId === nextVideo.videoId &&
    currentVideo.pageSessionId === nextVideo.pageSessionId
  );

export const shouldPreserveStateOnRefresh = ({
  currentVideo,
  nextVideo,
  hasRestoredState,
}: RefreshTransitionInput) =>
  Boolean(
    currentVideo &&
    hasRestoredState &&
    currentVideo.videoId === nextVideo.videoId &&
    currentVideo.pageSessionId !== nextVideo.pageSessionId &&
    isSameSourceTab(currentVideo, nextVideo)
  );
