import { useState, useEffect, useRef } from 'react';
import { WorkerRuntimeState, TranscriptChunk } from '../../../shared/types';
import {
  INITIAL_RUNTIME_STATE,
  sanitizeWorkerRuntimeState,
  readTranscriptSnapshotForVideo,
} from '../utils/state';

const WORKER_RUNTIME_STATE_KEY = 'workerRuntimeState' as const;
const LOCAL_TRANSCRIPT_KEY = 'transcriptSnapshot' as const;
const TRANSCRIPT_FETCH_LOG_KEY = 'transcriptFetchLog' as const;
const USER_API_KEY = 'userApiKey' as const;

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
        chrome.storage.local.get([USER_API_KEY], (result) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          const key = result[USER_API_KEY];
          resolve(typeof key === 'string' && key.trim() ? key.trim() : null);
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
        setRuntimeState((prev: WorkerRuntimeState) => (
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
        setTranscript(nextTranscript);
      }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
      didDispose = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  return {
    isStorageReady,
    runtimeState,
    transcript,
    currentVideoIdRef,
  };
};
