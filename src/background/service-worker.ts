import {
  TranscriptChunk,
  SourceCard,
  AnalyzeChunkResponse,
  VerifyClaimResponse,
  AskQuestionResponse,
  ActiveVideoContext,
  ExtractedClaim,
  ExtractionActionState,
  PendingClaimPreview,
  PlaybackState,
  TranscriptDebugState,
  TranscriptDebugSource,
  TranscriptDebugReason,
  DebugStage,
  PendingTranscriptBufferSummary,
  TranscriptFetchDebugEntry,
  TranscriptMessageStats,
  WorkerLifecycle,
  WorkerRuntimeState,
  DebugEvent,
  GeminiModelOption,
  FREEMIUM_MODEL,
  normalizeModel,
} from '../../shared/types';
import {
  API_BASE,
  CHUNK_INTERVAL_MS,
  MIN_CONFIDENCE,
  REQUEST_TIMEOUT_MS,
} from '../config';
import { 
  fetchWithBYOK, 
  getSessionToken, 
  isTransientError, 
  isNonRetryableErrorCode,
  classifyError,
  broadcastProviderError,
  shouldShowSettings,
  type ClassifiedError,
} from './utils/api';
import { logTranscriptFailure, logProviderError, logRetryExhausted } from './telemetry';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

const LARGE_SEEK_TIME_SECONDS = 180;    // jumps > 3 min that weren't caught by VIDEO_SEEKED
const STARTUP_BACKFILL_SECONDS = 120;   // on first run, scan the last 2 min of history
const MAX_VERIFICATION_RETRIES = 2;
const MAX_CONCURRENT_VERIFICATIONS = 2;
const PLAYHEAD_LEASH_SECONDS = 15;
const MAX_SOURCE_CARDS = 20;  // Aligned with backend ask-video limit
const MAX_PENDING_CLAIMS = 100;      // Prevent unbounded growth during long videos
const MAX_VERIFICATION_QUEUE = 50;   // Limit queued verifications
const TRANSCRIPT_LOAD_TIMEOUT_MS = 65_000;
const TRANSCRIPT_SNAPSHOT_KEY = 'transcriptSnapshot';
const PENDING_TRANSCRIPT_BUFFER_KEY = 'pendingTranscriptBuffer';
const WORKER_RUNTIME_STATE_KEY = 'workerRuntimeState';
const MAX_EVENT_LOG = 80;
const MAX_TRANSCRIPT_FETCH_LOG = 40;
const PENDING_TRANSCRIPT_BUFFER_PERSIST_DELAY_MS = 750;

// Storage quota protection - chrome.storage.local has ~10MB limit (5MB in some MV3 contexts)
// chrome.storage.session has ~1MB limit. Leave headroom for other extension data.
const STORAGE_LOCAL_QUOTA_BYTES = 4 * 1024 * 1024;   // 4MB max for local
const STORAGE_SESSION_QUOTA_BYTES = 512 * 1024;      // 512KB max for session
const STORAGE_TRANSCRIPT_MAX_BYTES = 2 * 1024 * 1024; // 2MB max for single transcript

type VerificationQueueItem = {
  claim: ExtractedClaim;
  videoId: string;
  videoTitle: string;
  channelName: string;
  key: string;
  retryCount: number;
};

type BufferedFutureScan = {
  timestampSeconds: number;
  entities: string[];
  actionState: ExtractionActionState | null;
  reason: string | null;
};

type RawTranscriptChunk = {
  text: string;
  startMs: number;
  durationMs: number;
};

type PendingTranscriptBuffer = {
  videoId: string;
  totalChunks: number;
  totalBatches: number;
  receivedBatchIndexes: Set<number>;
  chunksByBatch: Record<number, RawTranscriptChunk[]>;
};

type StoredTranscriptSnapshot = {
  videoId: string;
  transcript: TranscriptChunk[];
};

