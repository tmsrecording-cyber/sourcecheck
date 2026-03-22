import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskQuestionSource } from '../../../shared/types';

export interface AskHistoryEntry {
  query: string;
  answer: string;
  timestampSeconds: number;
  sources: AskQuestionSource[];
}

const MAX_ASK_HISTORY = 50;
const STORAGE_KEY = 'askHistory';

/**
 * Manages Q&A history for the current video, persisted in chrome.storage.session.
 * Call `resetForVideo(videoId)` on video change to restore history for that video.
 * 
 * M5 PRIVACY: For private sessions (isPrivate=true), history is never persisted
 * or restored across reloads. It exists only in memory for the current page session.
 */
export const useAskHistory = () => {
  const [askHistory, setAskHistory] = useState<AskHistoryEntry[]>([]);
  const restoredForVideoRef = useRef<string | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const isPrivateRef = useRef<boolean>(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Persist when history changes (only for non-private sessions)
  useEffect(() => {
    const videoId = currentVideoIdRef.current;
    // M5 PRIVACY: Skip persistence for private sessions
    if (!videoId || askHistory.length === 0 || isPrivateRef.current) return;
    chrome.storage.session.set({
      [STORAGE_KEY]: { videoId, entries: askHistory },
    }).catch(() => {});
  }, [askHistory]);

  const resetForVideo = useCallback((videoId: string | null, isPrivate: boolean = false) => {
    currentVideoIdRef.current = videoId;
    isPrivateRef.current = isPrivate;
    
    // M5 PRIVACY: Always clear history on reset for private sessions
    if (isPrivate) {
      setAskHistory([]);
      restoredForVideoRef.current = videoId;
      return;
    }
    
    setAskHistory([]);

    // M5 PRIVACY: Skip restoration for private sessions
    if (videoId && restoredForVideoRef.current !== videoId && !isPrivate) {
      restoredForVideoRef.current = videoId;
      chrome.storage.session.get([STORAGE_KEY]).then((result) => {
        if (!isMountedRef.current) return;
        const stored = result[STORAGE_KEY] as { videoId: string; entries: AskHistoryEntry[] } | undefined;
        if (stored?.videoId === videoId && Array.isArray(stored.entries) && stored.entries.length > 0) {
          setAskHistory(stored.entries.slice(0, MAX_ASK_HISTORY));
        }
      }).catch(() => {});
    }
  }, []);

  const addEntry = useCallback((entry: AskHistoryEntry) => {
    setAskHistory((prev) => [...prev, entry].slice(-MAX_ASK_HISTORY));
  }, []);

  return { askHistory, setAskHistory, addEntry, resetForVideo };
};
