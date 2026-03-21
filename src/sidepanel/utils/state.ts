import {
  WorkerRuntimeState,
  WorkerLifecycle,
  AnalysisStatus,
  TranscriptChunk,
  ALLOWED_MODELS,
  FREEMIUM_MODEL,
  normalizeModel,
} from '../../../shared/types';

// CANONICAL: Initial runtime state uses FREEMIUM_MODEL as default (single source of truth)

export const INITIAL_RUNTIME_STATE: WorkerRuntimeState = {
  lifecycle: 'idle',
  currentVideo: null,
  playbackState: null,
  transcriptChunkCount: 0,
  transcriptDebug: null,
  transcriptFetchLog: [],
  pendingTranscriptBufferSummary: { present: false, receivedCount: 0, totalCount: 0 },
  transcriptMessageStats: { startsSeen: 0, appendsSeen: 0, loadedSeen: 0, failedSeen: 0 },
  sourceCards: [],
  allSourceCards: [],
  pendingClaims: [],
  chunksScanned: 0,
  lastScannedTimestamp: null,
  currentScanPreview: null,
  currentScanEntities: [],
  currentScanActionState: null,
  currentScanReason: null,
  lastProviderError: null,
  lastProcessedIndex: -1,
  transcriptLoadDeadlineAt: null,
  debugStage: 'idle',
  eventLog: [],
  selectedModel: FREEMIUM_MODEL,
};

// Use the canonical normalizeModel from shared/types — single source of truth for migration + validation
const migrateModel = (model: unknown): string =>
  typeof model === 'string' ? normalizeModel(model) : FREEMIUM_MODEL;

export const sanitizeWorkerRuntimeState = (value: unknown): WorkerRuntimeState => {
  if (!value || typeof value !== 'object') {
    return INITIAL_RUNTIME_STATE;
  }

  const candidate = value as Partial<WorkerRuntimeState>;

  return {
    ...INITIAL_RUNTIME_STATE,
    ...candidate,
    selectedModel: migrateModel(candidate.selectedModel) as typeof ALLOWED_MODELS[number],
    currentVideo: candidate.currentVideo && typeof candidate.currentVideo === 'object'
      && typeof candidate.currentVideo.videoId === 'string'
      && typeof candidate.currentVideo.title === 'string'
      && typeof candidate.currentVideo.channel === 'string'
      ? candidate.currentVideo
      : null,
    playbackState: candidate.playbackState && typeof candidate.playbackState === 'object'
      && Number.isFinite(candidate.playbackState.currentTime)
      && Number.isFinite(candidate.playbackState.duration)
      && typeof candidate.playbackState.paused === 'boolean'
      ? candidate.playbackState
      : null,
    transcriptChunkCount: Number.isFinite(candidate.transcriptChunkCount)
      ? Math.max(0, Math.floor(candidate.transcriptChunkCount as number))
      : INITIAL_RUNTIME_STATE.transcriptChunkCount,
    transcriptFetchLog: Array.isArray(candidate.transcriptFetchLog)
      ? candidate.transcriptFetchLog.filter((entry: unknown) => {
          if (!entry || typeof entry !== 'object') return false;
          const e = entry as { at?: unknown; source?: unknown; step?: unknown; message?: unknown };
          return (
            Number.isFinite(e.at) &&
            typeof e.source === 'string' &&
            typeof e.step === 'string' &&
            typeof e.message === 'string'
          );
        })
      : INITIAL_RUNTIME_STATE.transcriptFetchLog,
    pendingTranscriptBufferSummary: (() => {
      const summary = candidate.pendingTranscriptBufferSummary;
      if (!summary || typeof summary !== 'object') {
        return INITIAL_RUNTIME_STATE.pendingTranscriptBufferSummary;
      }
      const s = summary as { present?: unknown; receivedCount?: unknown; totalCount?: unknown };
      if (
        typeof s.present === 'boolean' &&
        Number.isFinite(s.receivedCount) &&
        Number.isFinite(s.totalCount)
      ) {
        return {
          present: s.present,
          receivedCount: Math.max(0, Math.floor(s.receivedCount as number)),
          totalCount: Math.max(0, Math.floor(s.totalCount as number)),
        };
      }
      return INITIAL_RUNTIME_STATE.pendingTranscriptBufferSummary;
    })(),
    transcriptMessageStats: (() => {
      const stats = candidate.transcriptMessageStats;
      if (!stats || typeof stats !== 'object') {
        return INITIAL_RUNTIME_STATE.transcriptMessageStats;
      }
      const s = stats as { startsSeen?: unknown; appendsSeen?: unknown; loadedSeen?: unknown; failedSeen?: unknown };
      if (
        Number.isFinite(s.startsSeen) &&
        Number.isFinite(s.appendsSeen) &&
        Number.isFinite(s.loadedSeen) &&
        Number.isFinite(s.failedSeen)
      ) {
        return {
          startsSeen: Math.max(0, Math.floor(s.startsSeen as number)),
          appendsSeen: Math.max(0, Math.floor(s.appendsSeen as number)),
          loadedSeen: Math.max(0, Math.floor(s.loadedSeen as number)),
          failedSeen: Math.max(0, Math.floor(s.failedSeen as number)),
        };
      }
      return INITIAL_RUNTIME_STATE.transcriptMessageStats;
    })(),
    sourceCards: Array.isArray(candidate.sourceCards) ? candidate.sourceCards : INITIAL_RUNTIME_STATE.sourceCards,
    allSourceCards: Array.isArray(candidate.allSourceCards) ? candidate.allSourceCards : INITIAL_RUNTIME_STATE.allSourceCards,
    pendingClaims: Array.isArray(candidate.pendingClaims) ? candidate.pendingClaims : INITIAL_RUNTIME_STATE.pendingClaims,
    chunksScanned: Number.isFinite(candidate.chunksScanned)
      ? Math.max(0, Math.floor(candidate.chunksScanned as number))
      : INITIAL_RUNTIME_STATE.chunksScanned,
    lastScannedTimestamp: Number.isFinite(candidate.lastScannedTimestamp)
      ? Math.max(0, Math.floor(candidate.lastScannedTimestamp as number))
      : null,
    currentScanPreview: typeof candidate.currentScanPreview === 'string' ? candidate.currentScanPreview : null,
    currentScanEntities: Array.isArray(candidate.currentScanEntities) ? candidate.currentScanEntities : INITIAL_RUNTIME_STATE.currentScanEntities,
    currentScanActionState: candidate.currentScanActionState ?? null,
    currentScanReason: typeof candidate.currentScanReason === 'string' ? candidate.currentScanReason : null,
    lastProviderError:
      candidate.lastProviderError &&
      typeof candidate.lastProviderError === 'object' &&
      (
        typeof candidate.lastProviderError.code === 'string' ||
        typeof candidate.lastProviderError.message === 'string'
      )
        ? {
            code: typeof candidate.lastProviderError.code === 'string' ? candidate.lastProviderError.code : undefined,
            message: typeof candidate.lastProviderError.message === 'string' ? candidate.lastProviderError.message : undefined,
          }
        : null,
    lastProcessedIndex: Number.isFinite(candidate.lastProcessedIndex)
      ? Math.floor(candidate.lastProcessedIndex as number)
      : INITIAL_RUNTIME_STATE.lastProcessedIndex,
    transcriptLoadDeadlineAt: Number.isFinite(candidate.transcriptLoadDeadlineAt)
      ? candidate.transcriptLoadDeadlineAt as number
      : null,
    debugStage: typeof candidate.debugStage === 'string' ? candidate.debugStage : INITIAL_RUNTIME_STATE.debugStage,
    eventLog: Array.isArray(candidate.eventLog) ? candidate.eventLog : INITIAL_RUNTIME_STATE.eventLog,
  };
};