type StoredPendingTranscriptBuffer = {
  videoId: string;
  totalChunks: number;
  totalBatches: number;
  receivedBatchIndexes: number[];
  chunksByBatch: Record<string, RawTranscriptChunk[]>;
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKER EVENTS — all lifecycle/stat mutations route through these
// ─────────────────────────────────────────────────────────────────────────────

type WorkerEvent =
  | { type: 'VIDEO_CHANGED'; title: string; channel: string; videoId: string }
  | { type: 'VIDEO_CLEARED' }
  | { type: 'PLAYBACK_UPDATED'; currentTime: number }
  | { type: 'TRANSCRIPT_STATUS_UPDATED'; debug: TranscriptDebugState }
  | { type: 'TRANSCRIPT_FETCH_DEBUG'; entry: TranscriptFetchDebugEntry }
  | { type: 'TRANSCRIPT_BATCH_STARTED'; totalChunks: number; totalBatches: number }
  | { type: 'TRANSCRIPT_BATCH_APPENDED'; batchIndex: number }
  | { type: 'TRANSCRIPT_LOADED'; chunkCount: number; debug: TranscriptDebugState }
  | { type: 'TRANSCRIPT_FAILED'; debug: TranscriptDebugState }
  | { type: 'ANALYZE_STARTED' }
  | { type: 'ANALYZE_COMPLETED'; claimCount: number }
  | { type: 'VERIFY_STARTED'; claimText: string }
  | { type: 'VERIFY_COMPLETED' }
  | { type: 'HYDRATED_FROM_SNAPSHOT'; chunkCount: number }
  | { type: 'ERROR_OCCURRED'; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// MODULE VARIABLES
// ─────────────────────────────────────────────────────────────────────────────

let currentTranscript: TranscriptChunk[] = [];
let currentVideoInfo: ActiveVideoContext | null = null;
let currentPlaybackState: PlaybackState | null = null;
let lastProcessedIndex = -1;
let isProcessing = false;
let isVerifying = false;
let allSourceCards: SourceCard[] = [];
let sourceCards: SourceCard[] = [];
let allPendingClaims: PendingClaimPreview[] = [];
let pendingClaims: PendingClaimPreview[] = [];
let chunksScanned = 0;
let lastScannedTimestamp: number | null = null;
let currentScanPreview: string | null = null;
let currentScanEntities: string[] = [];
let currentScanActionState: ExtractionActionState | null = null;
let currentScanReason: string | null = null;
let bufferedFutureScan: BufferedFutureScan | null = null;
let verificationQueue: VerificationQueueItem[] = [];
let activeVerificationKeys = new Set<string>();
let hasHydratedState = false;
let hydrationPromise: Promise<void> | null = null;
let lastAnalyzedAt = 0;
let processingGeneration = 0;
let verificationGeneration = 0;
let transcriptLoadDeadlineAt: number | null = null;
let transcriptLoadTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
let transcriptDebug: TranscriptDebugState = {
  source: null,
  reason: null,
  attemptCount: 0,
};
let transcriptFetchLog: TranscriptFetchDebugEntry[] = [];
let pendingTranscriptBuffer: PendingTranscriptBuffer | null = null;
let pendingTranscriptBufferPersistTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
const activeRequestControllers = new Set<AbortController>();

// Synced module vars derived from runtimeState — kept for internal logic reads
let debugStage: DebugStage = 'idle';
let transcriptMessageStats: TranscriptMessageStats = {
  startsSeen: 0,
  appendsSeen: 0,
  loadedSeen: 0,
  failedSeen: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL RUNTIME STATE + REDUCER
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_RUNTIME_STATE: WorkerRuntimeState = {
  lifecycle: 'idle',
  currentVideo: null,
  playbackState: null,
  transcriptChunkCount: 0,
  transcriptDebug: null,
  transcriptFetchLog: [],
  pendingTranscriptBufferSummary: { present: false, receivedCount: 0, totalCount: 0 },
  transcriptMessageStats: { startsSeen: 0, appendsSeen: 0, loadedSeen: 0, failedSeen: 0 },
  sourceCards: [],
  pendingClaims: [],
  chunksScanned: 0,
  lastScannedTimestamp: null,
  currentScanPreview: null,
  currentScanEntities: [],
  currentScanActionState: null,
  currentScanReason: null,
  lastProcessedIndex: -1,
  transcriptLoadDeadlineAt: null,
  debugStage: 'idle',
  eventLog: [],
  // MODEL POLICY: Freemium/trial/managed tier always uses FREEMIUM_MODEL
  selectedModel: FREEMIUM_MODEL,
};

let runtimeState: WorkerRuntimeState = { ...INITIAL_RUNTIME_STATE };

const buildEventSummary = (event: WorkerEvent): string => {
  switch (event.type) {
    case 'VIDEO_CHANGED': return `${event.title} · ${event.channel}`;
    case 'PLAYBACK_UPDATED': return `t=${event.currentTime}s`;
    case 'TRANSCRIPT_STATUS_UPDATED':
      return `src=${event.debug.source ?? 'none'} reason=${event.debug.reason ?? 'none'} #${event.debug.attemptCount}`;
    case 'TRANSCRIPT_FETCH_DEBUG':
      return `${event.entry.source} ${event.entry.step} ${event.entry.message}`.slice(0, 120);
    case 'TRANSCRIPT_BATCH_STARTED': return `${event.totalChunks} chunks / ${event.totalBatches} batches`;
    case 'TRANSCRIPT_BATCH_APPENDED': return `batch #${event.batchIndex}`;
    case 'TRANSCRIPT_LOADED': return `${event.chunkCount} chunks`;
    case 'TRANSCRIPT_FAILED': return `reason=${event.debug.reason ?? 'timeout'}`;
    case 'ANALYZE_COMPLETED': return `${event.claimCount} claim(s)`;
    case 'VERIFY_STARTED': return 'verification started';
    case 'HYDRATED_FROM_SNAPSHOT': return `${event.chunkCount} chunks from snapshot`;
    case 'ERROR_OCCURRED': return event.message.slice(0, 80);
    default: return '';
  }
};

const computeNextLifecycle = (
  current: WorkerLifecycle,
  event: WorkerEvent,
  state: WorkerRuntimeState,
): WorkerLifecycle => {
  // Never leave error unless a new video starts
  if (current === 'error' && event.type !== 'VIDEO_CHANGED' && event.type !== 'VIDEO_CLEARED') {
    return current;
  }

  switch (event.type) {
    case 'VIDEO_CHANGED':
      return 'video_detected';
    case 'VIDEO_CLEARED':
      return 'idle';

    case 'PLAYBACK_UPDATED':
      if (current === 'video_detected') return 'playback_ready';
      if (current === 'transcript_loaded') return 'analyzing';
      // In all other active states, playback arriving doesn't change lifecycle
      return current;

    case 'TRANSCRIPT_STATUS_UPDATED':
      if (current === 'video_detected' || current === 'playback_ready') {
        return 'extracting_transcript';
      }
      return current;

    case 'TRANSCRIPT_BATCH_STARTED':
      return 'transcript_buffering';

    case 'TRANSCRIPT_BATCH_APPENDED':
      return current;

    case 'TRANSCRIPT_LOADED':
      // If playback is already known, skip straight to analyzing
      return state.playbackState !== null ? 'analyzing' : 'transcript_loaded';

    case 'TRANSCRIPT_FAILED':
      return 'transcript_unavailable';

    case 'ANALYZE_STARTED':
      if (current === 'analyzing' || current === 'verifying') return current;
      return 'analyzing'; // ready → re-enter active scanning so badge shows Monitoring

    case 'ANALYZE_COMPLETED':
      if (event.claimCount > 0) return 'verifying';
      if (state.sourceCards.length > 0) return 'ready';
      return 'analyzing';

    case 'VERIFY_STARTED':
      return 'verifying';

    case 'VERIFY_COMPLETED':
      if (state.pendingClaims.length > 0) return 'verifying';
      if (state.sourceCards.length > 0) return 'ready';
      return 'analyzing';

    case 'HYDRATED_FROM_SNAPSHOT':
      if (event.chunkCount > 0 && state.playbackState !== null) return 'analyzing';
      if (event.chunkCount > 0) return 'transcript_loaded';
      return current;

    case 'ERROR_OCCURRED':
      return 'error';

    default:
      return current;
  }
};

const computeNextDebugStage = (current: DebugStage, event: WorkerEvent): DebugStage => {
  switch (event.type) {
    case 'VIDEO_CHANGED': return 'video_changed';
    case 'VIDEO_CLEARED': return 'idle';
    case 'TRANSCRIPT_STATUS_UPDATED':
      return event.debug.reason === 'pending' && event.debug.attemptCount > 0
        ? 'extracting_transcript'
        : 'transcript_status_sent';
    case 'TRANSCRIPT_FETCH_DEBUG': return current;
    case 'TRANSCRIPT_BATCH_STARTED': return 'batch_start_sent';
    case 'TRANSCRIPT_BATCH_APPENDED': return 'batch_append_sent';
    case 'TRANSCRIPT_LOADED': return 'transcript_loaded_sent';
    case 'TRANSCRIPT_FAILED': return 'transcript_failed_sent';
    case 'ANALYZE_STARTED': return 'processing_chunks';
    case 'HYDRATED_FROM_SNAPSHOT': return 'hydrated_from_snapshot';
    default: return current;
  }
};

const computeNextTranscriptMessageStats = (
  current: TranscriptMessageStats,
  event: WorkerEvent,
): TranscriptMessageStats => {
  switch (event.type) {
    case 'VIDEO_CHANGED':
    case 'VIDEO_CLEARED':
      return { startsSeen: 0, appendsSeen: 0, loadedSeen: 0, failedSeen: 0 };
    case 'TRANSCRIPT_BATCH_STARTED':
      return { ...current, startsSeen: current.startsSeen + 1 };
    case 'TRANSCRIPT_BATCH_APPENDED':
      return { ...current, appendsSeen: current.appendsSeen + 1 };
    case 'TRANSCRIPT_LOADED':
      return { ...current, loadedSeen: current.loadedSeen + 1 };
    case 'TRANSCRIPT_FAILED':
      return { ...current, failedSeen: current.failedSeen + 1 };
    default:
      return current;
  }
};

const computeNextBufferSummary = (
  current: PendingTranscriptBufferSummary,
  event: WorkerEvent,
): PendingTranscriptBufferSummary => {
  switch (event.type) {
    case 'VIDEO_CHANGED':
    case 'VIDEO_CLEARED':
    case 'TRANSCRIPT_LOADED':
    case 'TRANSCRIPT_FAILED':
      return { present: false, receivedCount: 0, totalCount: 0 };
    case 'TRANSCRIPT_BATCH_STARTED':
      return { present: true, receivedCount: 0, totalCount: event.totalBatches };
    case 'TRANSCRIPT_BATCH_APPENDED':
      return { ...current, receivedCount: current.receivedCount + 1 };
    default:
      return current;
  }
};

const computeNextTranscriptFetchLog = (
  current: TranscriptFetchDebugEntry[],
  event: WorkerEvent,
): TranscriptFetchDebugEntry[] => {
  switch (event.type) {
    case 'VIDEO_CHANGED':
    case 'VIDEO_CLEARED':
      return [];
    case 'TRANSCRIPT_FETCH_DEBUG':
      return [...current, event.entry].slice(-MAX_TRANSCRIPT_FETCH_LOG);
    default:
      return current;
  }
};

const reduceWorkerState = (state: WorkerRuntimeState, event: WorkerEvent): WorkerRuntimeState => {
  const nextLifecycle = computeNextLifecycle(state.lifecycle, event, state);
  const nextDebugStage = computeNextDebugStage(state.debugStage, event);
  const nextStats = computeNextTranscriptMessageStats(state.transcriptMessageStats, event);
  const nextBufferSummary = computeNextBufferSummary(state.pendingTranscriptBufferSummary, event);
  const nextTranscriptFetchLog = computeNextTranscriptFetchLog(state.transcriptFetchLog, event);

  const entry: DebugEvent = {
    at: Date.now(),
    type: event.type,
    videoId: state.currentVideo?.videoId ?? null,
    lifecycle: nextLifecycle,
    debugStage: nextDebugStage,
    summary: buildEventSummary(event),
  };

  return {
    ...state,
    lifecycle: nextLifecycle,
    debugStage: nextDebugStage,
    transcriptMessageStats: nextStats,
    transcriptFetchLog: nextTranscriptFetchLog,
    pendingTranscriptBufferSummary: nextBufferSummary,
    eventLog: [...state.eventLog, entry].slice(-MAX_EVENT_LOG),
  };
};

/** Snapshot current module vars into the runtime state, then run reducer. */
const dispatch = (event: WorkerEvent) => {
  const merged: WorkerRuntimeState = {
    ...runtimeState,
    currentVideo: currentVideoInfo,
    playbackState: currentPlaybackState,
    transcriptChunkCount: currentTranscript.length,
    transcriptDebug,
    transcriptFetchLog,
    sourceCards,
    pendingClaims,
    chunksScanned,
    lastScannedTimestamp,
    currentScanPreview,
    currentScanEntities,
    currentScanActionState,
    currentScanReason,
    lastProcessedIndex,
    transcriptLoadDeadlineAt,
    pendingTranscriptBufferSummary: getPendingTranscriptBufferSummary(),
  };

  runtimeState = reduceWorkerState(merged, event);

  // Sync derived module vars from canonical state
  debugStage = runtimeState.debugStage;
  transcriptMessageStats = runtimeState.transcriptMessageStats;
  transcriptFetchLog = runtimeState.transcriptFetchLog;
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const wait = (ms: number) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/**
 * Estimate the byte size of a value when serialized to JSON.
 * This is approximate but sufficient for quota protection.
 */
const estimateByteSize = (value: unknown): number => {
  try {
    const json = JSON.stringify(value);
    // Each character in a JavaScript string is 2 bytes (UTF-16)
    // But for JSON over the wire/storage, it's typically UTF-8
    // We'll estimate conservatively at 2 bytes per char
    return json.length * 2;
  } catch {
    return Infinity;
  }
};

/**
 * Check if storing data would exceed the quota.
 * Note: This is a best-effort check - actual quota may vary by browser.
 */
const wouldExceedQuota = (data: Record<string, unknown>, quotaBytes: number): boolean => {
  const totalSize = Object.entries(data).reduce((sum, [, value]) => sum + estimateByteSize(value), 0);
  return totalSize > quotaBytes;
};

/**
 * Truncate a transcript to fit within a byte limit.
 * Keeps the most recent chunks since they're most relevant.
 */
const truncateTranscriptToFit = (
  transcript: TranscriptChunk[],
  maxBytes: number
): TranscriptChunk[] => {
  let low = 0;
  let high = transcript.length;
  
  // Binary search for the maximum number of chunks that fit
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    // Keep the most recent mid chunks
    const candidate = transcript.slice(-mid);
    if (estimateByteSize(candidate) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  
  return transcript.slice(-low);
};

const abortActiveRequests = () => {
  activeRequestControllers.forEach((controller) => controller.abort());
  activeRequestControllers.clear();
};

// Session token handling is consolidated in utils/api.ts
// IMPORTED: getSessionToken, isTransientError from './utils/api'

const buildApiHeaders = async (url: string, init: RequestInit = {}) => {
  const mergedHeaders = new Headers(init.headers);
  mergedHeaders.set('Content-Type', 'application/json');
  mergedHeaders.set('X-Extension-Id', chrome.runtime.id);

  const sessionToken = await getSessionToken();
  if (sessionToken) {
    mergedHeaders.set('Authorization', `Bearer ${sessionToken}`);
  }

  return mergedHeaders;
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS
) => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const method = (init.method || 'GET').toUpperCase();
  const bodyLength = typeof init.body === 'string' ? init.body.length : 0;
  const endpoint = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  let requestReachedNetwork = false;
  let responseStatus: number | null = null;

  try {
    const headers = await buildApiHeaders(url, init);
    activeRequestControllers.add(controller);
    timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    console.log(
      `[SourceCheck/SW] fetch start endpoint=${endpoint} method=${method} url=${url} bodyLength=${bodyLength} timeoutMs=${timeoutMs}`
    );
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    requestReachedNetwork = true;
    responseStatus = response.status;
    console.log(
      `[SourceCheck/SW] fetch success endpoint=${endpoint} method=${method} url=${url} status=${response.status}`
    );
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const aborted = error instanceof DOMException
      ? error.name === 'AbortError'
      : controller.signal.aborted;
    const fetchLogMsg = `[SourceCheck/SW] fetch failure endpoint=${endpoint} method=${method} url=${url} reachedNetwork=${requestReachedNetwork} aborted=${aborted} status=${responseStatus ?? 'none'} bodyLength=${bodyLength} error=${errorMessage}`;
    if (aborted) {
      // Intentional cancellation (AbortController) — not a real failure.
      console.log(fetchLogMsg);
    } else {
      console.error(fetchLogMsg);
    }
    throw error;
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    activeRequestControllers.delete(controller);
  }
};

const isPlaceholderMetadata = (value?: string | null) => !value || /^Unknown\b/.test(value);

const preferKnownMetadata = (currentValue: string, nextValue: string) => {
  if (!isPlaceholderMetadata(nextValue)) return nextValue;
  if (!isPlaceholderMetadata(currentValue)) return currentValue;
  return nextValue || currentValue;
};

const mergeVideoMetadata = (
  currentVideo: ActiveVideoContext,
  nextVideo: ActiveVideoContext
): ActiveVideoContext => ({
  ...currentVideo,
  title: preferKnownMetadata(currentVideo.title, nextVideo.title),
  channel: preferKnownMetadata(currentVideo.channel, nextVideo.channel),
  sourceTabId: nextVideo.sourceTabId ?? currentVideo.sourceTabId,
});

const formatPlaybackTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
};

/**
 * Sanitize any value to remove sensitive headers before logging.
 * Specifically removes x-sourcecheck-client-secret from headers objects.
 */
const sanitizeForLog = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Headers object - convert to plain object with redaction
  if (value instanceof Headers) {
    const headersObj: Record<string, string> = {};
    value.forEach((v, k) => {
      headersObj[k] = k.toLowerCase() === 'x-sourcecheck-client-secret' ? '[REDACTED]' : v;
    });
    return headersObj;
  }

  // Handle plain object with headers property
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if ('headers' in obj) {
      const sanitized = { ...obj };
      if (obj.headers instanceof Headers) {
        const headersObj: Record<string, string> = {};
        obj.headers.forEach((v, k) => {
          headersObj[k] = k.toLowerCase() === 'x-sourcecheck-client-secret' ? '[REDACTED]' : v;
        });
        sanitized.headers = headersObj;
      } else if (typeof obj.headers === 'object' && obj.headers !== null) {
        sanitized.headers = { ...(obj.headers as Record<string, string>) };
        Object.keys(sanitized.headers as Record<string, string>).forEach((k) => {
          if (k.toLowerCase() === 'x-sourcecheck-client-secret') {
            (sanitized.headers as Record<string, string>)[k] = '[REDACTED]';
          }
        });
      }
      return sanitized;
    }
  }

  return value;
};

const summarizeErrorForLog = (error: unknown): Record<string, unknown> => {
  if (error === null || error === undefined) {
    return { type: 'nullish', value: String(error) };
  }

  if (!(error instanceof Error)) {
    const sanitized = sanitizeForLog(error);
    return {
      type: typeof error,
      value: typeof sanitized === 'object' ? JSON.stringify(sanitized) : String(sanitized),
    };
  }

  const summary: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if ('code' in error && typeof error.code === 'string') {
    summary.code = error.code;
  }

  if ('status' in error && typeof error.status === 'number') {
    summary.status = error.status;
  }

  // Sanitize error properties that might contain headers
  if ('headers' in error) {
    const sanitizedHeaders = sanitizeForLog(error.headers);
    if (sanitizedHeaders !== undefined) {
      summary.headers = sanitizedHeaders;
    }
  }

  if (error.stack && typeof error.stack === 'string') {
    summary.stack = error.stack.split('\n').slice(0, 3).join(' | ');
  }

  return summary;
};

console.log(`[SourceCheck/SW] API_BASE=${API_BASE}`);

const VALID_TRANSCRIPT_DEBUG_SOURCES = new Set<TranscriptDebugSource>(['window', 'scripts', 'html', 'panel', null]);
const VALID_TRANSCRIPT_DEBUG_REASONS = new Set<TranscriptDebugReason>([
  'pending', 'caption-tracks-found', 'no-caption-tracks', 'fetch-failed',
  'response-empty', 'parse-empty', 'parse-error', 'chunks-filtered-empty',
  'all-tracks-response-empty', 'no-usable-track',
  'panel-open-button-missing', 'panel-open-click-failed', 'panel-root-present-no-segments',
  'panel-open-exhausted', 'panel-scrape-empty', 'timeout', 'loaded', null,
]);
const VALID_TRANSCRIPT_FETCH_DEBUG_SOURCES = new Set<TranscriptFetchDebugEntry['source']>(['window', 'scripts', 'html', 'panel']);
const VALID_EXTRACTION_ACTION_STATES = new Set<ExtractionActionState>(['VERIFYING', 'REJECTED', 'BUFFERING', 'PARSE_ERROR']);
const VALID_DEBUG_STAGES = new Set<DebugStage>([
  'idle', 'video_changed', 'extracting_transcript', 'transcript_status_sent',
  'batch_start_sent', 'batch_append_sent', 'transcript_loaded_sent',
  'transcript_failed_sent', 'hydrated_from_snapshot', 'processing_chunks',
]);

const sanitizeTranscriptDebug = (
  value: Partial<TranscriptDebugState> | null | undefined,
  fallback: TranscriptDebugState = transcriptDebug
): TranscriptDebugState => {
  const source = VALID_TRANSCRIPT_DEBUG_SOURCES.has(value?.source as TranscriptDebugSource)
    ? (value?.source as TranscriptDebugSource)
    : fallback.source;
  const reason = VALID_TRANSCRIPT_DEBUG_REASONS.has(value?.reason as TranscriptDebugReason)
    ? (value?.reason as TranscriptDebugReason)
    : fallback.reason;
  const attemptCount = typeof value?.attemptCount === 'number' && value.attemptCount >= 0
    ? value.attemptCount
    : fallback.attemptCount;
  return { source, reason, attemptCount };
};

const hasConcreteTranscriptFailure = (value: TranscriptDebugState) =>
  value.reason !== null &&
  value.reason !== 'pending' &&
  value.reason !== 'caption-tracks-found' &&
  value.reason !== 'loaded';

/**
 * Sanitize debug log messages to remove sensitive URL data (signed URLs, query tokens).
 * Keeps useful debugging info like hostnames and paths, removes query strings and signatures.
 */
const sanitizeDebugMessage = (message: string): string => {
  if (!message) return message;
  
  // Remove full URLs with query strings (common transcript fetch URLs contain signatures)
  // Pattern: https://.../?... or https://...?...
  let sanitized = message;
  
  // Replace YouTube transcript URLs (googlevideo.com with signatures)
  // Keep the hostname and path structure, redact query
  const googleVideoPattern = /https?:\/\/[^\s"]+googlevideo\.com[^\s"]*/gi;
  sanitized = sanitized.replace(googleVideoPattern, (match) => {
    try {
      const url = new URL(match);
      // Keep protocol, hostname, and first path segment; redact rest
      const pathParts = url.pathname.split('/').filter(Boolean);
      const shortPath = pathParts.length > 0 ? `/${pathParts[0]}/...` : '';
      return `[redacted: ${url.hostname}${shortPath}]`;
    } catch {
      return '[redacted-url]';
    }
  });
  
  // Replace any remaining URLs that might contain tokens
  const genericUrlPattern = /https?:\/\/[^\s"]+[?&](?:token|sig|signature|key|auth)=[^\s"]*/gi;
  sanitized = sanitized.replace(genericUrlPattern, '[redacted-url]');
  
  // Redact base64-like strings that could be tokens (40+ chars of base64)
  const base64TokenPattern = /[A-Za-z0-9+/]{40,}={0,2}/g;
  sanitized = sanitized.replace(base64TokenPattern, (match) => {
    // Only redact if it looks like a token (contains chars typical of signatures)
    if (/[A-Z]/.test(match) && /[a-z]/.test(match) && /\d/.test(match)) {
      return `[token:${match.slice(0, 4)}...]`;
    }
    return match;
  });
  
  return sanitized;
};

const sanitizeTranscriptFetchDebugEntry = (
  value: Partial<TranscriptFetchDebugEntry> | null | undefined,
): TranscriptFetchDebugEntry | null => {
  if (!value) return null;

  const source = VALID_TRANSCRIPT_FETCH_DEBUG_SOURCES.has(value.source as TranscriptFetchDebugEntry['source'])
    ? value.source as TranscriptFetchDebugEntry['source']
    : null;
  const step = typeof value.step === 'string' && value.step.trim()
    ? value.step.trim() as TranscriptFetchDebugEntry['step']
    : null;
  // Sanitize message to remove sensitive URL data before persistence
  const rawMessage = typeof value.message === 'string' ? value.message.trim() : '';
  const message = sanitizeDebugMessage(rawMessage);
  const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : Date.now();

  if (!source || !step || !message) {
    return null;
  }

  return { at, source, step, message };
};

const sanitizeTranscriptFetchLog = (value: unknown): TranscriptFetchDebugEntry[] =>
  Array.isArray(value)
    ? value
        .map((entry) => sanitizeTranscriptFetchDebugEntry(entry as Partial<TranscriptFetchDebugEntry>))
        .filter((entry): entry is TranscriptFetchDebugEntry => Boolean(entry))
        .slice(-MAX_TRANSCRIPT_FETCH_LOG)
    : [];

const isValidRawTranscriptChunk = (value: unknown): value is RawTranscriptChunk =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as RawTranscriptChunk).text === 'string' &&
  Number.isFinite((value as RawTranscriptChunk).startMs) &&
  Number.isFinite((value as RawTranscriptChunk).durationMs);

