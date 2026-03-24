import { normalizeSeconds } from '../../shared/time';

let trackedVideo: HTMLVideoElement | null = null;
let timeUpdateListener: (() => void) | null = null;
let seekedListener: (() => void) | null = null;
let forceSyncListener: (() => void) | null = null;
let currentVideoId: string | null = null;
let videoElementObserver: MutationObserver | null = null;
let visibilityListener: (() => void) | null = null;

export const setPlaybackVideoId = (videoId: string | null) => {
  currentVideoId = videoId;
};

// Watch for YouTube swapping the <video> element under the same video ID.
// PERFORMANCE FIX: Observe only the player container, not full body.
const startVideoElementObserver = () => {
  if (videoElementObserver) return;
  
  // Find the player container (more specific than body)
  const playerContainer = document.querySelector('#movie_player') || 
                          document.querySelector('#player') || 
                          document.body;
  
  videoElementObserver = new MutationObserver((mutations) => {
    // PERFORMANCE: Only check if video element changed, not on every mutation
    const current = document.querySelector('video');
    if (current && current !== trackedVideo) {
      initPlaybackTracking();
    }
  });
  
  // PERFORMANCE: Reduced observation scope - only player container, not full subtree
  videoElementObserver.observe(playerContainer, { 
    childList: true, 
    subtree: playerContainer === document.body // Only use subtree if fallback to body
  });
};

export const stopVideoElementObserver = () => {
  videoElementObserver?.disconnect();
  videoElementObserver = null;
};

const SEEK_BACKWARD_THRESHOLD_SECONDS = 0.5;
const SEEK_FORWARD_THRESHOLD_SECONDS = 8;
const INITIAL_SEND_RETRIES = 10;
const INITIAL_SEND_RETRY_DELAY_MS = 600;
const PLAYBACK_UPDATE_INTERVAL_MS = 1000;
const MIN_PROGRESS_DELTA_SECONDS = 0.25;

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
    currentTime: normalizeSeconds(video.currentTime),
    duration: normalizeSeconds(video.duration),
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
  const currentTime = normalizeSeconds(video.currentTime);
  const duration = normalizeSeconds(video.duration);
  const playbackRate = Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? normalizeSeconds(video.playbackRate, { fallback: 1, min: 0.1 })
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
  if (trackedVideo && forceSyncListener) {
    trackedVideo.removeEventListener('ratechange', forceSyncListener);
    trackedVideo.removeEventListener('play', forceSyncListener);
    trackedVideo.removeEventListener('pause', forceSyncListener);
  }
  stopVideoElementObserver();
  stopVisibilityListener();
  trackedVideo = null;
  timeUpdateListener = null;
  seekedListener = null;
  forceSyncListener = null;
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
  if (trackedVideo && forceSyncListener) {
    trackedVideo.removeEventListener('ratechange', forceSyncListener);
    trackedVideo.removeEventListener('play', forceSyncListener);
    trackedVideo.removeEventListener('pause', forceSyncListener);
  }

  trackedVideo = video;

  let lastUpdate = 0;
  let lastReportedTime = normalizeSeconds(video.currentTime);
  let lastPausedState = video.paused;
  timeUpdateListener = () => {
    const now = Date.now();
    const rawCurrentTime = normalizeSeconds(video.currentTime);
    const currentTime = rawCurrentTime;
    const delta = rawCurrentTime - lastReportedTime;
    const pausedChanged = video.paused !== lastPausedState;

    // Detect seeks (large time jumps)
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
      lastPausedState = video.paused;
      sendPlaybackUpdate(video);
      return;
    }

    // Throttle steady-state updates to avoid flooding the service worker.
    if (now - lastUpdate <= PLAYBACK_UPDATE_INTERVAL_MS) {
      return;
    }

    // MILESTONE 2: Skip update if time hasn't changed meaningfully and paused state is same
    // This reduces message passing during video playback when time advances smoothly
    const timeDelta = Math.abs(rawCurrentTime - lastReportedTime);
    if (!pausedChanged && timeDelta < MIN_PROGRESS_DELTA_SECONDS) {
      // Still update lastUpdate to prevent checking every frame, but don't send message
      lastUpdate = now;
      return;
    }

    sendPlaybackUpdate(video);
    lastUpdate = now;
    lastReportedTime = rawCurrentTime;
    lastPausedState = video.paused;
  };

  seekedListener = () => {
    const rawCurrentTime = normalizeSeconds(video.currentTime);
    const currentTime = rawCurrentTime;
    safeSendMessage({
      type: 'VIDEO_SEEKED',
      payload: { videoId: currentVideoId, currentTime },
    });
    lastReportedTime = rawCurrentTime;
    lastUpdate = Date.now();
    sendPlaybackUpdate(video);
  };

  forceSyncListener = () => {
    lastReportedTime = normalizeSeconds(video.currentTime);
    lastPausedState = video.paused;
    lastUpdate = Date.now();
    sendPlaybackUpdate(video);
  };

  video.addEventListener('timeupdate', timeUpdateListener);
  video.addEventListener('seeked', seekedListener);
  video.addEventListener('ratechange', forceSyncListener);
  video.addEventListener('play', forceSyncListener);
  video.addEventListener('pause', forceSyncListener);
  sendPlaybackUpdateWithRetry(video, currentVideoId);
  startVideoElementObserver();
  startVisibilityListener();
  console.log('[SourceCheck] Playback tracking initialized.');
  return true;
};
