import { useCallback, useEffect, useRef, useState } from 'react';
import type { SourceCard } from '../../../shared/types';

const MAX_CARD_HISTORY = 50;
const STORAGE_KEY = 'cardHistory';

/**
 * Accumulates resolved source cards across video changes,
 * persisted in chrome.storage.session (survives panel close, cleared on tab close).
 */
export const useCardHistory = (incomingCards: SourceCard[], isPrivate = false) => {
  const [cardHistory, setCardHistory] = useState<SourceCard[]>([]);
  const hasRestoredRef = useRef(false);
  const mergedIdsRef = useRef(new Set<string>());

  // Restore from session storage on mount
  useEffect(() => {
    if (isPrivate) {
      hasRestoredRef.current = false;
      setCardHistory([]);
      mergedIdsRef.current.clear();
      return;
    }

    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    chrome.storage.session.get([STORAGE_KEY]).then((result) => {
      const stored = result[STORAGE_KEY] as SourceCard[] | undefined;
      if (Array.isArray(stored) && stored.length > 0) {
        setCardHistory(stored.slice(-MAX_CARD_HISTORY));
        for (const c of stored) mergedIdsRef.current.add(c.id);
      }
    }).catch(() => {});
  }, [isPrivate]);

  // Accumulate new cards as they arrive
  useEffect(() => {
    if (isPrivate) return;
    if (!incomingCards?.length) return;
    const newCards = incomingCards.filter((c) => !mergedIdsRef.current.has(c.id));
    if (newCards.length === 0) return;
    for (const c of newCards) mergedIdsRef.current.add(c.id);
    // Trim dedup set to match the visible history window — prevents unbounded growth in long sessions
    if (mergedIdsRef.current.size > MAX_CARD_HISTORY * 2) {
      const ids = Array.from(mergedIdsRef.current);
      mergedIdsRef.current = new Set(ids.slice(-MAX_CARD_HISTORY));
    }
    setCardHistory((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const toAdd = newCards.filter((c) => !existingIds.has(c.id));
      if (toAdd.length === 0) return prev;
      const merged = [...prev, ...toAdd].slice(-MAX_CARD_HISTORY);
      chrome.storage.session.set({ [STORAGE_KEY]: merged }).catch(() => {});
      return merged;
    });
  }, [incomingCards, isPrivate]);

  const clearHistory = useCallback(() => {
    setCardHistory([]);
    mergedIdsRef.current.clear();
    chrome.storage.session.remove(STORAGE_KEY).catch(() => {});
  }, []);

  return { cardHistory, clearHistory };
};