const getPendingTranscriptBufferSummary = (): PendingTranscriptBufferSummary => ({
  present: pendingTranscriptBuffer !== null,
  receivedCount: pendingTranscriptBuffer?.receivedBatchIndexes.size ?? 0,
  totalCount: pendingTranscriptBuffer?.totalBatches ?? 0,
});

const serializePendingTranscriptBuffer = (
  value: PendingTranscriptBuffer | null
): StoredPendingTranscriptBuffer | null => {
  if (!value) return null;
  return {
    videoId: value.videoId,
    totalChunks: value.totalChunks,
    totalBatches: value.totalBatches,
    receivedBatchIndexes: Array.from(value.receivedBatchIndexes),
    chunksByBatch: { ...value.chunksByBatch },
  };
};

const deserializePendingTranscriptBuffer = (
  value: unknown,
  expectedVideoId: string | null
): PendingTranscriptBuffer | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<StoredPendingTranscriptBuffer>;
  if (typeof raw.videoId !== 'string' || !expectedVideoId || raw.videoId !== expectedVideoId) return null;

  const rawChunksByBatch = raw.chunksByBatch && typeof raw.chunksByBatch === 'object' ? raw.chunksByBatch : {};
  const chunksByBatch: Record<number, RawTranscriptChunk[]> = {};
  for (const [rawIndex, rawBatch] of Object.entries(rawChunksByBatch)) {
    const batchIndex = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(batchIndex) || !Array.isArray(rawBatch)) continue;
    const parsedBatch = rawBatch.filter((chunk): chunk is RawTranscriptChunk => isValidRawTranscriptChunk(chunk));
    if (parsedBatch.length > 0) chunksByBatch[Math.max(0, Math.floor(batchIndex))] = parsedBatch;
  }

  const receivedBatchIndexes = Array.isArray(raw.receivedBatchIndexes)
    ? new Set(raw.receivedBatchIndexes
        .filter((index): index is number => Number.isFinite(index))
        .map((index) => Math.max(0, Math.floor(index))))
    : new Set<number>();

  return {
    videoId: raw.videoId,
    totalChunks: Number.isFinite(raw.totalChunks) ? Math.max(0, Math.floor(raw.totalChunks as number)) : 0,
    totalBatches: Number.isFinite(raw.totalBatches) ? Math.max(0, Math.floor(raw.totalBatches as number)) : 0,
    receivedBatchIndexes,
    chunksByBatch,
  };
};

const logWorkerMessage = (messageType: string, videoId: string | null | undefined, extra?: Record<string, unknown>) => {
  console.log('[SourceCheck/SW][message]', {
    messageType,
    videoId: videoId ?? currentVideoInfo?.videoId ?? null,
    lifecycle: runtimeState.lifecycle,
    debugStage,
    transcriptDebug,
    pendingTranscriptBuffer: getPendingTranscriptBufferSummary(),
    transcriptLength: currentTranscript.length,
    transcriptMessageStats,
    ...extra,
  });
};

const readTranscriptFromSnapshot = (
  snapshotValue: unknown,
  expectedVideoId: string | null
): TranscriptChunk[] => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || !expectedVideoId) return [];
  const snapshot = snapshotValue as Partial<StoredTranscriptSnapshot>;
  if (snapshot.videoId !== expectedVideoId || !Array.isArray(snapshot.transcript)) return [];
  return snapshot.transcript
    .filter((chunk): chunk is TranscriptChunk =>
      Boolean(chunk) && typeof chunk === 'object' &&
      typeof chunk.text === 'string' &&
      Number.isFinite(chunk.startTime) &&
      Number.isFinite(chunk.duration) &&
      Number.isFinite(chunk.index)
    )
    .map((chunk) => ({
      text: chunk.text,
      startTime: Math.max(0, Math.floor(chunk.startTime)),
      duration: Math.max(1, Math.floor(chunk.duration)),
      index: Math.max(0, Math.floor(chunk.index)),
    }));
};

const persistTranscriptSnapshot = (videoId: string | null, transcript: TranscriptChunk[]) => {
  if (!videoId || transcript.length === 0) {
    chrome.storage.local.remove(TRANSCRIPT_SNAPSHOT_KEY, () => {
      if (chrome.runtime.lastError) {
        console.error('[SourceCheck/SW] Failed to clear transcript snapshot:', chrome.runtime.lastError.message);
      }
    });
    return;
  }
  
  // Check quota and truncate if necessary
  const payload = { videoId, transcript } satisfies StoredTranscriptSnapshot;
  let dataToStore = payload;
  
  if (estimateByteSize(payload) > STORAGE_TRANSCRIPT_MAX_BYTES) {
    console.warn(
      `[SourceCheck/SW] Transcript size (${estimateByteSize(payload)} bytes) exceeds limit. ` +
      `Truncating to fit within ${STORAGE_TRANSCRIPT_MAX_BYTES} bytes.`
    );
    const truncatedTranscript = truncateTranscriptToFit(transcript, STORAGE_TRANSCRIPT_MAX_BYTES - 1024); // Leave headroom for metadata
    dataToStore = { videoId, transcript: truncatedTranscript };
  }
  
  // Check if we'd exceed the overall local storage quota
  if (wouldExceedQuota({ [TRANSCRIPT_SNAPSHOT_KEY]: dataToStore }, STORAGE_LOCAL_QUOTA_BYTES)) {
    console.error('[SourceCheck/SW] Cannot persist transcript: would exceed storage quota');
    return;
  }
  
  chrome.storage.local.set({
    [TRANSCRIPT_SNAPSHOT_KEY]: dataToStore,
  }, () => {
    if (chrome.runtime.lastError) {
      // Handle quota exceeded error specifically
      if (chrome.runtime.lastError.message?.includes('QUOTA')) {
        console.error('[SourceCheck/SW] Storage quota exceeded when persisting transcript');
      } else {
        console.error('[SourceCheck/SW] Failed to persist transcript snapshot:', chrome.runtime.lastError.message);
      }
    }
  });
};

const clearPendingTranscriptBufferPersistTimeout = () => {
  if (pendingTranscriptBufferPersistTimeoutId !== null) {
    globalThis.clearTimeout(pendingTranscriptBufferPersistTimeoutId);
    pendingTranscriptBufferPersistTimeoutId = null;
  }
};

const persistPendingTranscriptBufferNow = () => {
  clearPendingTranscriptBufferPersistTimeout();
  const serializedBuffer = serializePendingTranscriptBuffer(pendingTranscriptBuffer);
  if (!serializedBuffer) {
    chrome.storage.local.remove(PENDING_TRANSCRIPT_BUFFER_KEY, () => {
      if (chrome.runtime.lastError) {
        console.error('[SourceCheck/SW] Failed to clear pending transcript buffer:', chrome.runtime.lastError.message);
      }
    });
    return;
  }

  // Check if we'd exceed the overall local storage quota
  if (wouldExceedQuota({ [PENDING_TRANSCRIPT_BUFFER_KEY]: serializedBuffer }, STORAGE_LOCAL_QUOTA_BYTES)) {
    console.error('[SourceCheck/SW] Cannot persist pending buffer: would exceed storage quota');
    return;
  }

  chrome.storage.local.set({
    [PENDING_TRANSCRIPT_BUFFER_KEY]: serializedBuffer,
  }, () => {
    if (chrome.runtime.lastError) {
      if (chrome.runtime.lastError.message?.includes('QUOTA')) {
        console.error('[SourceCheck/SW] Storage quota exceeded when persisting pending buffer');
      } else {
        console.error('[SourceCheck/SW] Failed to persist pending transcript buffer:', chrome.runtime.lastError.message);
      }
    }
  });
};

const schedulePendingTranscriptBufferPersist = () => {
  if (pendingTranscriptBufferPersistTimeoutId !== null) return;
  pendingTranscriptBufferPersistTimeoutId = globalThis.setTimeout(() => {
    pendingTranscriptBufferPersistTimeoutId = null;
    persistPendingTranscriptBufferNow();
  }, PENDING_TRANSCRIPT_BUFFER_PERSIST_DELAY_MS);
};

const shouldRetryVerification = (status: number) => status === 429 || status >= 500;

const getVerificationRetryDelayMs = (retryCount: number, status?: number) =>
  (status === 429 ? 3000 : 1500) * Math.max(1, retryCount + 1);

const getEffectivePlaybackRate = () => {
  const playbackRate = currentPlaybackState?.playbackRate;
  return playbackRate && Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
};

const MAX_CHUNK_BATCH_SIZE = 24;
const MIN_CHUNK_BATCH_SIZE = 12; // Increased from 8 to ensure sufficient context
const getChunkBatchSize = () =>
  Math.min(MAX_CHUNK_BATCH_SIZE, Math.max(MIN_CHUNK_BATCH_SIZE, Math.ceil(getEffectivePlaybackRate() * 10)));

// Minimum cooldown between analyze-chunk requests to prevent backend hammering
const MIN_ANALYSIS_COOLDOWN_MS = 3000;
// Maximum concurrent analysis requests (always 1 due to isProcessing, but kept for clarity)
const MAX_CONCURRENT_ANALYSIS = 1;

const getAnalysisIntervalMs = (backlogChunks = 0) => {
  const baseIntervalMs = Math.max(8_000, Math.round(CHUNK_INTERVAL_MS / getEffectivePlaybackRate()));
  const batchSize = getChunkBatchSize();

  // When the transcript is arriving in short chunks, one pass can fall behind
  // the live playhead. Shorten the wait so the card pipeline can catch up.
  // But never go below MIN_ANALYSIS_COOLDOWN_MS to protect the backend.
  if (backlogChunks >= batchSize * 2) {
    return Math.max(MIN_ANALYSIS_COOLDOWN_MS, Math.min(baseIntervalMs, 2_000));
  }

  if (backlogChunks >= batchSize) {
    return Math.max(MIN_ANALYSIS_COOLDOWN_MS, Math.min(baseIntervalMs, 6_000));
  }

  return Math.max(MIN_ANALYSIS_COOLDOWN_MS, baseIntervalMs);
};

const getClaimKey = (claim: Pick<ExtractedClaim, 'claimText' | 'timestampSeconds'>) =>
  `${claim.timestampSeconds}:${claim.claimText.trim().toLowerCase()}`;

const getLeashCutoff = (currentTime: number | null) =>
  currentTime === null ? null : currentTime + PLAYHEAD_LEASH_SECONDS;

