import { initPlaybackTracking, setPlaybackVideoId, stopPlaybackTracking, stopVideoElementObserver } from './playback';
import { extractTranscriptData, resetTranscriptExtractionState } from './transcript';
import type { TranscriptDebugState, TranscriptFetchDebugEntry } from '../../shared/types';

let currentVideoId: string | null = null;
const pageSessionId = (() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
})();
let metadataRetryTimer: number | null = null;
let transcriptRetryTimer: number | null = null;
let playbackRetryTimer: number | null = null;
let transcriptDeadlineTimer: number | null = null;
let hasClearedInactiveState = false;
let hasReportedTranscriptUnavailable = false;
let transcriptExtractionController: AbortController | null = null;
let transcriptDeadlineAt: number | null = null;
let transcriptAttemptCount = 0;
let panelFallbackAttempted = false;
let panelFallbackSucceeded = false;
let autoPanelOpenDisabledAfterFailure = false;
let transcriptSuccessLockedForVideo = false;
let lastTranscriptDebug: TranscriptDebugState = {
  source: null,
  reason: 'pending',
  attemptCount: 0,
};

const TRANSCRIPT_ATTEMPT_TIMEOUT_MS = 24_000;
const MAX_TRANSCRIPT_ATTEMPTS = 12;
const TRANSCRIPT_LOAD_DEADLINE_MS = 65_000;
const MESSAGE_SEND_RETRIES = 4;
const MESSAGE_SEND_RETRY_DELAY_MS = 350;
const TRANSCRIPT_FAILURE_DELIVERY_RETRIES = 12;
const TRANSCRIPT_FAILURE_DELIVERY_DELAY_MS = 750;
const TRANSCRIPT_MESSAGE_BATCH_SIZE = 120;

// Thrown internally to signal that the extension context is gone so
// sendMessageWithRetry can bail immediately without logging noise.
class ContextInvalidatedError extends Error {}

const isContextInvalidated = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('Extension context invalidated');

/**
 * Silently handle promise rejections that may be caused by extension context invalidation.
 * Use this instead of .catch(console.error) to avoid polluting the host page console
 * when the extension reloads or updates.
 */
const silentCatch = (error: unknown): void => {
  if (isContextInvalidated(error) || (error instanceof Error && error.message.includes('Extension context'))) {
    // Extension was reloaded — this is expected, don't log
    return;
  }
  // Log other unexpected errors
  console.error('[SourceCheck]', error);
};

const safeSendMessage = async (message: unknown) => {
  try {
    if (!chrome.runtime?.id) {
      throw new ContextInvalidatedError();
    }
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (isContextInvalidated(error) || !chrome.runtime?.id) {
      // Normal after an extension reload — content script is orphaned.
      // Re-throw a sentinel so the retry loop can stop cleanly and silently.
      throw new ContextInvalidatedError();
    }
    console.warn('[SourceCheck] Message send failed:', error);
    return null;
  }
};

const isMessageAckOk = (result: unknown): boolean => {
  if (!result || typeof result !== 'object') {
    return false;
  }

  const status = (result as { status?: unknown }).status;
  return status === 'ok';
};

const sendMessageWithRetry = async (
  message: unknown,
  attempts: number = MESSAGE_SEND_RETRIES,
  delayMs: number = MESSAGE_SEND_RETRY_DELAY_MS
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let result: unknown;
    try {
      result = await safeSendMessage(message);
    } catch (error) {
      if (error instanceof ContextInvalidatedError) {
        // Extension was reloaded — stop retrying silently.
        return null;
      }
      throw error;
    }

    if (isMessageAckOk(result)) {
      return result;
    }

    if (attempt < attempts - 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
    }
  }

  return null;
};

const cleanText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';

const clearRetryTimer = (timerId: number | null) => {
  if (timerId !== null) {
    window.clearTimeout(timerId);
  }
};

const resetPanelFallbackGuards = () => {
  panelFallbackAttempted = false;
  panelFallbackSucceeded = false;
  autoPanelOpenDisabledAfterFailure = false;
};

