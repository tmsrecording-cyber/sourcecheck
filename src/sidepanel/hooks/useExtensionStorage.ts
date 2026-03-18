import { useState, useEffect, useRef, useCallback } from 'react';
import { WorkerRuntimeState, TranscriptChunk } from '../../../shared/types';
import { PROVIDER_SETTINGS_KEY } from '../../background/providers/types';
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

/**
 * Debounce hook for batching rapid state updates.
 * Prevents UI thrashing during active analysis when many chunks are processed.
 */
const useDebouncedCallback = <T extends unknown[]>(
  callback: (...args: T) => void,
  delay: number
) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedCallback = useCallback((...args: T) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return debouncedCallback;
};

export const useExtensionStorage = () => {
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [runtimeState, setRuntimeState] = useState<WorkerRuntimeState>(INITIAL_RUNTIME_STATE);
  const [transcript, setTranscript] = useState<TranscriptChunk[] | null>(null);
  const [userApiKey, setUserApiKey] = useState<string | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentVideoIdRef.current = runtimeState.currentVideo?.videoId ?? null;
  }, [runtimeState.currentVideo?.videoId]);

  useEffect(() => {
    let didDispose = false;

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

    // Load user API key for BYOK
    const getUserApiKey = () =>
      new Promise<string | null>((resolve, reject) => {
        chrome.storage.local.get([PROVIDER_SETTINGS_KEY], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          const stored = result[PROVIDER_SETTINGS_KEY];
          const key = stored && typeof stored === 'object' && typeof stored.apiKey === 'string'
            ? stored.apiKey.trim()
            : null;
          resolve(key);
        });
      });

    Promise.all([getStoredState(), getUserApiKey()])
      .then(([{ runtimeState: stored, transcript: storedTranscript }, storedApiKey]) => {
        if (didDispose) return;
        setRuntimeState(stored);
        setTranscript(storedTranscript);
        setUserApiKey(storedApiKey);
        setIsStorageReady(true);
      })
      .catch((error) => {
        if (didDispose) return;
        console.error('[SourceCheck/UI] Storage read failed:', error);
        setRuntimeState((prev: WorkerRuntimeState) => ({ ...prev, lifecycle: 'error' }));
        setIsStorageReady(true);
      });

    // Pending updates accumulator for debouncing
    const pendingUpdates = {
      runtimeState: null as WorkerRuntimeState | null,
      transcript: null as TranscriptChunk[] | null,
      transcriptFetchLog: null as WorkerRuntimeState['transcriptFetchLog'] | null,
    };

    let debounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushPendingUpdates = () => {
      if (didDispose) return;
      
      if (pendingUpdates.runtimeState !== null) {
        setRuntimeState(pendingUpdates.runtimeState);
        pendingUpdates.runtimeState = null;
      }
      
      if (pendingUpdates.transcript !== null) {
        setTranscript(pendingUpdates.transcript);
        pendingUpdates.transcript = null;
      }
      
      if (pendingUpdates.transcriptFetchLog !== null) {
        setRuntimeState((prev: WorkerRuntimeState) => (
          prev.transcriptFetchLog.length > 0
            ? prev
            : { ...prev, transcriptFetchLog: pendingUpdates.transcriptFetchLog! }
        ));
        pendingUpdates.transcriptFetchLog = null;
      }
      
      debounceTimeout = null;
    };

    const queueUpdate = (type: 'runtimeState' | 'transcript' | 'transcriptFetchLog', value: unknown) => {
      pendingUpdates[type] = value as never;
      
      if (debounceTimeout === null) {
        debounceTimeout = setTimeout(flushPendingUpdates, UPDATE_DEBOUNCE_MS);
      }
    };

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (didDispose) return;

      if (areaName === 'session' && changes[WORKER_RUNTIME_STATE_KEY]) {
        const next = sanitizeWorkerRuntimeState(changes[WORKER_RUNTIME_STATE_KEY].newValue);
        queueUpdate('runtimeState', next);
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
        queueUpdate('transcriptFetchLog', compatTranscriptFetchLog);
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
        queueUpdate('transcript', nextTranscript);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      didDispose = true;
      chrome.storage.onChanged.removeListener(listener);
      
      // Flush any pending updates before unmounting
      if (debounceTimeout !== null) {
        clearTimeout(debounceTimeout);
        flushPendingUpdates();
      }
    };
  }, []);

  return {
    isStorageReady,
    runtimeState,
    transcript,
    currentVideoIdRef,
  };
};