const isRepositioningReason = (reason: string | null) =>
  typeof reason === 'string' && reason.startsWith('Repositioning cognitive scan');

const syncVisibleTimelineState = (currentTime: number | null = currentPlaybackState?.currentTime ?? null) => {
  if (!currentTranscript.length) {
    sourceCards = [];
    pendingClaims = [];
    lastScannedTimestamp = null;
    currentScanPreview = null;
    currentScanEntities = [];
    currentScanActionState = null;
    currentScanReason = null;
    bufferedFutureScan = null;
    return;
  }

  const leashCutoff = getLeashCutoff(currentTime);
  sourceCards = leashCutoff === null
    ? [...allSourceCards]
    : allSourceCards.filter((card) => card.timestampSeconds <= leashCutoff);
  pendingClaims = leashCutoff === null
    ? [...allPendingClaims]
    : allPendingClaims.filter((claim) => claim.timestampSeconds <= leashCutoff);

  const currentIndex = getTranscriptIndexAtTime(currentTime);
  const hasLiveTranscript = currentIndex !== -1;
  const livePreview = hasLiveTranscript ? getLivePreview(currentTime) : null;

  if (
    leashCutoff !== null && currentTime !== null &&
    lastScannedTimestamp !== null && lastScannedTimestamp > leashCutoff
  ) {
    lastScannedTimestamp = currentTime;
    currentScanPreview = livePreview;
    currentScanEntities = [];
    currentScanActionState = hasLiveTranscript ? null : 'BUFFERING';
    currentScanReason = hasLiveTranscript
      ? null
      : `Repositioning cognitive scan to ${formatPlaybackTime(currentTime)}...`;
  }

  if (bufferedFutureScan && (leashCutoff === null || bufferedFutureScan.timestampSeconds <= leashCutoff)) {
    lastScannedTimestamp = bufferedFutureScan.timestampSeconds;
    currentScanEntities = bufferedFutureScan.entities;
    currentScanActionState = bufferedFutureScan.actionState;
    currentScanReason = bufferedFutureScan.reason;
    bufferedFutureScan = null;
  }

  if (hasLiveTranscript) {
    currentScanPreview = livePreview;
    if (currentTime !== null) {
      lastScannedTimestamp = currentTime;
    }

    if (isRepositioningReason(currentScanReason)) {
      currentScanActionState = null;
      currentScanReason = null;
    }
  }
};

const hasCardForClaim = (claim: Pick<ExtractedClaim, 'claimText' | 'timestampSeconds'>) => {
  const key = getClaimKey(claim);
  return allSourceCards.some((card) => getClaimKey(card.claim) === key);
};

const hasPendingClaim = (claim: Pick<ExtractedClaim, 'claimText' | 'timestampSeconds'>) => {
  const key = getClaimKey(claim);
  return allPendingClaims.some((pendingClaim) => pendingClaim.id === key);
};

const hasQueuedVerificationForKey = (key: string) =>
  verificationQueue.some((item) => item.key === key);

// Near-duplicate detection: check if a very similar claim was recently checked
// Uses semantic embeddings when available, falls back to normalized text comparison
// PERFORMANCE: normalized text is cached in PendingClaimPreview to avoid repeated regex work
const getNormalizedClaimText = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Calculate cosine similarity between two embedding vectors
// Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }
  
  return dotProduct / (magnitudeA * magnitudeB);
};

// Semantic similarity threshold for near-duplicate detection
const SEMANTIC_SIMILARITY_THRESHOLD = 0.88;

const isNearDuplicate = (claim: ExtractedClaim): boolean => {
  const DUPLICATE_WINDOW_SECONDS = 120; // 2 minutes
  
  // Check for semantic similarity using embeddings first
  if (claim.embedding && claim.embedding.length > 0) {
    // Check existing source cards with embeddings
    const semanticCardMatch = allSourceCards.find((card) => {
      const timeDiff = Math.abs(card.claim.timestampSeconds - claim.timestampSeconds);
      if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
      // Only compare if both have embeddings
      if (!card.claim.embedding || card.claim.embedding.length === 0) return false;
      const similarity = cosineSimilarity(claim.embedding!, card.claim.embedding);
      return similarity > SEMANTIC_SIMILARITY_THRESHOLD;
    });
    if (semanticCardMatch) return true;

    // Check pending claims with embeddings
    const semanticPendingMatch = allPendingClaims.find((pending) => {
      const timeDiff = Math.abs(pending.timestampSeconds - claim.timestampSeconds);
      if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
      // Pending claims don't have embeddings yet, skip semantic check
      return false;
    });
    if (semanticPendingMatch) return true;

    // Check verification queue with embeddings
    const semanticQueuedMatch = verificationQueue.find((item) => {
      const timeDiff = Math.abs(item.claim.timestampSeconds - claim.timestampSeconds);
      if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
      // Only compare if both have embeddings
      if (!item.claim.embedding || item.claim.embedding.length === 0) return false;
      const similarity = cosineSimilarity(claim.embedding!, item.claim.embedding);
      return similarity > SEMANTIC_SIMILARITY_THRESHOLD;
    });
    if (semanticQueuedMatch) return true;
  }
  
  // Fallback to character-based heuristic for claims without embeddings
  // or when semantic check didn't find a match
  const normalizedClaimText = getNormalizedClaimText(claim.claimText);

  // Helper to check similarity - shared 80%+ of normalized text
  const isSimilar = (normalizedOther: string): boolean => {
    const longer = Math.max(normalizedClaimText.length, normalizedOther.length);
    const shorter = Math.min(normalizedClaimText.length, normalizedOther.length);
    return shorter > 0 && (shorter / longer) > 0.8;
  };

  // Check existing source cards (bounded to MAX_SOURCE_CARDS = 20)
  const recentCard = allSourceCards.find((card) => {
    const timeDiff = Math.abs(card.claim.timestampSeconds - claim.timestampSeconds);
    if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
    const normalizedCardText = getNormalizedClaimText(card.claim.claimText);
    return isSimilar(normalizedCardText);
  });
  if (recentCard) return true;

  // Check pending claims (bounded to MAX_PENDING_CLAIMS = 100)
  // Uses cached normalized text if available for performance
  const recentPending = allPendingClaims.find((pending) => {
    const timeDiff = Math.abs(pending.timestampSeconds - claim.timestampSeconds);
    if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
    const normalizedPendingText = pending.normalizedClaimText ??
      getNormalizedClaimText(pending.claimText);
    return isSimilar(normalizedPendingText);
  });
  if (recentPending) return true;

  // Check verification queue (bounded to MAX_VERIFICATION_QUEUE = 50)
  const recentQueued = verificationQueue.find((item) => {
    const timeDiff = Math.abs(item.claim.timestampSeconds - claim.timestampSeconds);
    if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
    const normalizedQueuedText = getNormalizedClaimText(item.claim.claimText);
    return isSimilar(normalizedQueuedText);
  });

  return !!recentQueued;
};

const logAnalysisResult = (
  videoId: string,
  startIndex: number,
  endIndex: number,
  chunks: TranscriptChunk[],
  extraction: AnalyzeChunkResponse,
) => {
  console.log(
    `[SourceCheck/SW] analyze result video=${videoId} chunkRange=${startIndex}-${endIndex} ` +
    `chunkCount=${chunks.length} has_claim=${extraction.has_claim} ` +
    `action_state=${extraction.action_state} claimCount=${extraction.claims.length}`
  );
};

const getVerificationSkipReason = (claim: ExtractedClaim) => {
  const key = getClaimKey(claim);

  // --- 1. Basic structural filters ---
  const claimWords = claim.claimText.trim().split(/\s+/).length;
  
  // Too short to be meaningful (less than 3 words is definitely a fragment)
  if (claimWords < 3) {
    return `claim too short (${claimWords} words)`;
  }

  // --- 2. Specificity / concreteness detection ---
  // A verifiable claim needs concrete references. We detect:
  // - Numbers (counts, percentages, dates)
  // - Named months
  // - Proper noun entities (capitalized words that aren't sentence-start)
  // - Specific organization keywords
  // - Units of measurement
  const hasNumber = /\d+/.test(claim.claimText);
  const hasMonth = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(claim.claimText);
  const hasProperNounEntity = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/.test(claim.claimText);
  const hasOrgKeyword = /\b(?:University|Institute|Center|Study|Research|Organization|NASA|WHO|CDC|FDA|UN|MIT|Harvard|Stanford)\b/i.test(claim.claimText);
  const hasUnit = /\b(?:percent|%|degrees|meters|kilometers|kg|mg|ml|years?|months?|days?|hours?)\b/i.test(claim.claimText);
  
  const isConcrete = hasNumber || hasMonth || (hasProperNounEntity && claimWords >= 4) || hasOrgKeyword || hasUnit;
  
  // Short claims (< 5 words) must be highly concrete to pass
  if (claimWords < 5 && !isConcrete) {
    return 'short claim lacks concrete specificity';
  }
  
  // Medium claims (5-7 words) need at least some concreteness
  if (claimWords >= 5 && claimWords <= 7 && !isConcrete && claim.claimText.length < 30) {
    return 'claim lacks sufficient specificity for verification';
  }

  // --- 3. Vagueness / opinion pattern detection ---
  // Reject opinion markers, predictions, vague generalizations even if long
  const lowerText = claim.claimText.toLowerCase();
  const hasOpinionMarker = /\b(i think|i believe|in my opinion|obviously|clearly|definitely|probably|maybe|seems like|feels like)\b/i.test(lowerText);
  const hasPredictionMarker = /\b(will|going to|predict|future|soon|eventually|next year|coming years)\b/i.test(lowerText);
  const hasVagueGeneralization = /\b(very|really|quite|extremely|incredibly|transformative|important|significant|crucial|essential)\b/i.test(lowerText);
  const lacksSpecificSubject = !/[A-Z]/.test(claim.claimText.slice(1)); // No proper nouns at all
  
  // Long but vague claims should be rejected
  if (claimWords > 10 && hasVagueGeneralization && !isConcrete) {
    return 'vague generalization without concrete specifics';
  }
  
  // Opinion claims
  if (hasOpinionMarker) {
    return 'opinion statement not suitable for fact-checking';
  }
  
  // Predictions about future
  if (hasPredictionMarker && !hasNumber) {
    return 'prediction about future events';
  }

  // --- 4. Confidence threshold (using actual backend confidence) ---
  // Backend confidence is inferred by claim type (0.75-0.92)
  // MIN_CONFIDENCE is 0.65, so this is effectively a no-op for normal claims
  // We keep it as a safety floor for malformed data
  if (claim.confidence < MIN_CONFIDENCE) {
    return `confidence ${claim.confidence.toFixed(2)} below threshold ${MIN_CONFIDENCE.toFixed(2)}`;
  }

  // --- 5. Duplicate detection ---
  if (hasCardForClaim(claim)) {
    return 'matching source card already exists';
  }

  if (hasQueuedVerificationForKey(key) || activeVerificationKeys.has(key)) {
    return 'claim already queued or verifying';
  }
  
  // Near-duplicate check for similar claims within time window
  if (isNearDuplicate(claim)) {
    return 'similar claim recently checked';
  }

  if (hasPendingClaim(claim)) {
    removePendingClaimByKey(key);
    console.warn(
      `[SourceCheck/SW] cleared orphaned pending claim before enqueue key=${key} ` +
      `timestamp=${claim.timestampSeconds}`
    );
  }

  return null;
};

const upsertPendingClaim = (claim: ExtractedClaim, state: PendingClaimPreview['state']) => {
  const key = getClaimKey(claim);
  // PERFORMANCE: Cache normalized text to avoid repeated regex in isNearDuplicate
  const normalizedClaimText = getNormalizedClaimText(claim.claimText);
  const nextPreview: PendingClaimPreview = {
    id: key, claimText: claim.claimText, claimType: claim.claimType,
    timestampSeconds: claim.timestampSeconds, confidence: claim.confidence, state,
    normalizedClaimText,
  };
  const existingIndex = allPendingClaims.findIndex((pendingClaim) => pendingClaim.id === key);
  if (existingIndex === -1) {
    allPendingClaims = [nextPreview, ...allPendingClaims].slice(0, MAX_PENDING_CLAIMS);
    syncVisibleTimelineState();
    return;
  }
  allPendingClaims = allPendingClaims.map((pendingClaim, index) =>
    index === existingIndex ? nextPreview : pendingClaim
  );
  syncVisibleTimelineState();
};

const removePendingClaimByKey = (key: string) => {
  allPendingClaims = allPendingClaims.filter((pendingClaim) => pendingClaim.id !== key);
  syncVisibleTimelineState();
};

const clearTranscriptLoadTimeout = () => {
  if (transcriptLoadTimeoutId !== null) {
    globalThis.clearTimeout(transcriptLoadTimeoutId);
    transcriptLoadTimeoutId = null;
  }
};

