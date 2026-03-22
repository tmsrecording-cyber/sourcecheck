import { useState, useEffect } from 'react';
import { 
  PROVIDER_SETTINGS_SESSION_KEY, 
  PROVIDER_SETTINGS_LOCAL_KEY, 
  PROVIDER_SETTINGS_KEY,
  hasStoredProviderApiKey,
} from '../../background/providers/types';

/**
 * Tracks whether the user has a custom provider API key stored.
 * Subscribes to storage changes so the value stays current in real time.
 * Uses session-first storage: checks session, then local for "Remember key" fallback.
 */
export const useProviderSettings = () => {
  const [hasCustomKey, setHasCustomKey] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const checkByokStatus = async () => {
      try {
        // Check session storage first (primary location)
        const sessionResult = await chrome.storage.session.get([PROVIDER_SETTINGS_SESSION_KEY]);
        if (cancelled) return;
        
        if (hasStoredProviderApiKey(sessionResult[PROVIDER_SETTINGS_SESSION_KEY])) {
          setHasCustomKey(true);
          return;
        }
        
        // Fallback to local storage (for "Remember key" or legacy)
        const localResult = await chrome.storage.local.get([
          PROVIDER_SETTINGS_LOCAL_KEY, 
          PROVIDER_SETTINGS_KEY
        ]);
        if (cancelled) return;
        
        const hasLocal = hasStoredProviderApiKey(localResult[PROVIDER_SETTINGS_LOCAL_KEY]) ||
                         hasStoredProviderApiKey(localResult[PROVIDER_SETTINGS_KEY]);
        setHasCustomKey(hasLocal);
      } catch {
        // Ignore transient storage read failures; the onChanged listener will retry.
      }
    };

    void checkByokStatus();

    const storageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      // Listen to both session and local storage changes
      if (areaName === 'session' && changes[PROVIDER_SETTINGS_SESSION_KEY]) {
        void checkByokStatus();
      }
      if (areaName === 'local' && (
        changes[PROVIDER_SETTINGS_LOCAL_KEY] || 
        changes[PROVIDER_SETTINGS_KEY]
      )) {
        void checkByokStatus();
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  return { hasCustomKey };
};
