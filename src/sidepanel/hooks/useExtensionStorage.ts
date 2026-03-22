import { useState, useEffect, useRef } from 'react';
import { WorkerRuntimeState, TranscriptChunk, ExtractionActionState } from '../../../shared/types';
import {
  INITIAL_RUNTIME_STATE,
  sanitizeWorkerRuntimeState,
  readTranscriptSnapshotForVideo,
} from '../utils/state';

const WORKER_RUNTIME_STATE_KEY = 'workerRuntimeState' as const;
const LOCAL_TRANSCRIPT_KEY = 'transcriptSnapshot' as const;
const TRANSCRIPT_FETCH_LOG_KEY = 'transcriptFetchLog' as const;

// Debounce delay for storage updates - batches rapid changes during analysis
const UPDATE_DEBOUNCE_MS = 100;

export const useExtensionStorage = () => {
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [runtimeState, setRuntimeState] = useState<WorkerRuntimeState>(INITIAL_RUNTIME_STATE);
  const [transcript, setTranscript] = useState<TranscriptChunk[] | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentVideoIdRef.current = runtimeState.currentVideo?.videoId ?? null;
  }, [runtimeState.currentVideo?.videoId]);

  useEffect(() => {
    let didDispose = false;

    const getStoredState = () =>
      Promise.all([
        new Promise<{ runtimeState: WorkerRuntimeState; compatTranscriptFetchLog: WorkerRuntimeState['transcriptFetchLog'] }>((resolve, reject) => {
          chrome.storage.session.get([
            WORKER_RUNTIME_STATE_KEY,
            TRANSCRIPT_FETCH_LOG_KEY,
            'currentScanPreview',
            'currentScanEntities',
            'currentScanActionState',
            'currentScanReason',
          ], (result) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
              return;
            }
            const baseRuntimeState = sanitizeWorkerRuntimeState(result[WORKER_RUNTIME_STATE_KEY]);
            const runtimeState: WorkerRuntimeState = {
              ...baseRuntimeState,
              currentScanPreview:
                typeof result.currentScanPreview === 'string' || result.currentScanPreview === null
                  ? result.currentScanPreview
                  : baseRuntimeState.currentScanPreview,
              currentScanEntities:
                Array.isArray(result.currentScanEntities)
                  ? result.currentScanEntities
                  : baseRuntimeState.currentScanEntities,
              currentScanActionState:
                typeof result.currentScanActionState === 'string' || result.currentScanActionState === null
                  ? (result.currentScanActionState as ExtractionActionState | null)
                  : baseRuntimeState.currentScanActionState,
              currentScanReason:
                typeof result.currentScanReason === 'string' || result.currentScanReason === null
                  ? result.currentScanReason
                  : baseRuntimeState.currentScanReason,
            };
            resolve({
              runtimeState,
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
          : { ...sessionState.runtimeState, transcriptFetchLog: sessionState.compatTranscriptFetchLog };
        const transcript = readTranscriptSnapshotForVideo(
          localState[LOCAL_TRANSCRIPT_KEY],
          runtimeState.currentVideo?.videoId ?? null
        );
        return { runtimeState, transcript };
      });

    getStoredState()
      .then(({ runtimeState: stored, transcript: storedTranscript }) => {
        if (didDispose) return;
        setRuntimeState(stored);
        setTranscript(storedTranscript);
        setIsStorageReady(true);
      })
      .catch((error) => {
        if (didDispose) return;
        console.error('[SourceCheck/UI] Storage read failed:', error);
        setRuntimeState((prev: WorkerRuntimeState) => ({ ...prev, lifecycle: 'error' }));
        setIsStorageReady(true);
      });

    // We store a queue of updaters to ensure rapid storage deltas are merged perfectly 
    // against the latest React state, without dropping unmodified keys.
    const pendingUpdates = {
      runtimeStateUpdaters: [] as Array<(prev: WorkerRuntimeState) => WorkerRuntimeState>,
      // undefined = no pending update; null = pending clear; T[] = pending set
      transcript: undefined as TranscriptChunk[] | null | undefined,
    };

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushPendingUpdates = () => {
      if (didDispose) return;
      
      if (pendingUpdates.runtimeStateUpdaters.length > 0) {
        setRuntimeState((prev) => {
          let next = prev;
          for (const updater of pendingUpdates.runtimeStateUpdaters) {
            next = updater(next);
          }
          return next;
        });
        pendingUpdates.runtimeStateUpdaters = [];
      }
      
      if (pendingUpdates.transcript !== undefined) {
        setTranscript(pendingUpdates.transcript);
        pendingUpdates.transcript = undefined;
      }
      
      debounceTimeout = null;
    };

    const scheduleFlush = () => {
      if (debounceTimeout === null) {
        debounceTimeout = setTimeout(flushPendingUpdates, UPDATE_DEBOUNCE_MS);
      }
    };

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (didDispose) return;

      if (areaName === 'session') {
        const hasBaseStateChange = !!changes[WORKER_RUNTIME_STATE_KEY];
        const hasLogChange = !!changes[TRANSCRIPT_FETCH_LOG_KEY];
        const liveChanges: Partial<WorkerRuntimeState> = {};

        // Capture any top-level keys that actually changed in this storage event
        if (changes.currentScanPreview) liveChanges.currentScanPreview = changes.currentScanPreview.newValue;
        if (changes.currentScanEntities) liveChanges.currentScanEntities = changes.currentScanEntities.newValue;
        if (changes.currentScanActionState) liveChanges.currentScanActionState = changes.currentScanActionState.newValue;
        if (changes.currentScanReason) liveChanges.currentScanReason = changes.currentScanReason.newValue;

        if (hasLogChange) {
          liveChanges.transcriptFetchLog = Array.isArray(changes[TRANSCRIPT_FETCH_LOG_KEY].newValue)
            ? changes[TRANSCRIPT_FETCH_LOG_KEY].newValue.filter(entry => 
                entry && typeof entry === 'object' && Number.isFinite(entry.at) && typeof entry.source === 'string'
              )
            : [];
        }

        if (hasBaseStateChange || Object.keys(liveChanges).length > 0) {
          pendingUpdates.runtimeStateUpdaters.push((prev: WorkerRuntimeState) => {
            let next = prev;
            
            // If the base state changed, sanitize it, but CARRY OVER the live UI fields 
            // from the previous React state so we don't accidentally overwrite them with stale data.
            if (hasBaseStateChange) {
              next = sanitizeWorkerRuntimeState(changes[WORKER_RUNTIME_STATE_KEY].newValue);
              next.currentScanPreview = prev.currentScanPreview;
              next.currentScanEntities = prev.currentScanEntities;
              next.currentScanActionState = prev.currentScanActionState;
              next.currentScanReason = prev.currentScanReason;
              next.transcriptFetchLog = prev.transcriptFetchLog;
            }
            
            // Apply any fields that actually changed in this specific storage event
            return { ...next, ...liveChanges };
          });
          scheduleFlush();
        }
      }

      if (areaName === 'local' && changes[LOCAL_TRANSCRIPT_KEY]) {
        const snapshotValue = changes[LOCAL_TRANSCRIPT_KEY].newValue;
        const snapshotVideoId =
          snapshotValue && typeof snapshotValue === 'object' && typeof (snapshotValue as { videoId?: unknown }).videoId === 'string'
            ? (snapshotValue as { videoId: string }).videoId
            : null;
        pendingUpdates.transcript = readTranscriptSnapshotForVideo(
          snapshotValue,
          snapshotVideoId ?? currentVideoIdRef.current,
        );
        scheduleFlush();
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      chrome.storage.onChanged.removeListener(listener);
      if (debounceTimeout !== null) clearTimeout(debounceTimeout);
      didDispose = true;
    };
  }, []);

  return {
    isStorageReady,
    runtimeState,
    transcript,
    currentVideoIdRef,
  };
};