const markTranscriptUnavailable = () => {
  clearTranscriptLoadTimeout();
  transcriptLoadDeadlineAt = null;
  pendingTranscriptBuffer = null;
  persistPendingTranscriptBufferNow();
  currentTranscript = [];
  
  // Log transcript failure for observability
  if (!hasConcreteTranscriptFailure(transcriptDebug)) {
    transcriptDebug = { ...transcriptDebug, reason: 'timeout' };
    logTranscriptFailure({
      category: 'transcript_unavailable',
      context: 'timeout',
    });
  } else if (transcriptDebug.reason) {
    const failureCategory: 'transcript_fetch_failed' | 'transcript_unavailable' | 'transcript_parse_failed' =
      transcriptDebug.reason === 'fetch-failed' ? 'transcript_fetch_failed' :
      transcriptDebug.reason === 'parse-error' || transcriptDebug.reason === 'parse-threw' ? 'transcript_parse_failed' :
      'transcript_unavailable';
    
    logTranscriptFailure({
      category: failureCategory,
      source: transcriptDebug.source ?? undefined,
      context: transcriptDebug.reason,
    });
  }
  
  currentScanPreview = null;
  currentScanEntities = [];
  currentScanActionState = null;
  currentScanReason = null;
  // Explicitly clear the persisted transcript snapshot so the sidepanel
  // cannot keep using stale transcript context (e.g. keeping Ask enabled)
  // after a transcript failure for the same video.
  chrome.storage.local.remove('transcriptSnapshot', () => {
    if (chrome.runtime.lastError) {
      console.error('[SourceCheck/SW] Failed to clear transcript snapshot:', chrome.runtime.lastError.message);
    }
  });
  dispatch({ type: 'TRANSCRIPT_FAILED', debug: transcriptDebug });
};

const scheduleTranscriptLoadTimeout = () => {
  clearTranscriptLoadTimeout();
  if (!currentVideoInfo || currentTranscript.length > 0 || transcriptLoadDeadlineAt === null) return;

  const remainingMs = transcriptLoadDeadlineAt - Date.now();
  if (remainingMs <= 0) {
    if (applyTranscriptLoadTimeout()) persistPanelState({ includeQueue: true });
    return;
  }

  transcriptLoadTimeoutId = globalThis.setTimeout(() => {
    transcriptLoadTimeoutId = null;
    if (applyTranscriptLoadTimeout()) persistPanelState({ includeQueue: true });
  }, remainingMs);
};

const applyTranscriptLoadTimeout = () => {
  if (
    !currentVideoInfo || currentTranscript.length > 0 ||
    transcriptLoadDeadlineAt === null || Date.now() < transcriptLoadDeadlineAt
  ) return false;
  markTranscriptUnavailable();
  return true;
};

