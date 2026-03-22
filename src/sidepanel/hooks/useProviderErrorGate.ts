import { useState, useEffect, useRef } from 'react';
import type { ProviderErrorState } from '../../../shared/types';
import { useLiveRef } from './useLiveRef';

interface ProviderErrorGateOptions {
  hasCustomKey: boolean;
  runtimeProviderError: ProviderErrorState | null | undefined;
  showSettings: boolean;
  onOpenSettings: () => void;
}

export const useProviderErrorGate = ({
  hasCustomKey,
  runtimeProviderError,
  showSettings,
  onOpenSettings,
}: ProviderErrorGateOptions) => {
  const [lastProviderError, setLastProviderError] = useState<ProviderErrorState | null>(null);
  const lastSettingsSaveAtRef = useRef(0);
  const hydratedProviderErrorSignatureRef = useRef<string | null>(null);
  const hasCustomKeyRef = useLiveRef(hasCustomKey);
  const lastProviderErrorRef = useLiveRef(lastProviderError);
  // Stable ref so the message listener never needs to re-register when the callback identity changes
  const onOpenSettingsRef = useLiveRef(onOpenSettings);

  // Sync display error from runtime state
  useEffect(() => {
    setLastProviderError(runtimeProviderError ?? null);
  }, [runtimeProviderError]);

  // Auto-open settings for BYOK users when a hydrated (storage-loaded) error is present
  useEffect(() => {
    const code = runtimeProviderError?.code;
    const message = runtimeProviderError?.message;
    const signature = code || message ? `${code ?? ''}::${message ?? ''}` : null;

    if (!signature) {
      hydratedProviderErrorSignatureRef.current = null;
      return;
    }

    const isHydratedUserKeyError =
      hasCustomKey &&
      (code === 'AUTH_ERROR' || code === 'INVALID_API_KEY' || code === 'QUOTA_EXHAUSTED');

    if (
      isHydratedUserKeyError &&
      !showSettings &&
      hydratedProviderErrorSignatureRef.current !== signature
    ) {
      hydratedProviderErrorSignatureRef.current = signature;
      onOpenSettingsRef.current();
    }
  }, [hasCustomKey, runtimeProviderError, showSettings]);

  // Live PROVIDER_ERROR messages from background service worker
  useEffect(() => {
    const listener = (msgRaw: unknown) => {
      if (typeof msgRaw !== 'object' || msgRaw === null) return;
      const msg = msgRaw as Record<string, unknown>;
      if (msg.type !== 'PROVIDER_ERROR' || typeof msg.payload !== 'object' || msg.payload === null) return;

      const payload = msg.payload as Record<string, unknown>;
      const code = typeof payload.code === 'string' ? payload.code : undefined;
      const message = typeof payload.message === 'string' ? payload.message : undefined;
      const shouldOpenSettings = typeof payload.showSettings === 'boolean' ? payload.showSettings : false;

      // Suppress stale duplicate errors briefly after settings save to prevent
      // a delayed old error message from reopening settings on a fresh save.
      const timeSinceSave = Date.now() - lastSettingsSaveAtRef.current;
      const isStaleDuplicate =
        timeSinceSave < 1500 &&
        lastProviderErrorRef.current?.code === code &&
        lastProviderErrorRef.current?.message === message;
      if (isStaleDuplicate) return;

      setLastProviderError({ code, message });

      // Auto-open settings only for user-key errors — managed-key errors stay silent.
      const isUserKeyError =
        hasCustomKeyRef.current &&
        (code === 'AUTH_ERROR' || code === 'QUOTA_EXHAUSTED' || code === 'INVALID_API_KEY');
      if (shouldOpenSettings || isUserKeyError) {
        onOpenSettingsRef.current();
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const recordSettingsSave = () => {
    lastSettingsSaveAtRef.current = Date.now();
  };

  return { lastProviderError, setLastProviderError, recordSettingsSave };
};
