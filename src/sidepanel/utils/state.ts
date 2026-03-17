import {
  WorkerRuntimeState,
  WorkerLifecycle,
  AnalysisStatus,
  TranscriptChunk,
} from '../../../shared/types';

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
  selectedModel: 'gemini-3.1-flash-lite',
};

export const sanitizeWorkerRuntimeState = (value: unknown): WorkerRuntimeState => {
  if (!value || typeof value !== 'object') {
    return INITIAL_RUNTIME_STATE;
  }

  const candidate = value as Partial<WorkerRuntimeState>;

  return {
    ...INITIAL_RUNTIME_STATE,
    ...candidate,
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
      ? (candidate.transcriptFetchLog as any[]).filter((entry) =>
          entry &&
          typeof entry === 'object' &&
          Number.isFinite(entry.at) &&
          typeof entry.source === 'string' &&
          typeof entry.step === 'string' &&
          typeof entry.message === 'string'
        )
      : INITIAL_RUNTIME_STATE.transcriptFetchLog,
    pendingTranscriptBufferSummary: candidate.pendingTranscriptBufferSummary
      && typeof (candidate.pendingTranscriptBufferSummary as any).present === 'boolean'
      && Number.isFinite((candidate.pendingTranscriptBufferSummary as any).receivedCount)
      && Number.isFinite((candidate.pendingTranscriptBufferSummary as any).totalCount)
      ? {
          present: (candidate.pendingTranscriptBufferSummary as any).present,
          receivedCount: Math.max(0, Math.floor((candidate.pendingTranscriptBufferSummary as any).receivedCount)),
          totalCount: Math.max(0, Math.floor((candidate.pendingTranscriptBufferSummary as any).totalCount)),
        }
      : INITIAL_RUNTIME_STATE.pendingTranscriptBufferSummary,
    transcriptMessageStats: candidate.transcriptMessageStats
      && typeof candidate.transcriptMessageStats === 'object'
      && Number.isFinite((candidate.transcriptMessageStats as any).startsSeen)
      && Number.isFinite((candidate.transcriptMessageStats as any).appendsSeen)
      && Number.isFinite((candidate.transcriptMessageStats as any).loadedSeen)
      && Number.isFinite((candidate.transcriptMessageStats as any).failedSeen)
      ? {
          startsSeen: Math.max(0, Math.floor((candidate.transcriptMessageStats as any).startsSeen)),
          appendsSeen: Math.max(0, Math.floor((candidate.transcriptMessageStats as any).appendsSeen)),
          loadedSeen: Math.max(0, Math.floor((candidate.transcriptMessageStats as any).loadedSeen)),
          failedSeen: Math.max(0, Math.floor((candidate.transcriptMessageStats as any).failedSeen)),
        }
      : INITIAL_RUNTIME_STATE.transcriptMessageStats,
    sourceCards: Array.isArray(candidate.sourceCards) ? candidate.sourceCards : INITIAL_RUNTIME_STATE.sourceCards,
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