export const lifecycleToAnalysisStatus = (lifecycle: WorkerLifecycle): AnalysisStatus => {
  switch (lifecycle) {
    case 'idle': return 'idle';
    case 'video_detected':
    case 'playback_ready':
    case 'extracting_transcript':
    case 'transcript_buffering':
    case 'transcript_loaded': return 'loading';
    case 'transcript_unavailable': return 'no-transcript';
    case 'analyzing': return 'monitoring';
    case 'verifying': return 'verifying';
    case 'ready': return 'ready';
    case 'error': return 'error';
    default: return 'idle';
  }
};

export const readTranscriptSnapshotForVideo = (
  snapshotValue: unknown,
  videoId: string | null
): TranscriptChunk[] | null => {
  if (!snapshotValue || typeof snapshotValue !== 'object' || !videoId) {
    return null;
  }

  const snapshot = snapshotValue as {
    videoId?: unknown;
    transcript?: unknown;
  };

  if (snapshot.videoId !== videoId || !Array.isArray(snapshot.transcript)) {
    return null;
  }

  const transcript = (snapshot.transcript as any[])
    .filter((chunk): chunk is TranscriptChunk =>
      Boolean(chunk) &&
      typeof chunk === 'object' &&
      typeof (chunk as TranscriptChunk).text === 'string' &&
      Number.isFinite((chunk as TranscriptChunk).startTime) &&
      Number.isFinite((chunk as TranscriptChunk).duration) &&
      Number.isFinite((chunk as TranscriptChunk).index)
    )
    .map((chunk) => ({
      text: chunk.text,
      startTime: Math.max(0, Math.floor(chunk.startTime)),
      duration: Math.max(1, Math.floor(chunk.duration)),
      index: Math.max(0, Math.floor(chunk.index)),
    }));

  return transcript.length > 0 ? transcript : null;
};