const clearPendingWork = () => {
  clearRetryTimer(metadataRetryTimer);
  clearRetryTimer(transcriptRetryTimer);
  clearRetryTimer(playbackRetryTimer);
  clearRetryTimer(transcriptDeadlineTimer);
  transcriptExtractionController?.abort();
  transcriptExtractionController = null;
  metadataRetryTimer = null;
  transcriptRetryTimer = null;
  playbackRetryTimer = null;
  transcriptDeadlineTimer = null;
  transcriptDeadlineAt = null;
  transcriptAttemptCount = 0;
  lastTranscriptDebug = {
    source: null,
    reason: 'pending',
    attemptCount: 0,
  };
  resetPanelFallbackGuards();
  transcriptSuccessLockedForVideo = false;
  if (currentVideoId) {
    resetTranscriptExtractionState(currentVideoId);
  }
};

const retryTranscriptExtraction = (videoId: string) => {
  if (isStaleVideoWork(videoId)) {
    return false;
  }

  console.log('[SourceCheck] manual retry requested');
  resetTranscriptExtractionState(videoId);
  hasReportedTranscriptUnavailable = false;
  resetPanelFallbackGuards();
  clearRetryTimer(transcriptRetryTimer);
  clearRetryTimer(transcriptDeadlineTimer);
  transcriptExtractionController?.abort();
  transcriptExtractionController = null;
  transcriptRetryTimer = null;
  transcriptDeadlineTimer = null;
  transcriptDeadlineAt = Date.now() + TRANSCRIPT_LOAD_DEADLINE_MS;
  transcriptAttemptCount = 0;
  lastTranscriptDebug = {
    source: null,
    reason: 'pending',
    attemptCount: 0,
  };

  scheduleTranscriptDeadline(videoId);
  scheduleTranscriptLoad(videoId, 0);
  return true;
};

const isStaleVideoWork = (videoId: string) => currentVideoId !== videoId;

const withAttemptCount = (debug: TranscriptDebugState, attemptCount: number): TranscriptDebugState => ({
  ...debug,
  attemptCount,
});

const isTerminalTranscriptFailure = (debug: TranscriptDebugState) =>
  debug.reason !== null &&
  debug.reason !== 'pending' &&
  debug.reason !== 'caption-tracks-found' &&
  debug.reason !== 'loaded';

const getTerminalFailureDebug = (attemptCount: number): TranscriptDebugState =>
  isTerminalTranscriptFailure(lastTranscriptDebug)
    ? withAttemptCount(lastTranscriptDebug, attemptCount)
    : {
        source: lastTranscriptDebug.source,
        reason: 'timeout',
        attemptCount,
      };

const logContentTranscript = (event: string, details: Record<string, unknown>) => {
  const sanitized: Record<string, unknown> = { event };

  if (typeof details.videoId === 'string') sanitized.videoId = details.videoId;
  if (typeof details.currentVideoId === 'string') sanitized.currentVideoId = details.currentVideoId;
  if (typeof details.pageSessionId === 'string') sanitized.pageSessionId = details.pageSessionId;
  if (typeof details.acked === 'boolean') sanitized.acked = details.acked;
  if (typeof details.attempt === 'number') sanitized.attempt = details.attempt;
  if (typeof details.batchIndex === 'number') sanitized.batchIndex = details.batchIndex;
  if (typeof details.batchLength === 'number') sanitized.batchLength = details.batchLength;
  if (typeof details.totalChunks === 'number') sanitized.totalChunks = details.totalChunks;
  if (typeof details.totalBatches === 'number') sanitized.totalBatches = details.totalBatches;
  if (typeof details.delayMs === 'number') sanitized.delayMs = details.delayMs;
  if (typeof details.deadlineAt === 'number') sanitized.deadlineAt = details.deadlineAt;
  if (typeof details.remainingMs === 'number') sanitized.remainingMs = details.remainingMs;
  if (typeof details.now === 'number') sanitized.now = details.now;
  if (typeof details.isStale === 'boolean') sanitized.isStale = details.isStale;
  if (typeof details.transcriptLength === 'number') sanitized.transcriptLength = details.transcriptLength;

  if (details.debug && typeof details.debug === 'object') {
    const debug = details.debug as { source?: unknown; reason?: unknown; attemptCount?: unknown };
    sanitized.debug = {
      source: debug.source ?? null,
      reason: debug.reason ?? null,
      attemptCount: typeof debug.attemptCount === 'number' ? debug.attemptCount : 0,
    };
  }

  if (details.entry && typeof details.entry === 'object') {
    const entry = details.entry as { at?: unknown; source?: unknown; step?: unknown };
    sanitized.entry = {
      at: typeof entry.at === 'number' ? entry.at : null,
      source: typeof entry.source === 'string' ? entry.source : null,
      step: typeof entry.step === 'string' ? entry.step : null,
    };
  }

  console.log('[SourceCheck][content]', {
    ...sanitized,
  });
};