const resetSessionState = (nextVideo: ActiveVideoContext | null) => {
  abortActiveRequests();
  clearTranscriptLoadTimeout();
  clearPendingTranscriptBufferPersistTimeout();
  currentVideoInfo = nextVideo;
  currentTranscript = [];
  currentPlaybackState = null;
  allSourceCards = [];
  sourceCards = [];
  allPendingClaims = [];
  pendingClaims = [];
  lastProcessedIndex = -1;
  chunksScanned = 0;
  lastScannedTimestamp = null;
  currentScanPreview = null;
  currentScanEntities = [];
  currentScanActionState = null;
  currentScanReason = null;
  bufferedFutureScan = null;
  verificationQueue = [];
  activeVerificationKeys = new Set<string>();
  isProcessing = false;
  isVerifying = false;
  lastAnalyzedAt = 0;
  processingGeneration += 1;
  verificationGeneration += 1;
  pendingTranscriptBuffer = null;
  persistPendingTranscriptBufferNow();
  transcriptLoadDeadlineAt = nextVideo ? Date.now() + TRANSCRIPT_LOAD_TIMEOUT_MS : null;
  transcriptDebug = nextVideo
    ? { source: null, reason: 'pending', attemptCount: 0 }
    : { source: null, reason: null, attemptCount: 0 };
  transcriptFetchLog = [];

  if (nextVideo) {
    dispatch({ type: 'VIDEO_CHANGED', videoId: nextVideo.videoId, title: nextVideo.title, channel: nextVideo.channel });
  } else {
    dispatch({ type: 'VIDEO_CLEARED' });
  }

  persistTranscriptSnapshot(null, []);
  scheduleTranscriptLoadTimeout();
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

const persistPanelState = (options: {
  includeTranscript?: boolean;
  includeCards?: boolean;
  includeQueue?: boolean;
} = {}) => {
  // Sync all current module state into runtimeState before persisting
  runtimeState = {
    ...runtimeState,
    currentVideo: currentVideoInfo,
    playbackState: currentPlaybackState,
    transcriptChunkCount: currentTranscript.length,
    transcriptDebug,
    transcriptFetchLog,
    sourceCards,
    pendingClaims,
    chunksScanned,
    lastScannedTimestamp,
    currentScanPreview,
    currentScanEntities,
    currentScanActionState,
    currentScanReason,
    lastProcessedIndex,
    transcriptLoadDeadlineAt,
    pendingTranscriptBufferSummary: getPendingTranscriptBufferSummary(),
    debugStage,
    transcriptMessageStats,
  };

  const payload: Record<string, unknown> = {
    [WORKER_RUNTIME_STATE_KEY]: runtimeState,
    // Keep compat fields for hydration of processing state
    sourceCards,
    pendingClaims,
    allSourceCards,
    allPendingClaims,
    transcriptFetchLog,
  };

  if (options.includeTranscript) {
    persistTranscriptSnapshot(currentVideoInfo?.videoId ?? null, currentTranscript);
    payload.transcript = null;
  }

  if (options.includeQueue) {
    payload.pendingVerifications = verificationQueue;
  }

  // Check if payload would exceed session storage quota
  if (wouldExceedQuota(payload, STORAGE_SESSION_QUOTA_BYTES)) {
    console.warn('[SourceCheck/SW] Panel state payload too large, truncating...');
    
    // Remove heavy fields that can be reconstructed
    delete payload.allSourceCards;
    delete payload.allPendingClaims;
    delete payload.transcriptFetchLog;
    
    // If still too large, reduce card counts
    if (wouldExceedQuota(payload, STORAGE_SESSION_QUOTA_BYTES)) {
      payload.sourceCards = (payload.sourceCards as SourceCard[]).slice(0, 50);
      payload.pendingClaims = (payload.pendingClaims as PendingClaimPreview[]).slice(0, 30);
    }
    
    // If STILL too large, only persist core runtime state
    if (wouldExceedQuota(payload, STORAGE_SESSION_QUOTA_BYTES)) {
      console.error('[SourceCheck/SW] Cannot persist full panel state: even truncated payload exceeds quota');
      // Only persist the minimal runtime state
      const minimalPayload = {
        [WORKER_RUNTIME_STATE_KEY]: runtimeState,
      };
      chrome.storage.session.set(minimalPayload, () => {
        if (chrome.runtime.lastError) {
          console.error('[SourceCheck/SW] Failed to persist minimal panel state:', chrome.runtime.lastError.message);
        }
      });
      return;
    }
  }

  chrome.storage.session.set(payload, () => {
    if (chrome.runtime.lastError) {
      if (chrome.runtime.lastError.message?.includes('QUOTA')) {
        console.error('[SourceCheck/SW] Storage quota exceeded when persisting panel state');
      } else {
        console.error('[SourceCheck/SW] Failed to persist panel state:', chrome.runtime.lastError.message);
      }
    } else {
      console.log('[Pipeline] State persisted:', {
        sourceCardsCount: sourceCards.length,
        pendingClaimsCount: pendingClaims.length,
        lifecycle: runtimeState.lifecycle,
        chunksScanned: runtimeState.chunksScanned,
      });
    }
  });
};

const persistPanelDiagnostics = () => {
  runtimeState = {
    ...runtimeState,
    pendingTranscriptBufferSummary: getPendingTranscriptBufferSummary(),
    debugStage,
    transcriptMessageStats,
    transcriptFetchLog,
  };
  chrome.storage.session.set({
    [WORKER_RUNTIME_STATE_KEY]: runtimeState,
    transcriptFetchLog,
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('[SourceCheck/SW] Failed to persist diagnostics:', chrome.runtime.lastError.message);
    } else {
      console.log('[SourceCheck/SW] persisted transcriptFetchLog entries', transcriptFetchLog.length);
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// HYDRATION
// ─────────────────────────────────────────────────────────────────────────────

const hydrateState = async () => {
  if (hasHydratedState) return;
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = Promise.all([
    chrome.storage.session.get([
      WORKER_RUNTIME_STATE_KEY,
      // compat fields for processing state not in WorkerRuntimeState
      'allSourceCards', 'allPendingClaims',
      'transcriptFetchLog',
      'pendingTranscriptBuffer', 'pendingVerifications',
    ]),
    chrome.storage.local.get([TRANSCRIPT_SNAPSHOT_KEY, PENDING_TRANSCRIPT_BUFFER_KEY]),
    chrome.storage.sync.get(['selectedModel']),
  ])
    .then(([stored, localStored, syncStored]) => {
      const storedRuntime = stored[WORKER_RUNTIME_STATE_KEY] as Partial<WorkerRuntimeState> | null | undefined;
      const syncSelectedModel = syncStored?.selectedModel as string | undefined;

      // Restore canonical state from stored WorkerRuntimeState
      if (storedRuntime && typeof storedRuntime === 'object') {
        currentVideoInfo = storedRuntime.currentVideo ?? null;
        currentPlaybackState = storedRuntime.playbackState ?? null;
        chunksScanned = storedRuntime.chunksScanned ?? 0;
        lastScannedTimestamp = storedRuntime.lastScannedTimestamp ?? null;
        currentScanPreview = storedRuntime.currentScanPreview ?? null;
        currentScanEntities = Array.isArray(storedRuntime.currentScanEntities) ? storedRuntime.currentScanEntities : [];
        currentScanActionState = VALID_EXTRACTION_ACTION_STATES.has(storedRuntime.currentScanActionState as ExtractionActionState)
          ? storedRuntime.currentScanActionState as ExtractionActionState
          : null;
        currentScanReason = typeof storedRuntime.currentScanReason === 'string' ? storedRuntime.currentScanReason : null;
        lastProcessedIndex = typeof storedRuntime.lastProcessedIndex === 'number' ? storedRuntime.lastProcessedIndex : -1;
        transcriptLoadDeadlineAt = typeof storedRuntime.transcriptLoadDeadlineAt === 'number'
          ? storedRuntime.transcriptLoadDeadlineAt
          : null;
        transcriptDebug = sanitizeTranscriptDebug(storedRuntime.transcriptDebug ?? null, transcriptDebug);
        const runtimeFetchLog = sanitizeTranscriptFetchLog(storedRuntime.transcriptFetchLog);
        const compatFetchLog = sanitizeTranscriptFetchLog(stored.transcriptFetchLog);
        transcriptFetchLog = runtimeFetchLog.length > 0 ? runtimeFetchLog : compatFetchLog;

        runtimeState = {
          ...INITIAL_RUNTIME_STATE,
          ...storedRuntime,
          // Restore only known lifecycle values
          lifecycle: ([
            'idle', 'video_detected', 'playback_ready', 'extracting_transcript',
            'transcript_buffering', 'transcript_loaded', 'transcript_unavailable',
            'analyzing', 'verifying', 'ready', 'error',
          ] as WorkerLifecycle[]).includes(storedRuntime.lifecycle as WorkerLifecycle)
            ? storedRuntime.lifecycle as WorkerLifecycle
            : 'idle',
          debugStage: VALID_DEBUG_STAGES.has(storedRuntime.debugStage as DebugStage)
            ? storedRuntime.debugStage as DebugStage
            : 'idle',
          eventLog: Array.isArray(storedRuntime.eventLog) ? storedRuntime.eventLog : [],
          transcriptFetchLog,
          transcriptMessageStats: storedRuntime.transcriptMessageStats ?? INITIAL_RUNTIME_STATE.transcriptMessageStats,
          pendingTranscriptBufferSummary: storedRuntime.pendingTranscriptBufferSummary ?? INITIAL_RUNTIME_STATE.pendingTranscriptBufferSummary,
          // Restore selectedModel from sync storage if not in session
          // Validate against allowed models to prevent corrupted values
          selectedModel: (() => {
            // MODEL POLICY: All valid models must be from ALLOWED_MODELS in shared/types.ts
const VALID_MODELS: GeminiModelOption[] = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-preview'];
            const model = storedRuntime.selectedModel ?? syncSelectedModel ?? INITIAL_RUNTIME_STATE.selectedModel;
            return (VALID_MODELS.includes(model as GeminiModelOption) ? model : INITIAL_RUNTIME_STATE.selectedModel) as GeminiModelOption;
          })(),
        };

        debugStage = runtimeState.debugStage;
        transcriptMessageStats = runtimeState.transcriptMessageStats;
      }

      // Restore processing state (allSourceCards, allPendingClaims, etc.)
      allSourceCards = Array.isArray(stored.allSourceCards) ? stored.allSourceCards
        : (Array.isArray(stored.sourceCards) ? stored.sourceCards : allSourceCards);
      allPendingClaims = Array.isArray(stored.allPendingClaims) ? stored.allPendingClaims
        : (Array.isArray(stored.pendingClaims) ? stored.pendingClaims : allPendingClaims);
      pendingTranscriptBuffer = deserializePendingTranscriptBuffer(
        localStored[PENDING_TRANSCRIPT_BUFFER_KEY] ?? stored.pendingTranscriptBuffer,
        currentVideoInfo?.videoId ?? null
      );
      bufferedFutureScan = null;
      verificationQueue = Array.isArray(stored.pendingVerifications)
        ? stored.pendingVerifications.map((item: Partial<VerificationQueueItem>) => ({
            ...item, retryCount: typeof item.retryCount === 'number' ? item.retryCount : 0,
          })) as VerificationQueueItem[]
        : verificationQueue;

      // Try to restore transcript from local snapshot
      const hydratedTranscriptFromSnapshot = readTranscriptFromSnapshot(
        localStored[TRANSCRIPT_SNAPSHOT_KEY], currentVideoInfo?.videoId ?? null
      );
      if (hydratedTranscriptFromSnapshot.length > 0) {
        currentTranscript = hydratedTranscriptFromSnapshot;
        dispatch({ type: 'HYDRATED_FROM_SNAPSHOT', chunkCount: currentTranscript.length });
      }

      syncVisibleTimelineState(currentPlaybackState?.currentTime ?? null);

      // If lifecycle is still loading-equivalent but deadline passed, fail transcript
      if (
        runtimeState.lifecycle !== 'transcript_unavailable' &&
        runtimeState.lifecycle !== 'error' &&
        runtimeState.lifecycle !== 'idle' &&
        currentTranscript.length === 0 &&
        currentVideoInfo
      ) {
        if (transcriptLoadDeadlineAt === null) {
          transcriptLoadDeadlineAt = Date.now() + TRANSCRIPT_LOAD_TIMEOUT_MS;
        }
        scheduleTranscriptLoadTimeout();
      }

      hasHydratedState = true;
      persistPanelState({ includeCards: true });

      if (verificationQueue.length > 0) {
        void processVerificationQueue().catch((err) => console.error('[SW] processVerificationQueue error:', err));
      }
    })
    .finally(() => {
      hydrationPromise = null;
    });

  return hydrationPromise;
};

// ─────────────────────────────────────────────────────────────────────────────
// PROCESSING LOGIC
// ─────────────────────────────────────────────────────────────────────────────

const enqueueClaimsForVerification = (claims: AnalyzeChunkResponse['claims']) => {
  const video = currentVideoInfo;
  if (!video) return;

  let didQueueClaims = false;
  claims.forEach((claim) => {
    const key = getClaimKey(claim);
    const skipReason = getVerificationSkipReason(claim);
    if (skipReason) {
      console.warn(
        `[SourceCheck/SW] skipped verification handoff video=${video.videoId} ` +
        `chunkTimestamp=${claim.timestampSeconds} has_claim=true action_state=VERIFYING ` +
        `reason=${skipReason}`
      );
      return;
    }

    console.log(
      `[SourceCheck/SW] entered verification handoff video=${video.videoId} ` +
      `chunkTimestamp=${claim.timestampSeconds} has_claim=true action_state=VERIFYING`
    );
    // Prevent unbounded queue growth - drop oldest if at capacity
    if (verificationQueue.length >= MAX_VERIFICATION_QUEUE) {
      const dropped = verificationQueue.shift();
      if (dropped) {
        activeVerificationKeys.delete(dropped.key);
        removePendingClaimByKey(dropped.key);
        console.warn('[SourceCheck/SW] Verification queue at capacity, dropped oldest item');
      }
    }
    verificationQueue.push({ claim, videoId: video.videoId, videoTitle: video.title, channelName: video.channel, key, retryCount: 0 });
    upsertPendingClaim(claim, 'queued');
    didQueueClaims = true;
  });

  dispatch({ type: 'ANALYZE_COMPLETED', claimCount: didQueueClaims ? claims.length : 0 });
  persistPanelState({ includeCards: true, includeQueue: true });

  if (didQueueClaims) void processVerificationQueue().catch((err) => console.error('[SW] processVerificationQueue error:', err));
};

const retryVerificationItem = async (
  item: VerificationQueueItem,
  runGeneration: number,
  status?: number
) => {
  if (item.retryCount >= MAX_VERIFICATION_RETRIES) {
    removePendingClaimByKey(item.key);
    dispatch({ type: 'VERIFY_COMPLETED' });
    persistPanelState({ includeCards: true, includeQueue: true });
    return false;
  }

  upsertPendingClaim(item.claim, 'queued');
  dispatch({ type: 'VERIFY_STARTED', claimText: item.claim.claimText });
  persistPanelState({ includeCards: true, includeQueue: true });

  await wait(getVerificationRetryDelayMs(item.retryCount, status));

  if (runGeneration !== verificationGeneration || currentVideoInfo?.videoId !== item.videoId) return false;

  // Prevent unbounded queue growth on retries - drop oldest if at capacity
  if (verificationQueue.length >= MAX_VERIFICATION_QUEUE) {
    const dropped = verificationQueue.shift();
    if (dropped) {
      activeVerificationKeys.delete(dropped.key);
      console.warn('[SourceCheck/SW] Verification queue at capacity (retry), dropped oldest item');
    }
  }
  verificationQueue.push({ ...item, retryCount: item.retryCount + 1 });
  persistPanelState({ includeCards: true, includeQueue: true });
  return true;
};

const verifyOneItem = async (item: VerificationQueueItem, runGeneration: number): Promise<void> => {
  if (currentVideoInfo?.videoId !== item.videoId) {
    console.warn(
      `[SourceCheck/SW] skipped verification because video changed before start video=${item.videoId} ` +
      `timestamp=${item.claim.timestampSeconds}`
    );
    removePendingClaimByKey(item.key);
    dispatch({ type: 'VERIFY_COMPLETED' });
    persistPanelState({ includeCards: true, includeQueue: true });
    return;
  }

  if (hasCardForClaim(item.claim)) {
    console.warn(
      `[SourceCheck/SW] skipped verification because card already exists video=${item.videoId} ` +
      `timestamp=${item.claim.timestampSeconds}`
    );
    removePendingClaimByKey(item.key);
    dispatch({ type: 'VERIFY_COMPLETED' });
    persistPanelState({ includeCards: true, includeQueue: true });
    return;
  }

  activeVerificationKeys.add(item.key);
  upsertPendingClaim(item.claim, 'verifying');
  dispatch({ type: 'VERIFY_STARTED', claimText: item.claim.claimText });
  persistPanelState({ includeCards: true, includeQueue: true });

  try {
    console.log(
      `[SourceCheck/SW] verification started video=${item.videoId} ` +
      `timestamp=${item.claim.timestampSeconds}`
    );
    console.log(
      `[SourceCheck/SW] verify-claim request video=${item.videoId} endpoint=${API_BASE}/api/verify-claim timestamp=${item.claim.timestampSeconds}`
    );
    // Gather surrounding transcript context for better verification
    // Get chunks within 30 seconds of the claim timestamp
    const contextWindowSeconds = 30;
    const contextChunks = currentTranscript.filter(
      (chunk) => Math.abs(chunk.startTime - item.claim.timestampSeconds) <= contextWindowSeconds
    );
    const contextTranscript = contextChunks
      .sort((a, b) => a.startTime - b.startTime)
      .map((c) => c.text)
      .join(' ');

    const { sourceCard } = await fetchWithBYOK('/api/verify-claim', {
      claim: item.claim, 
      videoTitle: item.videoTitle, 
      channelName: item.channelName,
      model: runtimeState.selectedModel,
      contextTranscript: contextTranscript || undefined,
    }) as VerifyClaimResponse;
    console.log(
      `[SourceCheck/SW] verify-claim success video=${item.videoId} card=${sourceCard.status}`
    );

    if (runGeneration !== verificationGeneration || currentVideoInfo?.videoId !== item.videoId) {
      console.warn(
        `[SourceCheck/SW] skipped verification finish because session changed video=${item.videoId} ` +
        `timestamp=${item.claim.timestampSeconds}`
      );
      return;
    }
    if (runGeneration !== verificationGeneration || currentVideoInfo?.videoId !== item.videoId) {
      console.warn(
        `[SourceCheck/SW] skipped card insert because session changed video=${item.videoId} ` +
        `timestamp=${item.claim.timestampSeconds}`
      );
      return;
    }

    removePendingClaimByKey(item.key);
    if (!hasCardForClaim(sourceCard.claim)) {
      allSourceCards = [sourceCard, ...allSourceCards].slice(0, MAX_SOURCE_CARDS);
    }

    syncVisibleTimelineState(currentPlaybackState?.currentTime ?? null);
    dispatch({ type: 'VERIFY_COMPLETED' });
    persistPanelState({ includeCards: true, includeQueue: true });
  } catch (error) {
    if (runGeneration !== verificationGeneration || currentVideoInfo?.videoId !== item.videoId) {
      console.warn(
        `[SourceCheck/SW] skipped verification retry because session changed video=${item.videoId} ` +
        `timestamp=${item.claim.timestampSeconds}`
      );
      return;
    }
    
    // UNIFIED ERROR CLASSIFICATION: All errors flow through classifyError for consistency
    const errorCode = (error as Error & { errorCode?: string }).errorCode;
    const errorStatus = (error as Error & { status?: number }).status;
    const classifiedError = classifyError(error, { 
      errorCode, 
      status: errorStatus,
      url: '/api/verify-claim'
    });
    
    // Check if this is a non-retryable error using shared classification
    const isNonRetryable = !classifiedError.retryable;
    
    // Only retry if it's a potentially transient error
    if (!isNonRetryable) {
      if (await retryVerificationItem(item, runGeneration, 500)) {
        console.warn('[SourceCheck/SW] Verification queue error, retrying.', summarizeErrorForLog(error));
        return;
      }
    }
    
    if (runGeneration !== verificationGeneration || currentVideoInfo?.videoId !== item.videoId) return;
    console.error('[SourceCheck/SW] Verification queue error after retries:', summarizeErrorForLog(error));
    
    // Log retry exhaustion for observability (uses canonical classification)
    logRetryExhausted({
      category: classifiedError.code === 'QUOTA_EXHAUSTED' ? 'provider_quota_exhausted' 
        : classifiedError.code === 'AUTH_ERROR' || classifiedError.code === 'INVALID_API_KEY' ? 'provider_auth_error'
        : classifiedError.code === 'RATE_LIMITED' ? 'rate_limited'
        : 'verify_failed',
      route: '/api/verify-claim',
      attempts: MAX_VERIFICATION_RETRIES + 1,
      context: classifiedError.code,
    });
    
    // Broadcast error to sidepanel for unified UI handling (fire-and-forget, has internal try-catch)
    void broadcastProviderError(classifiedError).catch(() => {});
    
    // Use classified error for user-facing messages (consistent across all paths)
    const errorTitle = classifiedError.code === 'QUOTA_EXHAUSTED' ? 'API quota exhausted'
      : classifiedError.code === 'AUTH_ERROR' || classifiedError.code === 'INVALID_API_KEY' ? 'API key invalid'
      : classifiedError.code === 'RATE_LIMITED' ? 'Rate limited'
      : classifiedError.code === 'NETWORK_ERROR' ? 'Network error'
      : 'Check failed';
    
    const errorNuance = classifiedError.message;
    
    // Check if we already have a failure card for this claim to avoid duplicates
    const existingFailureCard = allSourceCards.find(
      (card) => card.claim.timestampSeconds === item.claim.timestampSeconds && 
                card.status === 'unverifiable' &&
                (card.sourceTitle === 'Check failed' || card.sourceTitle === 'API quota exhausted' ||
                 card.sourceTitle === 'API key invalid' || card.sourceTitle === 'Rate limited')
    );
    
    if (!existingFailureCard) {
      // Create a failed verification card so users see the error, not a silent failure
      const errorCard: SourceCard = {
        id: crypto.randomUUID(),
        claim: item.claim,
        status: 'unverifiable',
        sourceTitle: errorTitle,
        sourceUrl: '',
        sourceType: 'other',
        nuance: errorNuance,
        timestampSeconds: item.claim.timestampSeconds,
        verifiedAt: new Date().toISOString(),
      };
      
      removePendingClaimByKey(item.key);
      if (!hasCardForClaim(item.claim)) {
        allSourceCards = [errorCard, ...allSourceCards].slice(0, MAX_SOURCE_CARDS);
      }
    } else {
      removePendingClaimByKey(item.key);
    }
    
    dispatch({ type: 'VERIFY_COMPLETED' });
    persistPanelState({ includeCards: true, includeQueue: true });
  } finally {
    activeVerificationKeys.delete(item.key);
    console.log(
      `[SourceCheck/SW] verification finished video=${item.videoId} ` +
      `timestamp=${item.claim.timestampSeconds}`
    );
  }
};

const processVerificationQueue = async () => {
  if (isVerifying) {
    console.log(
      `[SourceCheck/SW] verification queue already running queued=${verificationQueue.length} active=${activeVerificationKeys.size}`
    );
    return;
  }
  const runGeneration = verificationGeneration;
  isVerifying = true;

  try {
    while (verificationQueue.length > 0) {
      if (runGeneration !== verificationGeneration) return;
      const batch = verificationQueue.splice(0, MAX_CONCURRENT_VERIFICATIONS);
      console.log(
        `[SourceCheck/SW] verification batch starting size=${batch.length} ` +
        `remaining=${verificationQueue.length} active=${activeVerificationKeys.size}`
      );
      await Promise.all(batch.map((item) => verifyOneItem(item, runGeneration)));
    }
  } finally {
    if (runGeneration !== verificationGeneration) return;
    isVerifying = false;
    dispatch({ type: 'VERIFY_COMPLETED' });
    persistPanelState({ includeCards: true, includeQueue: true });
  }
};

const flushPipelineForSeek = (currentTime: number) => {
  abortActiveRequests();
  processingGeneration += 1;
  verificationGeneration += 1;
  isProcessing = false;
  isVerifying = false;
  verificationQueue = [];
  activeVerificationKeys = new Set<string>();
  allPendingClaims = [];
  pendingClaims = [];
  lastAnalyzedAt = 0;
  const livePreview = getLivePreview(currentTime);
  currentScanEntities = [];
  currentScanPreview = livePreview;
  currentScanActionState = livePreview ? null : 'BUFFERING';
  currentScanReason = livePreview ? null : `Repositioning cognitive scan to ${formatPlaybackTime(currentTime)}...`;
  lastScannedTimestamp = currentTime;
  bufferedFutureScan = null;

  const currentIndex = getTranscriptIndexAtTime(currentTime);
  if (currentIndex !== -1) lastProcessedIndex = Math.max(-1, currentIndex - 1);

  syncVisibleTimelineState(currentTime);
  dispatch({ type: 'ANALYZE_STARTED' });
};

const getTranscriptIndexAtTime = (currentTime: number | null) => {
  if (!currentTranscript.length) return -1;
  if (currentTime === null) return currentTranscript.length - 1;
  let lo = 0;
  let hi = currentTranscript.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (currentTranscript[mid].startTime <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
};

const trimPreviewText = (text: string, maxChars = 180) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= maxChars) return normalized;
  const tail = normalized.slice(-maxChars);
  const firstSpaceIndex = tail.indexOf(' ');
  return firstSpaceIndex > 0 ? tail.slice(firstSpaceIndex + 1) : tail;
};

const getLivePreview = (currentTime: number | null) => {
  const currentIndex = getTranscriptIndexAtTime(currentTime);
  if (currentIndex === -1) return null;
  const previewStart = Math.max(0, currentIndex);
  const previewEnd = Math.min(currentTranscript.length, currentIndex + 3);
  const leashCutoff = getLeashCutoff(currentTime);
  const previewChunks = currentTranscript
    .slice(previewStart, previewEnd)
    .filter((chunk, index) => (
      currentTime === null || chunk.startTime <= (leashCutoff ?? Number.POSITIVE_INFINITY) || index === 0
    ));
  const previewText = previewChunks.map((chunk) => chunk.text.trim()).filter(Boolean).join(' ');
  return trimPreviewText(previewText);
};

const getTranscriptContext = (currentTime: number | null) => {
  if (!currentTranscript.length) return [];
  if (currentTime === null) return currentTranscript.slice(Math.max(0, currentTranscript.length - 24));
  const lowerBound = Math.max(0, currentTime - 120);
  const upperBound = currentTime + 15;
  const matchingChunks = currentTranscript.filter((chunk) => {
    const chunkEnd = chunk.startTime + chunk.duration;
    return chunkEnd >= lowerBound && chunk.startTime <= upperBound;
  });
  return matchingChunks.length > 0
    ? matchingChunks.slice(-24)
    : currentTranscript.slice(Math.max(0, currentTranscript.length - 24));
};

const getRelevantSourceCards = (currentTime: number | null) => {
  if (!allSourceCards.length) return [];
  const leashCutoff = getLeashCutoff(currentTime);
  const releasedCards = leashCutoff === null
    ? allSourceCards
    : allSourceCards.filter((card) => card.timestampSeconds <= leashCutoff);
  if (!releasedCards.length) return [];
  if (currentTime === null) return releasedCards.slice(0, 20);
  const nearbyCards = releasedCards.filter((card) => Math.abs(card.timestampSeconds - currentTime) <= 180);
  return (nearbyCards.length > 0 ? nearbyCards : releasedCards).slice(0, 20);
};

const askVideoQuestion = async (question: string) => {
  if (!currentVideoInfo) throw new Error('No active video context available yet.');
  const currentTime = currentPlaybackState?.currentTime ?? null;
  const payload = {
    question,
    videoTitle: currentVideoInfo.title,
    channelName: currentVideoInfo.channel,
    currentTime,
    transcriptContext: getTranscriptContext(currentTime),
    sourceCards: getRelevantSourceCards(currentTime),
    model: runtimeState.selectedModel,  // Include selected model
  };
  if (payload.transcriptContext.length === 0 && payload.sourceCards.length === 0) {
    throw new Error('No transcript or source cards are available yet. Let the video play a little longer.');
  }
  console.log(
    `[SourceCheck/SW] ask-video request video=${currentVideoInfo.videoId} endpoint=${API_BASE}/api/ask-video transcriptContext=${payload.transcriptContext.length} sourceCards=${payload.sourceCards.length}`
  );
  const result = await fetchWithBYOK('/api/ask-video', payload, REQUEST_TIMEOUT_MS + 10_000) as AskQuestionResponse;
  console.log(
    `[SourceCheck/SW] ask-video success video=${currentVideoInfo.videoId}`
  );
  return result;
};

// Pending analysis queue for burst smoothing
let pendingAnalysisTimeout: ReturnType<typeof setTimeout> | null = null;
let analysisRequestQueue: Array<{ currentTime: number; scheduledAt: number }> = [];

const processPlayback = async (currentTime: number, expectedVideoId?: string) => {
  const activeVideo = currentVideoInfo;
  
  // Staleness check: bail if video changed or time drifted significantly
  if (expectedVideoId && expectedVideoId !== activeVideo?.videoId) {
    console.log('[Pipeline] Skipping stale request: video changed');
    return;
  }
  const currentActualTime = currentPlaybackState?.currentTime;
  if (currentActualTime !== undefined && Math.abs(currentActualTime - currentTime) > 30) {
    console.log('[Pipeline] Skipping stale request: time drifted >30s');
    return;
  }
  
  // AGGRESSIVE PIPELINE LOGGING
  console.log('[Pipeline] processPlayback called:', {
    currentTime,
    transcriptLength: currentTranscript.length,
    hasActiveVideo: !!activeVideo,
    isProcessing,
    queueLength: analysisRequestQueue.length,
    lastProcessedIndex,
    videoId: activeVideo?.videoId,
  });
  
  // If already processing, queue the request and return
  if (isProcessing) {
    // Limit queue size to prevent memory growth during long videos
    if (analysisRequestQueue.length >= 5) {
      analysisRequestQueue.shift(); // Remove oldest
    }
    analysisRequestQueue.push({ currentTime, scheduledAt: Date.now() });
    console.log('[Pipeline] Queued analysis request:', { queueLength: analysisRequestQueue.length });
    return;
  }
  
  if (!currentTranscript.length || !activeVideo) {
    console.log('[Pipeline] Early return:', {
      noTranscript: !currentTranscript.length,
      noVideo: !activeVideo,
    });
    return;
  }

  currentScanPreview = getLivePreview(currentTime);
  syncVisibleTimelineState(currentTime);
  const currentIndex = getTranscriptIndexAtTime(currentTime);

  if (currentIndex === -1 || currentIndex <= lastProcessedIndex) return;

  if (lastProcessedIndex === -1) {
    // First run: seed from a bounded backfill window instead of starting at index 0.
    // Starting at 0 would make the pipeline spend a long time catching up on content
    // the user already watched; starting at currentIndex would miss recent claims.
    const backfillTime = Math.max(0, currentTime - STARTUP_BACKFILL_SECONDS);
    const backfillIndex = getTranscriptIndexAtTime(backfillTime);
    lastProcessedIndex = Math.max(-1, backfillIndex - 1);
    console.log(`[SourceCheck/SW] First-run backfill: seeding from index ${lastProcessedIndex + 1} (~${Math.round(backfillTime)}s)`);
  } else {
    // Time-based seek detection (safety net for seeks missed by VIDEO_SEEKED).
    // Chunk-count gaps are unreliable because chunk density varies by video.
    const nextChunkTime = currentTranscript[lastProcessedIndex + 1]?.startTime;
    if (nextChunkTime !== undefined && (currentTime - nextChunkTime) > LARGE_SEEK_TIME_SECONDS) {
      lastProcessedIndex = Math.max(-1, currentIndex - 3);
      console.log(`[SourceCheck/SW] Seek detected: nextChunk=${nextChunkTime}s currentTime=${currentTime}s. Repositioning.`);
      persistPanelState();
    }
  }

  const startIndex = lastProcessedIndex + 1;
  const endIndex = Math.min(currentIndex, startIndex + getChunkBatchSize());
  const chunksToProcess = currentTranscript.slice(startIndex, endIndex + 1);
  if (chunksToProcess.length === 0) return;

  // CLOG DEBLOCKER: If we have very little text (e.g. fragments like "Heat."),
  // wait for more transcript history before calling the API, unless this is
  // the very last available chunk in the transcript.
  const combinedText = chunksToProcess.map((c) => c.text).join(' ');
  const wordCount = combinedText.trim().split(/\s+/).length;
  if (wordCount < 10 && currentIndex < currentTranscript.length - 1) {
    console.log('[Pipeline] Skipping: insufficient words', { wordCount, currentIndex, totalChunks: currentTranscript.length });
    return;
  }

  const backlogChunks = Math.max(0, currentIndex - lastProcessedIndex);
  const now = Date.now();
  const timeSinceLast = now - lastAnalyzedAt;
  const intervalMs = getAnalysisIntervalMs(backlogChunks);
  if (timeSinceLast < intervalMs) {
    console.log('[Pipeline] Skipping: rate limited', { timeSinceLast, intervalMs, backlogChunks });
    return;
  }
  lastAnalyzedAt = now;

  dispatch({ type: 'ANALYZE_STARTED' });

  const runGeneration = processingGeneration;
  const requestVideoId = activeVideo.videoId;
  isProcessing = true;

  try {
    const analyzeEndpoint = `${API_BASE}/api/analyze-chunk`;
    // AGGRESSIVE PIPELINE LOGGING
    console.log('[Pipeline] ANALYZE CHUNK START:', {
      videoId: requestVideoId,
      startIndex,
      endIndex,
      chunkCount: chunksToProcess.length,
      wordCount: chunksToProcess.map(c => c.text).join(' ').split(/\s+/).length,
      firstChunk: chunksToProcess[0]?.text?.slice(0, 50),
      lastChunk: chunksToProcess[chunksToProcess.length - 1]?.text?.slice(0, 50),
    });

    const extraction = await fetchWithBYOK('/api/analyze-chunk', {
      videoId: requestVideoId,
      videoTitle: activeVideo.title,
      channelName: activeVideo.channel,
      chunks: chunksToProcess,
      currentTimestamp: currentTime,
      model: runtimeState.selectedModel,
    }) as AnalyzeChunkResponse;
    console.log('[Pipeline] API Response:', {
      videoId: requestVideoId,
      hasClaim: extraction.has_claim,
      claimCount: extraction.claims?.length || 0,
    });
    console.log('[Pipeline] Parsed Response:', {
      videoId: requestVideoId,
      hasClaim: extraction.has_claim,
      claimCount: extraction.claims?.length || 0,
      actionState: extraction.action_state,
      claims: extraction.claims?.map(c => ({ text: c.claimText?.slice(0, 40), confidence: c.confidence })),
    });
    
    if (runGeneration !== processingGeneration || currentVideoInfo?.videoId !== requestVideoId) {
      console.log('[Pipeline] Generation mismatch or video changed, aborting.');
      return;
    }
    // Advance only after a successful parse — malformed 200 bodies fall through
    // to the catch block which explicitly does NOT advance lastProcessedIndex.
    lastProcessedIndex = endIndex;
    logAnalysisResult(requestVideoId, startIndex, endIndex, chunksToProcess, extraction);

    // Log PARSE_ERROR distinctly so it is visible in monitoring / debug logs
    // rather than silently disappearing into the normal buffering path.
    if (extraction.action_state === 'PARSE_ERROR') {
      console.warn(
        `[SourceCheck/SW] PARSE_ERROR from analyze-chunk — model output failed validation. ` +
        `video=${requestVideoId} chunkRange=${startIndex}-${endIndex} reason=${extraction.reason}`
      );
    }

    const { claims } = extraction;
    const analysisTimestamp = chunksToProcess[chunksToProcess.length - 1]?.startTime ?? currentTime;
    const leashCutoff = getLeashCutoff(currentTime);
    chunksScanned = Math.max(chunksScanned, endIndex + 1);
    if (leashCutoff !== null && analysisTimestamp > leashCutoff) {
      bufferedFutureScan = {
        timestampSeconds: analysisTimestamp,
        entities: Array.isArray(extraction.entities) ? extraction.entities : [],
        actionState: extraction.action_state || null,
        reason: extraction.reason || null,
      };
    } else {
      lastScannedTimestamp = analysisTimestamp;
      currentScanEntities = Array.isArray(extraction.entities) ? extraction.entities : [];
      currentScanActionState = extraction.action_state || null;
      currentScanReason = extraction.reason || null;
      bufferedFutureScan = null;
    }
    syncVisibleTimelineState(currentTime);

    if (claims.length > 0) {
      console.log('[Pipeline] Claims extracted, enqueueing for verification:', claims.length);
      enqueueClaimsForVerification(claims);
    } else {
      console.log('[Pipeline] No claims in this batch.');
      dispatch({ type: 'ANALYZE_COMPLETED', claimCount: 0 });
      persistPanelState();
    }
  } catch (error) {
    if (runGeneration !== processingGeneration || currentVideoInfo?.videoId !== requestVideoId) return;
    // Do not advance lastProcessedIndex on unexpected failures.
    // Advancing here would permanently skip chunks after transient network/API errors.
    console.error(
      '[SourceCheck/SW] Pipeline error',
      {
        endpoint: `${API_BASE}/api/analyze-chunk`,
        video: requestVideoId,
        startIndex,
        endIndex,
        apiBase: API_BASE,
        ...summarizeErrorForLog(error),
      }
    );
    dispatch({ type: 'ANALYZE_COMPLETED', claimCount: 0 });
    persistPanelState();
  } finally {
    // Always reset isProcessing to prevent pipeline deadlock.
    // The runGeneration check prevents duplicate work, not cleanup.
    isProcessing = false;
    
    // Process queued analysis requests with debounce
    if (analysisRequestQueue.length > 0) {
      const nextRequest = analysisRequestQueue.shift();
      if (nextRequest) {
        const delayMs = Math.max(500, MIN_ANALYSIS_COOLDOWN_MS - (Date.now() - lastAnalyzedAt));
        console.log('[Pipeline] Scheduling queued analysis:', { delayMs, remainingQueue: analysisRequestQueue.length });
        
        if (pendingAnalysisTimeout) {
          clearTimeout(pendingAnalysisTimeout);
        }
        
        pendingAnalysisTimeout = setTimeout(() => {
          pendingAnalysisTimeout = null;
          const currentPlaybackTime = currentPlaybackState?.currentTime ?? nextRequest.currentTime;
          void processPlayback(currentPlaybackTime);
        }, delayMs);
      }
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await hydrateState();

    if (message.type === 'VIDEO_CHANGED') {
      const nextVideo = {
        ...(message.payload as ActiveVideoContext),
        sourceTabId: sender.tab?.id ?? (message.payload as ActiveVideoContext).sourceTabId,
      } satisfies ActiveVideoContext;
      if (
        currentVideoInfo?.videoId === nextVideo.videoId &&
        currentVideoInfo.pageSessionId === nextVideo.pageSessionId
      ) {
        logWorkerMessage('VIDEO_CHANGED', nextVideo.videoId, { mergedMetadataOnly: true });
        currentVideoInfo = mergeVideoMetadata(currentVideoInfo, nextVideo);
        persistPanelState();
        sendResponse({ status: 'ok' });
        return;
      }

      logWorkerMessage('VIDEO_CHANGED', nextVideo.videoId, { mergedMetadataOnly: false });
      resetSessionState(nextVideo);
      persistPanelState({ includeTranscript: true, includeCards: true, includeQueue: true });
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'VIDEO_CLEARED') {
      logWorkerMessage('VIDEO_CLEARED', currentVideoInfo?.videoId ?? null);
      resetSessionState(null);
      persistPanelState({ includeTranscript: true, includeCards: true, includeQueue: true });
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'TRANSCRIPT_STATUS') {
      logWorkerMessage('TRANSCRIPT_STATUS', message.payload.videoId, { incomingDebug: message.payload.debug });
      if (message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }
      transcriptDebug = sanitizeTranscriptDebug(message.payload.debug, transcriptDebug);
      dispatch({ type: 'TRANSCRIPT_STATUS_UPDATED', debug: transcriptDebug });
      persistPanelState();
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'TRANSCRIPT_FETCH_DEBUG') {
      logWorkerMessage('TRANSCRIPT_FETCH_DEBUG', message.payload.videoId, { entry: message.payload.entry });
      if (message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }
      const entry = sanitizeTranscriptFetchDebugEntry(message.payload.entry);
      if (!entry) {
        sendResponse({ status: 'error', error: 'Invalid transcript fetch debug entry.' });
        return;
      }
      dispatch({ type: 'TRANSCRIPT_FETCH_DEBUG', entry });
      persistPanelDiagnostics();
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'TRANSCRIPT_BATCH_START') {
      logWorkerMessage('TRANSCRIPT_BATCH_START', message.payload.videoId, {
        totalChunks: message.payload.totalChunks,
        totalBatches: message.payload.totalBatches,
      });
      if (message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }
      pendingTranscriptBuffer = {
        videoId: message.payload.videoId,
        totalChunks: Number.isFinite(message.payload.totalChunks) ? Math.max(0, message.payload.totalChunks) : 0,
        totalBatches: Number.isFinite(message.payload.totalBatches) ? Math.max(0, message.payload.totalBatches) : 0,
        receivedBatchIndexes: new Set<number>(),
        chunksByBatch: {},
      };
      persistPendingTranscriptBufferNow();
      transcriptDebug = sanitizeTranscriptDebug(message.payload.debug, transcriptDebug);
      dispatch({
        type: 'TRANSCRIPT_BATCH_STARTED',
        totalChunks: pendingTranscriptBuffer.totalChunks,
        totalBatches: pendingTranscriptBuffer.totalBatches,
      });
      persistPanelState();
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'TRANSCRIPT_BATCH_APPEND') {
      logWorkerMessage('TRANSCRIPT_BATCH_APPEND', message.payload.videoId, {
        batchIndex: message.payload.batchIndex,
        batchLength: Array.isArray(message.payload.batch) ? message.payload.batch.length : 0,
      });
      if (
        message.payload.videoId !== currentVideoInfo?.videoId ||
        !pendingTranscriptBuffer ||
        pendingTranscriptBuffer.videoId !== message.payload.videoId
      ) {
        sendResponse({ status: 'ignored' });
        return;
      }

      const batch = Array.isArray(message.payload.batch)
        ? message.payload.batch.filter((chunk: unknown): chunk is RawTranscriptChunk => isValidRawTranscriptChunk(chunk))
        : [];
      const batchIndex = Number.isFinite(message.payload.batchIndex)
        ? Math.max(0, Math.floor(message.payload.batchIndex))
        : -1;
      if (
        batchIndex < 0 ||
        (pendingTranscriptBuffer.totalBatches > 0 && batchIndex >= pendingTranscriptBuffer.totalBatches)
      ) {
        sendResponse({ status: 'error', error: 'Invalid transcript batch index.' });
        return;
      }

      if (!pendingTranscriptBuffer.receivedBatchIndexes.has(batchIndex)) {
        pendingTranscriptBuffer.receivedBatchIndexes.add(batchIndex);
        pendingTranscriptBuffer.chunksByBatch[batchIndex] = batch;
        dispatch({ type: 'TRANSCRIPT_BATCH_APPENDED', batchIndex });
        schedulePendingTranscriptBufferPersist();
      }
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'PLAYBACK_UPDATE') {
      logWorkerMessage('PLAYBACK_UPDATE', currentVideoInfo?.videoId ?? null, {
        currentTime: message.payload.currentTime,
      });
      if (message.payload.videoId !== undefined && message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }
      
      // Capture timestamp at message receipt time to prevent stale state
      const messageTime = message.payload.currentTime;
      const messageVideoId = currentVideoInfo?.videoId;
      
      currentPlaybackState = message.payload as PlaybackState;
      syncVisibleTimelineState(messageTime);
      dispatch({ type: 'PLAYBACK_UPDATED', currentTime: messageTime });
      persistPanelState();
      
      // Process with captured values to prevent race conditions
      void processPlayback(messageTime, messageVideoId).catch((err) => console.error('[SW] processPlayback error:', err));
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'VIDEO_SEEKED') {
      if (message.payload?.videoId !== undefined && message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }
      const nextTime = Number.isFinite(message.payload?.currentTime)
        ? Math.max(0, Math.floor(message.payload.currentTime))
        : 0;
      if (currentPlaybackState) {
        currentPlaybackState = { ...currentPlaybackState, currentTime: nextTime };
      }
      flushPipelineForSeek(nextTime);
      persistPanelState({ includeCards: true, includeQueue: true });
      void processPlayback(nextTime).catch((err) => console.error('[SW] processPlayback error:', err));
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'TRANSCRIPT_LOADED') {
      logWorkerMessage('TRANSCRIPT_LOADED', message.payload.videoId, {
        pendingTranscriptBuffer: getPendingTranscriptBufferSummary(),
      });
      if (message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }

      const transcriptBuffer = pendingTranscriptBuffer;
      const hasMatchingBuffer = Boolean(transcriptBuffer && transcriptBuffer.videoId === message.payload.videoId);
      const receivedBatchCount = hasMatchingBuffer && transcriptBuffer ? transcriptBuffer.receivedBatchIndexes.size : 0;
      const expectedBatchCount = hasMatchingBuffer && transcriptBuffer ? transcriptBuffer.totalBatches : 0;
      if (hasMatchingBuffer && transcriptBuffer && expectedBatchCount > 0 && receivedBatchCount < expectedBatchCount) {
        sendResponse({ status: 'pending' });
        return;
      }

      const rawTranscript = hasMatchingBuffer && transcriptBuffer
        ? Array.from({ length: Math.max(0, transcriptBuffer.totalBatches) })
            .flatMap((_, index) => transcriptBuffer.chunksByBatch[index] || [])
        : [];
      const expectedChunkCount = hasMatchingBuffer && transcriptBuffer ? transcriptBuffer.totalChunks : 0;
      pendingTranscriptBuffer = null;
      persistPendingTranscriptBufferNow();

      if (!rawTranscript.length || (expectedChunkCount > 0 && rawTranscript.length < expectedChunkCount)) {
        transcriptDebug = sanitizeTranscriptDebug(message.payload.debug, transcriptDebug);
        markTranscriptUnavailable();
        persistPanelState({ includeQueue: true });
        sendResponse({ status: 'error', error: 'Transcript batch incomplete.' });
        return;
      }

      currentTranscript = rawTranscript.map((chunk, index) => ({
        text: chunk.text,
        startTime: Math.floor(chunk.startMs / 1000),
        duration: Math.max(1, Math.floor(chunk.durationMs / 1000)),
        index,
      }));
      clearTranscriptLoadTimeout();
      transcriptLoadDeadlineAt = null;
      transcriptDebug = {
        ...sanitizeTranscriptDebug(message.payload.debug, transcriptDebug),
        reason: 'loaded',
      };
      lastProcessedIndex = -1;
      currentScanPreview = getLivePreview(currentPlaybackState?.currentTime ?? null);
      syncVisibleTimelineState(currentPlaybackState?.currentTime ?? null);
      dispatch({ type: 'TRANSCRIPT_LOADED', chunkCount: currentTranscript.length, debug: transcriptDebug });
      persistPanelState({ includeTranscript: true });
      if (currentPlaybackState?.currentTime !== undefined && currentPlaybackState.paused !== true) {
        void processPlayback(currentPlaybackState.currentTime).catch((err) => console.error('[SW] processPlayback error:', err));
      }
      console.log(`[SourceCheck/SW] Transcript loaded: ${currentTranscript.length} chunks`);
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'TRANSCRIPT_FAILED') {
      logWorkerMessage('TRANSCRIPT_FAILED', message.payload.videoId, { incomingDebug: message.payload.debug });
      if (message.payload.videoId !== currentVideoInfo?.videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }
      if (!currentTranscript.length) {
        const incomingDebug = sanitizeTranscriptDebug(message.payload.debug, transcriptDebug);
        transcriptDebug = incomingDebug.reason === 'timeout' && hasConcreteTranscriptFailure(transcriptDebug)
          ? transcriptDebug
          : incomingDebug;
        markTranscriptUnavailable();
        persistPanelState({ includeQueue: true });
      }
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'MODEL_CHANGED') {
      runtimeState.selectedModel = message.model;
      try {
        await chrome.storage.sync.set({ selectedModel: message.model });
      } catch (storageError) {
        console.error('[SourceCheck/SW] Failed to persist model selection:', storageError);
      }
      persistPanelState();
      console.log('[SourceCheck/SW] Model changed to:', message.model);
      sendResponse({ status: 'ok' });
      return;
    }

    if (message.type === 'ASK_QUESTION') {
      try {
        const result = await askVideoQuestion(message.payload.question);
        sendResponse({ status: 'ok', ...result });
      } catch (error: unknown) {
        console.error('[SourceCheck/SW] Ask question failed:', error);
        sendResponse({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown ask error.',
        });
      }
      return;
    }

    if (message.type === 'RETRY_TRANSCRIPT') {
      const videoId = message.payload?.videoId ?? currentVideoInfo?.videoId ?? null;
      if (!videoId) {
        sendResponse({ status: 'ignored' });
        return;
      }

      const targetTabId = currentVideoInfo?.sourceTabId;
      if (!targetTabId) {
        sendResponse({ status: 'error', error: 'No source tab is associated with the active video.' });
        return;
      }

      const targetTab = await chrome.tabs.get(targetTabId).catch(() => null);
      if (!targetTab?.id) {
        sendResponse({ status: 'error', error: 'The source video tab is no longer available.' });
        return;
      }

      const urlObj = targetTab.url ? new URL(targetTab.url) : null;
      const urlVideoId = urlObj?.searchParams.get('v');
      if (urlVideoId !== videoId) {
        sendResponse({ status: 'error', error: 'The source tab no longer matches the active video.' });
        return;
      }

      const result = await chrome.tabs.sendMessage(targetTab.id, {
        type: 'RETRY_TRANSCRIPT',
        payload: { videoId },
      }).catch((error: unknown) => ({
        status: 'error',
        error: error instanceof Error ? error.message : 'Retry transcript failed.',
      }));

      sendResponse(result);
      return;
    }

    if (message.type === 'RELOAD_EXTENSION') {
      console.log('[SourceCheck/SW] Reloading extension as requested from side panel');
      sendResponse({ status: 'ok' });
      // Reload after sending response
      setTimeout(() => chrome.runtime.reload(), 100);
      return;
    }

    sendResponse({ status: 'ignored' });
  })().catch((error) => {
    console.error('[SourceCheck/SW] Message handler error:', error);
    sendResponse({
      status: 'error',
      error: error?.message || 'Unknown service worker error.',
    });
  });

  return true;
});
