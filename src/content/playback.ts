let trackedVideo: HTMLVideoElement | null = null;
let timeUpdateListener: (() => void) | null = null;
let seekedListener: (() => void) | null = null;
let currentVideoId: string | null = null;
let videoElementObserver: MutationObserver | null = null;
let visibilityListener: (() => void) | null = null;

export const setPlaybackVideoId = (videoId: string | null) => {
  currentVideoId = videoId;
};

// Watch for YouTube swapping the <video> element under the same video ID.
// YouTube sometimes replaces the player DOM without triggering a route change,
// which would otherwise leave us listening on a disconnected element.
const startVideoElementObserver = () => {
  if (videoElementObserver) return;
  videoElementObserver = new MutationObserver(() => {
    const current = document.querySelector('video');
    if (current && current !== trackedVideo) {
      initPlaybackTracking();
    }
  });
  videoElementObserver.observe(document.body, { childList: true, subtree: true });
};

export const stopVideoElementObserver = () => {
  videoElementObserver?.disconnect();
  videoElementObserver = null;
};

const SEEK_BACKWARD_THRESHOLD_SECONDS = 0.5;
const SEEK_FORWARD_THRESHOLD_SECONDS = 8;
const INITIAL_SEND_RETRIES = 10;
const INITIAL_SEND_RETRY_DELAY_MS = 600;

const safeSendMessage = (message: unknown) => {
  try {
    const sendPromise = chrome.runtime.sendMessage(message);
    sendPromise.catch(() => {
      // Ignore errors if the extension context was reloaded or is not ready yet.
    });
  } catch {
    // Ignore stale content-script contexts after extension reloads.
  }
};

const sendPlaybackUpdateWithRetry = (video: HTMLVideoElement, boundVideoId: string | null, attempt = 0) => {
  // Drop stale retries that were scheduled before a navigation event.
  if (currentVideoId !== boundVideoId) return;

  const payload = {
    videoId: currentVideoId,
    currentTime: Number.isFinite(video.currentTime) ? Math.floor(video.currentTime) : 0,
    duration: Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
    paused: video.paused,
    playbackRate: Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1,
  };

  try {
    chrome.runtime.sendMessage({ type: 'PLAYBACK_UPDATE', payload })
      .then((result) => {
        if ((!result || result.status !== 'ok') && attempt < INITIAL_SEND_RETRIES) {
          window.setTimeout(() => sendPlaybackUpdateWithRetry(video, boundVideoId, attempt + 1), INITIAL_SEND_RETRY_DELAY_MS);
        }
      })
      .catch(() => {
        if (attempt < INITIAL_SEND_RETRIES) {
          window.setTimeout(() => sendPlaybackUpdateWithRetry(video, boundVideoId, attempt + 1), INITIAL_SEND_RETRY_DELAY_MS);
        }
      });
  } catch {
    if (attempt < INITIAL_SEND_RETRIES) {
      window.setTimeout(() => sendPlaybackUpdateWithRetry(video, boundVideoId, attempt + 1), INITIAL_SEND_RETRY_DELAY_MS);
    }
  }
};

const sendPlaybackUpdate = (video: HTMLVideoElement) => {
  const currentTime = Number.isFinite(video.currentTime) ? Math.floor(video.currentTime) : 0;
  const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
  const playbackRate = Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? video.playbackRate
    : 1;

  safeSendMessage({
    type: 'PLAYBACK_UPDATE',
    payload: {
      videoId: currentVideoId,
      currentTime,
      duration,
      paused: video.paused,
      playbackRate,
    },
  });
};

const startVisibilityListener = () => {
  if (visibilityListener) return;
  visibilityListener = () => {
    if (!document.hidden && trackedVideo) {
      // Force immediate playback update when tab becomes visible
      // to resume scanning promptly after background throttling
      sendPlaybackUpdate(trackedVideo);
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
};

const stopVisibilityListener = () => {
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
};

export const stopPlaybackTracking = () => {
  if (trackedVideo && timeUpdateListener) {
    trackedVideo.removeEventListener('timeupdate', timeUpdateListener);
  }
  if (trackedVideo && seekedListener) {
    trackedVideo.removeEventListener('seeked', seekedListener);
  }
  stopVideoElementObserver();
  stopVisibilityListener();
  trackedVideo = null;
  timeUpdateListener = null;
  seekedListener = null;
};

export const initPlaybackTracking = () => {
  const video = document.querySelector('video');
  if (!video) {
    return false;
  }

  if (trackedVideo === video) {
    return true;
  }

  if (trackedVideo && timeUpdateListener) {
    trackedVideo.removeEventListener('timeupdate', timeUpdateListener);
  }

  if (trackedVideo && seekedListener) {
    trackedVideo.removeEventListener('seeked', seekedListener);
  }

  trackedVideo = video;

  let lastUpdate = 0;
  let lastReportedTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  timeUpdateListener = () => {
    const now = Date.now();
    const rawCurrentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const currentTime = Math.floor(rawCurrentTime);
    const delta = rawCurrentTime - lastReportedTime;

    if (
      delta <= -SEEK_BACKWARD_THRESHOLD_SECONDS ||
      delta >= SEEK_FORWARD_THRESHOLD_SECONDS
    ) {
      safeSendMessage({
        type: 'VIDEO_SEEKED',
        payload: { videoId: currentVideoId, currentTime },
      });
      lastReportedTime = rawCurrentTime;
      lastUpdate = now;
      sendPlaybackUpdate(video);
      return;
    }

    if (now - lastUpdate <= 2000) {
      return;
    }

    sendPlaybackUpdate(video);
    lastUpdate = now;
    lastReportedTime = rawCurrentTime;
  };

  seekedListener = () => {
    const rawCurrentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const currentTime = Math.floor(rawCurrentTime);
    safeSendMessage({
      type: 'VIDEO_SEEKED',
      payload: { videoId: currentVideoId, currentTime },
    });
    lastReportedTime = rawCurrentTime;
    lastUpdate = Date.now();
    sendPlaybackUpdate(video);
  };

  video.addEventListener('timeupdate', timeUpdateListener);
  video.addEventListener('seeked', seekedListener);
  sendPlaybackUpdateWithRetry(video, currentVideoId);
  startVideoElementObserver();
  startVisibilityListener();
  console.log('[SourceCheck] Playback tracking initialized.');
  return true;
};
