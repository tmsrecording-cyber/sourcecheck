import { useEffect, useRef, useState } from 'react';
import { usePinnedTopScroll } from './hooks/usePinnedTopScroll';
import { AlertTriangle, Shield } from 'lucide-react';
import { VideoHeader } from './components/VideoHeader';
import { CardFeed } from './components/CardFeed';
import { AskBox } from './components/AskBox';
import { panelTones } from './styles/panelTokens';
import type {
  AskQuestionResponse,
  AskQuestionSource,
  AnalysisStatus,
  WorkerRuntimeState,
  WorkerLifecycle,
  TranscriptChunk,
} from '../../shared/types';

const WORKER_RUNTIME_STATE_KEY = 'workerRuntimeState' as const;
const LOCAL_TRANSCRIPT_KEY = 'transcriptSnapshot' as const;
const TRANSCRIPT_FETCH_LOG_KEY = 'transcriptFetchLog' as const;
const SHOW_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

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
};

const sanitizeWorkerRuntimeState = (value: unknown): WorkerRuntimeState => {
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
      ? candidate.transcriptFetchLog.filter((entry) =>
          entry &&
          typeof entry === 'object' &&
          Number.isFinite(entry.at) &&
          typeof entry.source === 'string' &&
          typeof entry.step === 'string' &&
          typeof entry.message === 'string'
        )
      : INITIAL_RUNTIME_STATE.transcriptFetchLog,
    pendingTranscriptBufferSummary: candidate.pendingTranscriptBufferSummary
      && typeof candidate.pendingTranscriptBufferSummary === 'object'
      && typeof candidate.pendingTranscriptBufferSummary.present === 'boolean'
      && Number.isFinite(candidate.pendingTranscriptBufferSummary.receivedCount)
      && Number.isFinite(candidate.pendingTranscriptBufferSummary.totalCount)
      ? {
          present: candidate.pendingTranscriptBufferSummary.present,
          receivedCount: Math.max(0, Math.floor(candidate.pendingTranscriptBufferSummary.receivedCount)),
          totalCount: Math.max(0, Math.floor(candidate.pendingTranscriptBufferSummary.totalCount)),
        }
      : INITIAL_RUNTIME_STATE.pendingTranscriptBufferSummary,
    transcriptMessageStats: candidate.transcriptMessageStats
      && typeof candidate.transcriptMessageStats === 'object'
      && Number.isFinite(candidate.transcriptMessageStats.startsSeen)
      && Number.isFinite(candidate.transcriptMessageStats.appendsSeen)
      && Number.isFinite(candidate.transcriptMessageStats.loadedSeen)
      && Number.isFinite(candidate.transcriptMessageStats.failedSeen)
      ? {
          startsSeen: Math.max(0, Math.floor(candidate.transcriptMessageStats.startsSeen)),
          appendsSeen: Math.max(0, Math.floor(candidate.transcriptMessageStats.appendsSeen)),
          loadedSeen: Math.max(0, Math.floor(candidate.transcriptMessageStats.loadedSeen)),
          failedSeen: Math.max(0, Math.floor(candidate.transcriptMessageStats.failedSeen)),
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

const lifecycleToAnalysisStatus = (lifecycle: WorkerLifecycle): AnalysisStatus => {
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

const readTranscriptSnapshotForVideo = (
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

  const transcript = snapshot.transcript
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

const getStoredState = () =>
  Promise.all([
    new Promise<{ runtimeState: WorkerRuntimeState; compatTranscriptFetchLog: WorkerRuntimeState['transcriptFetchLog'] }>((resolve, reject) => {
      chrome.storage.session.get([WORKER_RUNTIME_STATE_KEY, TRANSCRIPT_FETCH_LOG_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve({
          runtimeState: sanitizeWorkerRuntimeState(result[WORKER_RUNTIME_STATE_KEY]),
          compatTranscriptFetchLog: Array.isArray(result[TRANSCRIPT_FETCH_LOG_KEY])
            ? result[TRANSCRIPT_FETCH_LOG_KEY].filter((entry) =>
                entry &&
                typeof entry === 'object' &&
                Number.isFinite(entry.at) &&
                typeof entry.source === 'string' &&
                typeof entry.step === 'string' &&
                typeof entry.message === 'string'
              )
            : [],
        });
      });
    }),
    new Promise<Record<string, unknown>>((resolve, reject) => {
      chrome.storage.local.get([LOCAL_TRANSCRIPT_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        resolve(result as Record<string, unknown>);
      });
    }),
  ]).then(([sessionState, localState]) => {
    const runtimeState = sessionState.runtimeState.transcriptFetchLog.length > 0
      ? sessionState.runtimeState
      : {
          ...sessionState.runtimeState,
          transcriptFetchLog: sessionState.compatTranscriptFetchLog,
        };
    const transcript = readTranscriptSnapshotForVideo(
      localState[LOCAL_TRANSCRIPT_KEY],
      runtimeState.currentVideo?.videoId ?? null
    );
    return { runtimeState, transcript };
  });

interface AskHistoryEntry {
  query: string;
  answer: string;
  timestampSeconds: number;
  sources: AskQuestionSource[];
}

type AskQuestionResult =
  | ({ status: 'ok' } & AskQuestionResponse)
  | { status: 'error'; error: string };

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const PanelShell = ({
  label,
  subcopy,
  error = false,
  disclosureNote,
}: {
  label: string;
  subcopy: string;
  error?: boolean;
  disclosureNote?: string;
}) => (
  <div className="flex h-screen w-full items-center justify-center bg-bgDark px-5">
    <div className="w-full max-w-[320px]">
      <div className="instrument-shell px-5 py-5">
        <div className="signal-rail" style={{ left: '24px', top: '18px', bottom: '18px' }} />
        <div className="relative pl-[42px]">
          <span
            className="rail-node"
            style={{
              top: '10px',
              background: error ? panelTones.status.disputed : panelTones.status.accentSoft,
              boxShadow: `0 0 0 4px ${error ? 'rgba(198, 111, 93, 0.18)' : 'rgba(231, 210, 173, 0.18)'}`,
            }}
          />
          <span
            className="rail-connector"
            style={{
              top: '14px',
              background: `linear-gradient(90deg, ${error ? panelTones.status.disputed : panelTones.status.accentSoft}, rgba(0, 0, 0, 0))`,
            }}
          />
          <div className="capture-plate ml-1 px-4 py-4">
            <div className={`status-led ${error ? 'text-disputed' : 'text-accentSoft'}`}>
              {error ? 'Instrument fault' : 'Instrument standby'}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {error ? <AlertTriangle size={14} className="text-disputed" /> : <Shield size={14} className="text-accentSoft" />}
              <h1 className="panel-shell-title text-[16px] font-semibold text-textMain">{label}</h1>
            </div>
            <p className="panel-shell-copy mt-2 text-[13px] leading-relaxed text-textMuted/90">{subcopy}</p>
            {disclosureNote && (
              <p className="mt-3 border-t border-white/10 pt-3 text-[12px] leading-relaxed text-textMuted">{disclosureNote}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
);

const formatDebugTimestamp = (value: number | null) =>
  value === null ? 'null' : `${Math.max(0, Math.floor(value))}`;

const formatDebugDeadline = (value: number | null) =>
  value === null ? 'null' : new Date(value).toLocaleTimeString();

const DebugStatusPanel = ({
  runtimeState,
  analysisStatus,
}: {
  runtimeState: WorkerRuntimeState;
  analysisStatus: AnalysisStatus;
}) => (
  <div className="debug-panel">
    <div className="debug-panel-title">Debug Status</div>
    <div className="debug-grid">
      <span>videoId</span><span>{runtimeState.currentVideo?.videoId ?? 'null'}</span>
      <span>title</span><span>{runtimeState.currentVideo?.title ?? 'null'}</span>
      <span>lifecycle</span><span>{runtimeState.lifecycle}</span>
      <span>analysisStatus</span><span>{analysisStatus}</span>
      <span>debugStage</span><span>{runtimeState.debugStage}</span>
      <span>debug.source</span><span>{runtimeState.transcriptDebug?.source ?? 'null'}</span>
      <span>debug.reason</span><span>{runtimeState.transcriptDebug?.reason ?? 'null'}</span>
      <span>debug.attemptCount</span><span>{runtimeState.transcriptDebug?.attemptCount ?? 0}</span>
      <span>transcript chunks</span><span>{runtimeState.transcriptChunkCount}</span>
      <span>pending batch</span><span>{runtimeState.pendingTranscriptBufferSummary.present ? 'yes' : 'no'}</span>
      <span>batch received/total</span><span>{runtimeState.pendingTranscriptBufferSummary.receivedCount} / {runtimeState.pendingTranscriptBufferSummary.totalCount}</span>
      <span>deadline</span><span>{formatDebugDeadline(runtimeState.transcriptLoadDeadlineAt)}</span>
      <span>playback currentTime</span><span>{formatDebugTimestamp(runtimeState.playbackState?.currentTime ?? null)}</span>
      <span>lastScannedTimestamp</span><span>{formatDebugTimestamp(runtimeState.lastScannedTimestamp)}</span>
      <span>chunksScanned</span><span>{runtimeState.chunksScanned}</span>
      <span>msg starts</span><span>{runtimeState.transcriptMessageStats.startsSeen}</span>
      <span>msg appends</span><span>{runtimeState.transcriptMessageStats.appendsSeen}</span>
      <span>msg loaded</span><span>{runtimeState.transcriptMessageStats.loadedSeen}</span>
      <span>msg failed</span><span>{runtimeState.transcriptMessageStats.failedSeen}</span>
    </div>
  </div>
);

const EventTimeline = ({ runtimeState }: { runtimeState: WorkerRuntimeState }) => {
  const events = runtimeState.eventLog.slice(-20);
  if (events.length === 0) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-title">Event Timeline</div>
      <div className="space-y-1.5">
        {events.map((event, i) => (
          <div key={i} className="debug-line">
            <span className="debug-line-time">{new Date(event.at).toLocaleTimeString()}</span>
            <span className="debug-line-accent">{event.type}</span>
            <span className="debug-line-state">{event.lifecycle}</span>
            {event.summary && <span className="debug-line-copy">{event.summary}</span>}
          </div>
        ))}
      </div>
    </div>
  );
};

const TranscriptFetchLogPanel = ({ runtimeState }: { runtimeState: WorkerRuntimeState }) => {
  const entries = runtimeState.transcriptFetchLog.slice(-15);
  if (entries.length === 0) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-title">Transcript Fetch Log</div>
      <div className="space-y-1.5">
        {entries.map((entry, i) => (
          <div key={`${entry.at}-${i}`} className="debug-log-entry">
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="debug-line-time">{new Date(entry.at).toLocaleTimeString()}</span>
              <span className="debug-line-accent">{entry.source}</span>
              <span className="debug-line-state">{entry.step}</span>
            </div>
            <div className="debug-line-copy mt-1">
              {entry.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const App = () => {
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [runtimeState, setRuntimeState] = useState<WorkerRuntimeState>(INITIAL_RUNTIME_STATE);
  const [transcript, setTranscript] = useState<TranscriptChunk[] | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [askHistory, setAskHistory] = useState<AskHistoryEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    currentVideoIdRef.current = runtimeState.currentVideo?.videoId ?? null;
  }, [runtimeState.currentVideo?.videoId]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    let didDispose = false;

    void getStoredState()
      .then(({ runtimeState: stored, transcript: storedTranscript }) => {
        if (didDispose) return;
        setRuntimeState(stored);
        setTranscript(storedTranscript);
        setIsStorageReady(true);
      })
      .catch((error) => {
        if (didDispose) return;
        console.error('[SourceCheck/UI] Storage read failed:', error);
        setRuntimeState((prev) => ({ ...prev, lifecycle: 'error' }));
        setIsStorageReady(true);
      });

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (didDispose) return;

      if (areaName === 'session' && changes[WORKER_RUNTIME_STATE_KEY]) {
        const next = sanitizeWorkerRuntimeState(changes[WORKER_RUNTIME_STATE_KEY].newValue);
        setRuntimeState(next);
      }

      if (areaName === 'session' && changes[TRANSCRIPT_FETCH_LOG_KEY]) {
        const compatTranscriptFetchLog = Array.isArray(changes[TRANSCRIPT_FETCH_LOG_KEY].newValue)
          ? changes[TRANSCRIPT_FETCH_LOG_KEY].newValue.filter((entry) =>
              entry &&
              typeof entry === 'object' &&
              Number.isFinite(entry.at) &&
              typeof entry.source === 'string' &&
              typeof entry.step === 'string' &&
              typeof entry.message === 'string'
            )
          : [];
        setRuntimeState((prev) => (
          prev.transcriptFetchLog.length > 0
            ? prev
            : { ...prev, transcriptFetchLog: compatTranscriptFetchLog }
        ));
      }

      if (areaName === 'local' && changes[LOCAL_TRANSCRIPT_KEY]) {
        const snapshotValue = changes[LOCAL_TRANSCRIPT_KEY].newValue;
        const snapshotVideoId =
          snapshotValue &&
          typeof snapshotValue === 'object' &&
          typeof (snapshotValue as { videoId?: unknown }).videoId === 'string'
            ? (snapshotValue as { videoId: string }).videoId
            : null;
        const nextTranscript = readTranscriptSnapshotForVideo(
          snapshotValue,
          snapshotVideoId ?? currentVideoIdRef.current,
        );
        // Allow null to clear stale transcript state. Without this, the Ask box
        // can remain enabled with stale context after a transcript failure because
        // the null update from markTranscriptUnavailable was previously ignored.
        setTranscript(nextTranscript);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      didDispose = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  useEffect(() => {
    setAskDraft('');
    setAskHistory([]);
    setAskError(null);
    setIsThinking(false);
  }, [runtimeState.currentVideo?.videoId]);

  const analysisStatus = lifecycleToAnalysisStatus(runtimeState.lifecycle);
  const [displayAnalysisStatus, setDisplayAnalysisStatus] = useState<AnalysisStatus>(analysisStatus);

  useEffect(() => {
    const shouldHoldUnavailableState =
      displayAnalysisStatus === 'no-transcript' &&
      analysisStatus === 'loading' &&
      runtimeState.sourceCards.length === 0 &&
      runtimeState.pendingClaims.length === 0 &&
      runtimeState.transcriptChunkCount === 0;

    if (shouldHoldUnavailableState) {
      return;
    }

    setDisplayAnalysisStatus(analysisStatus);
  }, [
    analysisStatus,
    displayAnalysisStatus,
    runtimeState.pendingClaims.length,
    runtimeState.sourceCards.length,
    runtimeState.transcriptChunkCount,
  ]);

  const feedScrollKey = [
    displayAnalysisStatus,
    runtimeState.lastScannedTimestamp ?? 'none',
    runtimeState.chunksScanned,
    runtimeState.currentScanPreview ?? '',
    askHistory.map((e) => `${e.query}:${e.answer}:${e.timestampSeconds}`).join('|'),
    runtimeState.sourceCards.map((c) => `${c.id}:${c.status}:${c.sourceTitle ?? ''}:${c.nuance ?? ''}`).join('|'),
    runtimeState.pendingClaims.map((c) => `${c.id}:${c.claimText}:${c.timestampSeconds ?? 'none'}`).join('|'),
  ].join('::');
  const { scrollRef: feedScrollRef, handleScroll: handleFeedScroll, isPinned: isFeedPinned, pinToTop: pinFeedToTop } =
    usePinnedTopScroll<HTMLDivElement>(feedScrollKey);

  const handleEntitySelect = (entityLabel: string) => {
    const trimmedLabel = entityLabel.trim();
    if (!trimmedLabel) return;
    setAskDraft(`What did they say about ${trimmedLabel}?`);
  };

  const handleAskSubmit = async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isThinking) return;
    const submittedVideoId = currentVideoIdRef.current;
    const submittedTimestamp = runtimeState.playbackState?.currentTime ?? runtimeState.lastScannedTimestamp ?? 0;

    setIsThinking(true);
    setAskError(null);

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'ASK_QUESTION',
        payload: { question: trimmedQuery },
      }) as AskQuestionResult;

      if (!isMountedRef.current || currentVideoIdRef.current !== submittedVideoId) {
        return;
      }

      if (!result || result.status !== 'ok') {
        setAskError(result?.error || 'Could not resolve that.');
        return;
      }

      setAskDraft('');
      setAskHistory((currentHistory) => [...currentHistory, {
        query: trimmedQuery,
        answer: result.answer,
        timestampSeconds: submittedTimestamp,
        sources: result.sources ?? [],
      }]);
    } catch (askSubmitError: unknown) {
      if (isMountedRef.current && currentVideoIdRef.current === submittedVideoId) {
        setAskError(getErrorMessage(askSubmitError, 'Could not resolve that.'));
      }
    } finally {
      if (isMountedRef.current && currentVideoIdRef.current === submittedVideoId) {
        setIsThinking(false);
      }
    }
  };

  const handleRetryTranscript = async () => {
    try {
      await chrome.runtime.sendMessage({ 
        type: 'RETRY_TRANSCRIPT',
        payload: { videoId: runtimeState.currentVideo?.videoId }
      });
    } catch (error) {
      console.error('[SourceCheck/UI] Retry transcript failed:', error);
    }
  };

  if (!isStorageReady) {
    return (
      <PanelShell
        label="Preparing SourceCheck"
        subcopy="Getting this video ready."
      />
    );
  }

  if (!runtimeState.currentVideo && runtimeState.lifecycle === 'error') {
    return (
      <PanelShell
        label="SourceCheck hit a startup error"
        subcopy="Reload the extension and refresh the YouTube tab to try again."
        error
      />
    );
  }

  if (!runtimeState.currentVideo) {
    return (
      <PanelShell
        label="SourceCheck"
        subcopy="Open a YouTube watch page to start checking claims from the video."
        disclosureNote="Transcript text and questions you ask are processed server-side using Gemini AI. No account or identity data is collected."
      />
    );
  }

  return (
    <div className="hud-shell">
      <div className="hud-grid" aria-hidden="true" />
      <div className="hud-circuit" aria-hidden="true" />
      <div className="flex h-screen w-full flex-col bg-bgDark">
        <div ref={feedScrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col" onScroll={handleFeedScroll}>
          {SHOW_DEBUG && (
            <>
              <DebugStatusPanel runtimeState={runtimeState} analysisStatus={analysisStatus} />
              <EventTimeline runtimeState={runtimeState} />
              <TranscriptFetchLogPanel runtimeState={runtimeState} />
            </>
          )}
          <VideoHeader
            title={runtimeState.currentVideo.title}
            channel={runtimeState.currentVideo.channel}
            status={displayAnalysisStatus}
            playbackState={runtimeState.playbackState}
            chunksScanned={runtimeState.chunksScanned}
            lastScannedTimestamp={runtimeState.lastScannedTimestamp}
            cards={runtimeState.sourceCards}
          />
          <CardFeed
            cards={runtimeState.sourceCards}
            pendingClaims={runtimeState.pendingClaims}
            status={displayAnalysisStatus}
            isPinned={isFeedPinned}
            pinToTop={pinFeedToTop}
            chunksScanned={runtimeState.chunksScanned}
            lastScannedTimestamp={runtimeState.lastScannedTimestamp}
            currentScanPreview={runtimeState.currentScanPreview}
            scanEntities={runtimeState.currentScanEntities}
            scanActionState={runtimeState.currentScanActionState}
            scanReason={runtimeState.currentScanReason}
            liveTimestampSeconds={runtimeState.playbackState?.currentTime ?? null}
            askHistory={askHistory}
            onEntitySelect={handleEntitySelect}
            onRetryTranscript={handleRetryTranscript}
          />
        </div>
        <AskBox
          transcript={transcript}
          cards={runtimeState.sourceCards}
          queryDraft={askDraft}
          onQueryDraftChange={setAskDraft}
          isThinking={isThinking}
          onSubmit={handleAskSubmit}
          error={askError}
        />
      </div>
    </div>
  );
};