const deliverTranscriptFetchDebug = async (
  videoId: string,
  entry: TranscriptFetchDebugEntry
) => {
  if (isStaleVideoWork(videoId)) {
    return null;
  }

  const result = await safeSendMessage({
    type: 'TRANSCRIPT_FETCH_DEBUG',
    payload: {
      videoId,
      entry,
    },
  });
  logContentTranscript('TRANSCRIPT_FETCH_DEBUG_ACK', {
    videoId,
    acked: isMessageAckOk(result),
    entry,
  });
  return result;
};

const sendTranscriptStatus = async (videoId: string, debug: TranscriptDebugState) => {
  if (isStaleVideoWork(videoId)) {
    return null;
  }

  const result = await sendMessageWithRetry({
    type: 'TRANSCRIPT_STATUS',
    payload: {
      videoId,
      debug,
    },
  });
  logContentTranscript('TRANSCRIPT_STATUS_ACK', {
    videoId,
    acked: result !== null,
    debug,
  });
  return result;
};

const deliverTranscriptLoaded = async (
  videoId: string,
  transcript: Array<{ text: string; startMs: number; durationMs: number }>,
  debug: TranscriptDebugState
) => {
  const totalBatches = Math.ceil(transcript.length / TRANSCRIPT_MESSAGE_BATCH_SIZE);

  const startResult = await sendMessageWithRetry({
    type: 'TRANSCRIPT_BATCH_START',
    payload: {
      videoId,
      totalChunks: transcript.length,
      totalBatches,
      debug,
    },
  });
  logContentTranscript('TRANSCRIPT_BATCH_START_ACK', {
    videoId,
    acked: startResult !== null,
    totalChunks: transcript.length,
    totalBatches,
    debug,
  });

  if (startResult === null) {
    return null;
  }

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    if (isStaleVideoWork(videoId)) {
      return null;
    }

    const start = batchIndex * TRANSCRIPT_MESSAGE_BATCH_SIZE;
    const end = start + TRANSCRIPT_MESSAGE_BATCH_SIZE;
    const batch = transcript.slice(start, end);
    const appendResult = await sendMessageWithRetry({
      type: 'TRANSCRIPT_BATCH_APPEND',
      payload: {
        videoId,
        batchIndex,
        batch,
      },
    });
    logContentTranscript('TRANSCRIPT_BATCH_APPEND_ACK', {
      videoId,
      acked: appendResult !== null,
      batchIndex,
      batchLength: batch.length,
    });

    if (appendResult === null) {
      return null;
    }
  }

  const loadedResult = await sendMessageWithRetry({
    type: 'TRANSCRIPT_LOADED',
    payload: {
      videoId,
      debug,
    },
  });
  logContentTranscript('TRANSCRIPT_LOADED_ACK', {
    videoId,
    acked: loadedResult !== null,
    debug,
  });
  return loadedResult;
};

