import { initPlaybackTracking, setPlaybackVideoId, stopPlaybackTracking, stopVideoElementObserver } from './playback';
import { resetTranscriptExtractionState } from './transcript';
import { youTubeAdapter } from './adapters/youtube';
import { meetAdapter } from './adapters/meet';
import type { TranscriptAdapter } from './adapters/transcript-adapter';
import type { TranscriptDebugState, TranscriptFetchDebugEntry } from '../../shared/types';
import './remote-logger'; // Auto-starts remote logging if SC_LOG_ENDPOINT is set

// ---------------------------------------------------------------------------
// Adapter registry — ordered, first match wins
// ---------------------------------------------------------------------------
const ADAPTERS: TranscriptAdapter[] = [youTubeAdapter, meetAdapter];

const resolveAdapter = (location: Location): TranscriptAdapter | null =>
  ADAPTERS.find((a) => a.canHandle(location)) ?? null;

/** The adapter for the current page. Set in checkVideoState, cleared on navigation away. */
let activeAdapter: TranscriptAdapter | null = null;

let currentVideoId: string | null = null;
const createPageSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `sc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
let pageSessionId = createPageSessionId();
let metadataRetryTimer: number | null = null;
let transcriptRetryTimer: number | null = null;
let playbackRetryTimer: number | null = null;
let transcriptDeadlineTimer: number | null = null;
let hasClearedInactiveState = false;
let hasReportedTranscriptUnavailable = false;
let transcriptExtractionController: AbortController | null = null;
let liveCaptureController: AbortController | null = null;
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
/** How long to wait for the first caption before reporting transcript unavailable on a Meet call. */
const LIVE_CAPTION_TIMEOUT_MS = 45_000;
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
  liveCaptureController?.abort();
  liveCaptureController = null;
  activeAdapter = null;
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

  // FIX: Include transcript directly for panel fallback compatibility
  // (bypasses pendingTranscriptBuffer which is only populated by batching)
  const loadedResult = await sendMessageWithRetry({
    type: 'TRANSCRIPT_LOADED',
    payload: {
      videoId,
      debug,
      transcript: transcript.length > 0 ? transcript : undefined,
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

/** Sends a single live caption chunk directly to the service worker for immediate processing. */
const deliverLiveChunk = async (
  videoId: string,
  chunk: { text: string; startMs: number; durationMs: number }
): Promise<void> => {
  if (isStaleVideoWork(videoId)) return;
  await safeSendMessage({
    type: 'TRANSCRIPT_CHUNK_LIVE',
    payload: { videoId, chunk },
  }).catch(silentCatch);
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T | null> => {
  let timeoutId: number | null = null;

  try {
    return await Promise.race<T | null>([
      promise.catch((err) => {
        // Swallow AbortError as null (cancelled by new video/navigation)
        if (err instanceof DOMException && err.name === 'AbortError') {
          return null as T;
        }
        throw err;
      }),
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

const sendVideoChanged = async (videoId: string) => {
  const metadata = (activeAdapter ?? youTubeAdapter).extractMetadata(document);

  const result = await sendMessageWithRetry({
    type: 'VIDEO_CHANGED',
    payload: {
      videoId,
      title: metadata.title,
      channel: metadata.channel,
      pageSessionId,
      sourceContext: (activeAdapter ?? youTubeAdapter).buildSourceContext(videoId, metadata.title),
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
      (activeAdapter ?? youTubeAdapter).extractTranscript(videoId, signal, (entry) => {
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
  const resolvedAdapter = resolveAdapter(window.location);
  if (!resolvedAdapter) {
    await clearActiveVideo();
    return;
  }

  const videoId = resolvedAdapter.getVideoId(window.location);

  if (!videoId) {
    await clearActiveVideo();
    return;
  }

  if (videoId === currentVideoId) return;

  // IMMEDIATELY reset ALL local state before any async work.
  // This prevents race conditions during YouTube SPA navigation.
  stopPlaybackTracking();
  clearPendingWork();
  hasClearedInactiveState = false;
  hasReportedTranscriptUnavailable = false;
  transcriptSuccessLockedForVideo = false;
  activeAdapter = resolvedAdapter;
  currentVideoId = videoId;
  setPlaybackVideoId(videoId);
  resetTranscriptExtractionState();
  lastTranscriptDebug = {
    source: null,
    reason: 'pending',
    attemptCount: 0,
  };
  console.log(`[SourceCheck] New video detected: ${videoId} (${resolvedAdapter.sourceType})`);

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

  // Live-caption adapters (e.g. Meet) use startLiveCapture instead of the
  // static transcript fetch/retry pipeline. Playback tracking is also skipped
  // since Meet has no meaningful video currentTime (the <video> is a camera feed).
  if (resolvedAdapter.startLiveCapture) {
    const controller = new AbortController();
    liveCaptureController = controller;

    // Arm a timeout: if no caption chunk arrives within LIVE_CAPTION_TIMEOUT_MS
    // (captions disabled, DOM selectors stale, or user never spoke) surface a
    // transcript-unavailable state so the sidepanel doesn't sit silent forever.
    let captionReceived = false;
    const noCaptionsTimer = window.setTimeout(() => {
      if (!captionReceived && !controller.signal.aborted) {
        void deliverTranscriptFailure(videoId, { source: null, reason: 'timeout', attemptCount: 1 }).catch(silentCatch);
      }
    }, LIVE_CAPTION_TIMEOUT_MS);
    controller.signal.addEventListener('abort', () => window.clearTimeout(noCaptionsTimer), { once: true });

    resolvedAdapter.startLiveCapture(
      videoId,
      controller.signal,
      (chunk) => {
        captionReceived = true;
        window.clearTimeout(noCaptionsTimer);
        void deliverLiveChunk(videoId, chunk);
      },
      (entry) => { void deliverTranscriptFetchDebug(videoId, { at: Date.now(), ...entry }).catch(silentCatch); },
    );
    return;
  }

  logContentTranscript('BEFORE_SCHEDULE_PLAYBACK_INIT', {
    videoId,
  });
  transcriptDeadlineAt = Date.now() + TRANSCRIPT_LOAD_DEADLINE_MS;
  transcriptAttemptCount = 0;
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

// Single message listener for all runtime messages (prevents duplicate registration on hot reload)
let runtimeMessageListenerRegistered = false;

if (chrome.runtime?.id && !runtimeMessageListenerRegistered) {
  runtimeMessageListenerRegistered = true;
  
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // Handle cleanup message
    if (message?.type === 'CONTENT_SCRIPT_CLEANUP') {
      window.removeEventListener('yt-navigate-finish', ytNavigateListener);
      window.removeEventListener('load', loadListener);
      return false;
    }
    
    // Handle retry transcript
    if (message?.type === 'RETRY_TRANSCRIPT') {
      const videoId = typeof message.payload?.videoId === 'string' ? message.payload.videoId : null;
      if (!videoId) {
        sendResponse({ status: 'error', error: 'Missing videoId.' });
        return false;
      }

      const retried = retryTranscriptExtraction(videoId);
      sendResponse({ status: retried ? 'ok' : 'ignored' });
      return false;
    }

    // Handle reannounce video context
    if (message?.type === 'REANNOUNCE_VIDEO_CONTEXT') {
      const videoId = typeof message.payload?.videoId === 'string' ? message.payload.videoId : null;
      if (!videoId) {
        sendResponse({ status: 'error', error: 'Missing videoId.' });
        return false;
      }

      if (videoId !== currentVideoId) {
        sendResponse({ status: 'ignored' });
        return false;
      }

      pageSessionId = createPageSessionId();
      void sendVideoChanged(videoId)
        .then(() => sendResponse({ status: 'ok', pageSessionId }))
        .catch((error) => {
          sendResponse({
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to reannounce video context.',
          });
        });
      return true;
    }

    return false;
  });
}