const deliverTranscriptFailure = async (
  videoId: string,
  debug: TranscriptDebugState
) => {
  for (let attempt = 0; attempt < TRANSCRIPT_FAILURE_DELIVERY_RETRIES; attempt += 1) {
    if (isStaleVideoWork(videoId)) {
      return null;
    }

    const result = await safeSendMessage({
      type: 'TRANSCRIPT_FAILED',
      payload: { videoId, debug },
    });
    logContentTranscript('TRANSCRIPT_FAILED_ACK', {
      videoId,
      acked: isMessageAckOk(result),
      attempt: attempt + 1,
      debug,
    });
    if (isMessageAckOk(result)) {
      return result;
    }

    if (attempt < TRANSCRIPT_FAILURE_DELIVERY_RETRIES - 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, TRANSCRIPT_FAILURE_DELIVERY_DELAY_MS);
      });
    }
  }

  return null;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T | null> => {
  let timeoutId: number | null = null;

  try {
    return await Promise.race<T | null>([
      promise,
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => {
          onTimeout?.();
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

const getStructuredData = (): Record<string, any> | null => {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'));

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || 'null');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const videoObject = items.find((item) => item?.['@type'] === 'VideoObject');
      if (videoObject) return videoObject;
    } catch {
      // Ignore malformed structured data blocks.
    }
  }

  return null;
};

const extractVideoMetadata = () => {
  const structuredData = getStructuredData();

  const titleCandidates = [
    document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent,
    document.querySelector('h1.title yt-formatted-string')?.textContent,
    document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
    document.querySelector('meta[name="title"]')?.getAttribute('content'),
    structuredData?.name,
    document.title.replace(/\s*-\s*YouTube$/, ''),
  ];

  const channelCandidates = [
    document.querySelector('#owner #channel-name a')?.textContent,
    document.querySelector('#owner-name a')?.textContent,
    document.querySelector('ytd-channel-name a')?.textContent,
    document.querySelector('link[itemprop="name"]')?.getAttribute('content'),
    document.querySelector('meta[itemprop="author"]')?.getAttribute('content'),
    structuredData?.author?.name,
  ];

  const title = titleCandidates.map(cleanText).find(Boolean) || 'Unknown Title';
  const channel = channelCandidates.map(cleanText).find(Boolean) || 'Unknown Channel';

  return { title, channel };
};

const sendVideoChanged = async (videoId: string) => {
  const metadata = extractVideoMetadata();

  const result = await sendMessageWithRetry({
    type: 'VIDEO_CHANGED',
    payload: {
      videoId,
      title: metadata.title,
      channel: metadata.channel,
      pageSessionId,
    },
  });

  if (result === null) {
    console.log('[SourceCheck] No listener for video data yet.');
  }

  logContentTranscript('VIDEO_CHANGED_ACK', {
    videoId,
    acked: result !== null,
    pageSessionId,
  });

  return metadata;
};

const scheduleMetadataRetries = (videoId: string, initialAttempt: number) => {
  clearRetryTimer(metadataRetryTimer);

  const retry = async (attempt: number) => {
    if (isStaleVideoWork(videoId)) {
      metadataRetryTimer = null;
      return;
    }

    const metadata = await sendVideoChanged(videoId);
    if (
      attempt >= 5 ||
      isStaleVideoWork(videoId) ||
      (metadata.title !== 'Unknown Title' && metadata.channel !== 'Unknown Channel')
    ) {
      metadataRetryTimer = null;
      return;
    }

    metadataRetryTimer = window.setTimeout(() => retry(attempt + 1), 1500);
  };

  metadataRetryTimer = window.setTimeout(() => retry(initialAttempt + 1), 1500);
};

const scheduleTranscriptLoad = (videoId: string, attempt = 0) => {
  if (hasReportedTranscriptUnavailable && autoPanelOpenDisabledAfterFailure) {
    transcriptRetryTimer = null;
    return;
  }

  clearRetryTimer(transcriptRetryTimer);
  logContentTranscript('SCHEDULE_TRANSCRIPT_LOAD', {
    videoId,
    attempt,
    delayMs: attempt === 0 ? 1000 : attempt < 4 ? 2500 : 5000,
    deadlineAt: transcriptDeadlineAt,
  });

  transcriptRetryTimer = window.setTimeout(async () => {
    logContentTranscript('TRANSCRIPT_TIMER_FIRED', {
      videoId,
      attempt,
      currentVideoId,
      isStale: isStaleVideoWork(videoId),
      deadlineAt: transcriptDeadlineAt,
      now: Date.now(),
    });
    if (isStaleVideoWork(videoId)) {
      transcriptRetryTimer = null;
      return;
    }

    if (hasReportedTranscriptUnavailable && autoPanelOpenDisabledAfterFailure) {
      transcriptRetryTimer = null;
      return;
    }

    if (transcriptDeadlineAt !== null && Date.now() >= transcriptDeadlineAt) {
      clearRetryTimer(transcriptDeadlineTimer);
      transcriptDeadlineTimer = null;
      transcriptDeadlineAt = null;
      transcriptRetryTimer = null;
      if (!hasReportedTranscriptUnavailable) {
        const result = await deliverTranscriptFailure(
          videoId,
          getTerminalFailureDebug(Math.max(transcriptAttemptCount, attempt + 1))
        );
        if (result !== null) {
          hasReportedTranscriptUnavailable = true;
          autoPanelOpenDisabledAfterFailure = true;
          console.log('[SourceCheck] terminal transcript failure locked');
        }
      }
      return;
    }

    // Cancel any previous in-flight extraction before starting a new one.
    transcriptExtractionController?.abort();
    const controller = new AbortController();
    transcriptExtractionController = controller;
    const { signal } = controller;
    transcriptAttemptCount = attempt + 1;
    lastTranscriptDebug = {
      source: null,
      reason: 'pending',
      attemptCount: transcriptAttemptCount,
    };
    logContentTranscript('EXTRACT_TRANSCRIPT_ATTEMPT_START', {
      videoId,
      attempt: transcriptAttemptCount,
    });
    void sendTranscriptStatus(videoId, lastTranscriptDebug).catch(silentCatch);

    // Only open the native YouTube transcript panel after the non-UI extraction
    // methods (window / scripts / html) have already failed on a prior attempt.
    // This prevents the panel from popping open on the first page load.
    const allowAutoPanelFallback = attempt >= 1 &&
      !transcriptSuccessLockedForVideo &&
      !panelFallbackAttempted &&
      !panelFallbackSucceeded &&
      !autoPanelOpenDisabledAfterFailure;
    const extractionResult = await withTimeout(
      extractTranscriptData(videoId, signal, (entry) => {
        void deliverTranscriptFetchDebug(videoId, {
          at: Date.now(),
          ...entry,
        }).catch(silentCatch);
      }, {
        allowPanelAutoOpen: allowAutoPanelFallback,
      }),
      TRANSCRIPT_ATTEMPT_TIMEOUT_MS,
      () => controller.abort()
    );
    if (transcriptExtractionController === controller) {
      transcriptExtractionController = null;
    }
    logContentTranscript('EXTRACT_TRANSCRIPT_ATTEMPT_END', {
      videoId,
      attempt: transcriptAttemptCount,
      debug: extractionResult?.debug ?? null,
      transcriptLength: extractionResult?.transcript?.length ?? 0,
    });
    if (isStaleVideoWork(videoId)) {
      transcriptRetryTimer = null;
      return;
    }

    if (extractionResult) {
      panelFallbackAttempted = panelFallbackAttempted || extractionResult.panelFallbackAttempted;
      panelFallbackSucceeded = panelFallbackSucceeded || extractionResult.panelFallbackSucceeded;
      if (extractionResult.panelFallbackAttempted && !extractionResult.panelFallbackSucceeded) {
        autoPanelOpenDisabledAfterFailure = true;
      }
      lastTranscriptDebug = withAttemptCount(extractionResult.debug, transcriptAttemptCount);
      void sendTranscriptStatus(videoId, lastTranscriptDebug).catch(silentCatch);
    }

    if (extractionResult?.transcript?.length) {
      const result = await deliverTranscriptLoaded(
        videoId,
        extractionResult.transcript,
        lastTranscriptDebug
      );
      if (result === null) {
        console.log('[SourceCheck] Transcript delivery was not acknowledged, retrying extraction.');
        if (attempt < MAX_TRANSCRIPT_ATTEMPTS - 1) {
          scheduleTranscriptLoad(videoId, attempt + 1);
        } else if (!hasReportedTranscriptUnavailable) {
          const failureResult = await deliverTranscriptFailure(
            videoId,
            getTerminalFailureDebug(transcriptAttemptCount)
          );
          if (failureResult !== null) {
            hasReportedTranscriptUnavailable = true;
            autoPanelOpenDisabledAfterFailure = true;
            console.log('[SourceCheck] terminal transcript failure locked');
          }
        }
        return;
      }

      hasReportedTranscriptUnavailable = false;
      transcriptSuccessLockedForVideo = true;
      autoPanelOpenDisabledAfterFailure = true;
      clearRetryTimer(transcriptDeadlineTimer);
      transcriptDeadlineTimer = null;
      transcriptDeadlineAt = null;
      transcriptRetryTimer = null;
      return;
    }

    if (
      extractionResult &&
      !extractionResult.transcript?.length &&
      isTerminalTranscriptFailure(lastTranscriptDebug) &&
      (attempt >= 1 || panelFallbackAttempted)
    ) {
      const result = await deliverTranscriptFailure(videoId, lastTranscriptDebug);
      if (result !== null) {
        hasReportedTranscriptUnavailable = true;
        autoPanelOpenDisabledAfterFailure = true;
        console.log('[SourceCheck] terminal transcript failure locked');
      }
      clearRetryTimer(transcriptRetryTimer);
      clearRetryTimer(transcriptDeadlineTimer);
      transcriptRetryTimer = null;
      transcriptDeadlineTimer = null;
      transcriptDeadlineAt = null;
      return;
    }

    if (!hasReportedTranscriptUnavailable && attempt >= MAX_TRANSCRIPT_ATTEMPTS - 1) {
      const result = await deliverTranscriptFailure(
        videoId,
        getTerminalFailureDebug(transcriptAttemptCount)
      );
      if (result === null) {
        console.log('[SourceCheck] No listener for transcript failure yet.');
      } else {
        hasReportedTranscriptUnavailable = true;
        autoPanelOpenDisabledAfterFailure = true;
        console.log('[SourceCheck] terminal transcript failure locked');
      }
    }

    if (attempt < MAX_TRANSCRIPT_ATTEMPTS - 1) {
      scheduleTranscriptLoad(videoId, attempt + 1);
    } else {
      transcriptRetryTimer = null;
    }
  }, (attempt === 0 || (attempt === 1 && !panelFallbackAttempted)) ? 1000 : attempt < 4 ? 2500 : 5000);
};

const schedulePlaybackInit = (attempt = 0) => {
  clearRetryTimer(playbackRetryTimer);

  playbackRetryTimer = window.setTimeout(() => {
    const initialized = initPlaybackTracking();
    if (!initialized && attempt < 20) {
      schedulePlaybackInit(attempt + 1);
      return;
    }

    playbackRetryTimer = null;
  }, attempt === 0 ? 500 : 1500);
};

const scheduleTranscriptDeadline = (videoId: string) => {
  clearRetryTimer(transcriptDeadlineTimer);

  if (transcriptDeadlineAt === null) {
    transcriptDeadlineAt = Date.now() + TRANSCRIPT_LOAD_DEADLINE_MS;
  }

  const remainingMs = transcriptDeadlineAt - Date.now();
  logContentTranscript('SCHEDULE_TRANSCRIPT_DEADLINE', {
    videoId,
    deadlineAt: transcriptDeadlineAt,
    remainingMs,
  });
  if (remainingMs <= 0) {
    transcriptDeadlineTimer = null;
    if (!hasReportedTranscriptUnavailable) {
      void deliverTranscriptFailure(
        videoId,
        getTerminalFailureDebug(transcriptAttemptCount)
      ).then((result) => {
        if (result !== null) {
          hasReportedTranscriptUnavailable = true;
          autoPanelOpenDisabledAfterFailure = true;
          console.log('[SourceCheck] terminal transcript failure locked');
        }
      }).catch(silentCatch);
    }
    return;
  }

  transcriptDeadlineTimer = window.setTimeout(() => {
    transcriptDeadlineTimer = null;
    if (isStaleVideoWork(videoId) || hasReportedTranscriptUnavailable) {
      return;
    }

    clearRetryTimer(transcriptRetryTimer);
    transcriptExtractionController?.abort();
    transcriptExtractionController = null;
    transcriptRetryTimer = null;
    transcriptDeadlineAt = null;

    void deliverTranscriptFailure(
      videoId,
      getTerminalFailureDebug(transcriptAttemptCount)
    ).then((result) => {
      if (result !== null) {
        hasReportedTranscriptUnavailable = true;
        autoPanelOpenDisabledAfterFailure = true;
        console.log('[SourceCheck] terminal transcript failure locked');
      }
    }).catch(console.error);
  }, remainingMs);
};

const clearActiveVideo = async () => {
  const shouldNotify = currentVideoId !== null || !hasClearedInactiveState;
  currentVideoId = null;
  setPlaybackVideoId(null);
  stopVideoElementObserver();
  hasReportedTranscriptUnavailable = false;
  clearPendingWork();

  if (shouldNotify) {
    hasClearedInactiveState = true;
    await sendMessageWithRetry({ type: 'VIDEO_CLEARED' });
  }
};

const checkVideoState = async () => {
  logContentTranscript('CHECK_VIDEO_STATE_START', {
    pathname: window.location.pathname,
    currentVideoId,
  });
  if (window.location.pathname !== '/watch') {
    await clearActiveVideo();
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  if (!videoId) {
    await clearActiveVideo();
    return;
  }

  if (videoId === currentVideoId) return;

  // Tear down old playback listeners before we update the video ID.
  // This prevents stale timeupdate/seeked events from being attributed to the new video.
  stopPlaybackTracking();
  currentVideoId = videoId;
  setPlaybackVideoId(videoId);
  resetTranscriptExtractionState();
  hasClearedInactiveState = false;
  hasReportedTranscriptUnavailable = false;
  resetPanelFallbackGuards();
  transcriptDeadlineAt = Date.now() + TRANSCRIPT_LOAD_DEADLINE_MS;
  transcriptAttemptCount = 0;
  lastTranscriptDebug = {
    source: null,
    reason: 'pending',
    attemptCount: 0,
  };
  console.log(`[SourceCheck] New video detected: ${videoId}`);

  await sendVideoChanged(videoId);
  logContentTranscript('POST_VIDEO_CHANGED', {
    videoId,
    currentVideoId,
    isStale: isStaleVideoWork(videoId),
  });
  if (isStaleVideoWork(videoId)) {
    return;
  }

  scheduleMetadataRetries(videoId, 0);

  logContentTranscript('BEFORE_SCHEDULE_PLAYBACK_INIT', {
    videoId,
  });
  schedulePlaybackInit();
  logContentTranscript('BEFORE_SCHEDULE_TRANSCRIPT_DEADLINE', {
    videoId,
  });
  scheduleTranscriptDeadline(videoId);
  logContentTranscript('BEFORE_SCHEDULE_TRANSCRIPT_LOAD', {
    videoId,
  });
  scheduleTranscriptLoad(videoId);
};

// Track listener references for cleanup
const ytNavigateListener = () => { void checkVideoState().catch(silentCatch); };
const loadListener = () => { void checkVideoState().catch(silentCatch); };

window.addEventListener('yt-navigate-finish', ytNavigateListener);
window.addEventListener('load', loadListener);
void checkVideoState().catch(silentCatch);

// Cleanup function for extension reload
if (chrome.runtime?.id) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'CONTENT_SCRIPT_CLEANUP') {
      window.removeEventListener('yt-navigate-finish', ytNavigateListener);
      window.removeEventListener('load', loadListener);
    }
  });
}

if (chrome.runtime?.id) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'RETRY_TRANSCRIPT') {
      return false;
    }

    const videoId = typeof message.payload?.videoId === 'string' ? message.payload.videoId : null;
    if (!videoId) {
      sendResponse({ status: 'error', error: 'Missing videoId.' });
      return false;
    }

    const retried = retryTranscriptExtraction(videoId);
    sendResponse({ status: retried ? 'ok' : 'ignored' });
    return false;
  });
}
