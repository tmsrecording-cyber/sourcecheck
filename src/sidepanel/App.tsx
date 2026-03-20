import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePinnedTopScroll } from './hooks/usePinnedTopScroll';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { FREEMIUM_MODEL } from '../../shared/types';
import { PROVIDER_SETTINGS_KEY, hasStoredProviderApiKey } from '../background/providers/types';
import { VideoHeader } from './components/VideoHeader';
import { CardFeed, type HeroSlotState } from './components/CardFeed';
import { AskBox, ASK_INPUT_ID } from './components/AskBox';
import { ModelPicker } from './components/ModelPicker';
import { SettingsPanel } from './components/SettingsPanel';
import { NoticeStack } from './components/NoticeStack';
import { SourceCheckLogo } from './components/SourceCheckLogo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useExtensionStorage } from './hooks/useExtensionStorage';
import { shouldHandleAskShortcut } from './utils/askShortcut';
import {
  buildModelChangedNotice,
  buildSettingsSavedNotice,
  getLatestTranscriptFallbackNotice,
  type PendingSidepanelNotice,
  type SidepanelNotice,
} from './utils/notices';
import { lifecycleToAnalysisStatus } from './utils/state';
import { resolveDisplayAnalysisStatus } from './utils/displayAnalysisStatus';
import { DebugStatusPanel, EventTimeline, TranscriptFetchLogPanel } from './components/DebugPanels';
import { hardenStorageAccessLevels } from '../utils/storageAccess';
import type {
  AskQuestionResponse,
  AskQuestionSource,
  AnalysisStatus,
  ProviderErrorState,
} from '../../shared/types';

const SHOW_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

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
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
};

const MAX_ASK_HISTORY = 50;

const useLiveRef = <T,>(value: T) => {
  const ref = useRef(value);

  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
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
  <div className="flex h-full min-h-0 w-full items-center justify-center bg-sc-bg-0 px-5 font-sc">
    <div className="w-full max-w-[320px]">
        <div className="instrument-shell px-5 py-5 border border-sc-border shadow-sc-main bg-sc-surface-glass backdrop-blur-md">
          <div className="signal-rail" style={{ left: '24px', top: '18px', bottom: '18px' }} />
          <div className="relative pl-[42px]">
            <span
              className={`rail-node ${error ? 'bg-sc-disputed animate-pulse' : 'bg-sc-accent animate-rail-node-pulse'}`}
              style={{
                top: '10px',
                boxShadow: error
                  ? '0 0 0 4px rgba(var(--sc-disputed-rgb), 0.16), 0 0 10px rgba(var(--sc-disputed-rgb), 0.20)'
                  : '0 0 0 4px rgba(var(--sc-model-blue-rgb), 0.12), 0 0 10px rgba(var(--sc-model-blue-rgb), 0.18)',
              }}
            />
            <span
              className={`rail-connector absolute left-[26px] h-[1px] w-[14px] bg-gradient-to-r to-transparent opacity-80 ${error ? 'from-sc-disputed' : 'from-sc-accent'}`}
              style={{
                top: '14px',
              }}
          />
          <div className="capture-plate ml-1 px-4 py-4 border border-sc-border-soft bg-sc-surface-0 shadow-sc-soft">
            <div className={`font-mono text-[9px] font-bold tracking-[0.2em] uppercase ${error ? 'text-sc-disputed' : 'text-sc-accent-soft'}`}>
              {error ? 'Instrument fault' : 'Instrument standby'}
            </div>
            <div className="mt-3 flex items-center gap-3">
              {error ? <AlertTriangle size={16} className="text-sc-disputed" /> : <SourceCheckLogo size={20} />}
              <h1 className="text-[16px] font-bold tracking-tight text-sc-text">{label}</h1>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-sc-text-soft">{subcopy}</p>
            {disclosureNote && (
              <p className="mt-4 border-t border-sc-line-strong pt-3 text-[11.5px] leading-relaxed text-sc-muted/80">{disclosureNote}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
);

export const App = () => {
  const { isStorageReady, runtimeState, transcript, currentVideoIdRef } = useExtensionStorage();
  const [askDraft, setAskDraft] = useState('');
  const [askHistory, setAskHistory] = useState<AskHistoryEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');
  const [showSettings, setShowSettings] = useState(false);
  const [lastProviderError, setLastProviderError] = useState<ProviderErrorState | null>(null);
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const [isRetryingTranscript, setIsRetryingTranscript] = useState(false);
  const [notices, setNotices] = useState<SidepanelNotice[]>([]);
  // Hero slot state for header sync - keeps header aligned with promoted card dwell
  const [heroState, setHeroState] = useState<HeroSlotState>({ mode: 'idle' });
  const isMountedRef = useRef(true);
  const pendingAskFocusRef = useRef(false);
  const lastSettingsSaveAtRef = useRef(0);
  const hydratedProviderErrorSignatureRef = useRef<string | null>(null);
  const noticeTimersRef = useRef<Map<string, number>>(new Map());
  const lastTranscriptFallbackNoticeAtRef = useRef(0);
  
  // Refs to avoid stale closures in message listeners
  const hasCustomKeyRef = useLiveRef(hasCustomKey);
  const lastProviderErrorRef = useLiveRef(lastProviderError);

  const dismissNotice = useCallback((id: string) => {
    const timerId = noticeTimersRef.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      noticeTimersRef.current.delete(id);
    }

    setNotices((currentNotices) => currentNotices.filter((notice) => notice.id !== id));
  }, []);

  const enqueueNotice = useCallback((notice: PendingSidepanelNotice) => {
    setNotices((currentNotices) => {
      const nextNotice: SidepanelNotice = {
        ...notice,
        id: notice.dedupeKey,
      };
      const withoutDuplicate = currentNotices.filter((entry) => entry.id !== notice.dedupeKey);
      return [nextNotice, ...withoutDuplicate].slice(0, 3);
    });

    const existingTimerId = noticeTimersRef.current.get(notice.dedupeKey);
    if (existingTimerId !== undefined) {
      window.clearTimeout(existingTimerId);
    }

    const timerId = window.setTimeout(() => {
      dismissNotice(notice.dedupeKey);
    }, 3600);

    noticeTimersRef.current.set(notice.dedupeKey, timerId);
  }, [dismissNotice]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => () => {
    noticeTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    noticeTimersRef.current.clear();
  }, []);

  useEffect(() => {
    void hardenStorageAccessLevels();
  }, []);

  useEffect(() => {
    setLastProviderError(runtimeState.lastProviderError ?? null);
  }, [runtimeState.lastProviderError]);

  useEffect(() => {
    const code = runtimeState.lastProviderError?.code;
    const message = runtimeState.lastProviderError?.message;
    const signature = code || message ? `${code ?? ''}::${message ?? ''}` : null;

    if (!signature) {
      hydratedProviderErrorSignatureRef.current = null;
      return;
    }

    const isHydratedUserKeyError = hasCustomKey && (
      code === 'AUTH_ERROR' ||
      code === 'INVALID_API_KEY' ||
      code === 'QUOTA_EXHAUSTED'
    );

    if (
      isHydratedUserKeyError &&
      !showSettings &&
      hydratedProviderErrorSignatureRef.current !== signature
    ) {
      hydratedProviderErrorSignatureRef.current = signature;
      setShowSettings(true);
    }
  }, [hasCustomKey, runtimeState.lastProviderError, showSettings]);

  // Check BYOK status from storage
  useEffect(() => {
    let cancelled = false;

    const checkByokStatus = async () => {
      try {
        const result = await chrome.storage.local.get([PROVIDER_SETTINGS_KEY]);
        if (cancelled || !isMountedRef.current) {
          return;
        }

        setHasCustomKey(hasStoredProviderApiKey(result[PROVIDER_SETTINGS_KEY]));
      } catch {
        // Ignore transient storage read failures; the onChanged listener will retry.
      }
    };

    void checkByokStatus();

    // Listen for storage changes to update BYOK status in real-time
    const storageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === 'local' && changes[PROVIDER_SETTINGS_KEY]) {
        void checkByokStatus();
      }
    };

    chrome.storage.onChanged.addListener(storageListener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(storageListener);
    };
  }, []);

  useEffect(() => {
    setAskDraft('');
    setAskHistory([]);
    setAskError(null);
    setIsThinking(false);
    setActiveTab('live');
    // Clear stale provider errors when switching videos
    setLastProviderError(null);
    setIsRetryingTranscript(false);
    lastTranscriptFallbackNoticeAtRef.current = 0;
  }, [runtimeState.currentVideo?.videoId]);

  const analysisStatus = lifecycleToAnalysisStatus(runtimeState.lifecycle);
  const effectiveSelectedModel = hasCustomKey ? runtimeState.selectedModel : FREEMIUM_MODEL;
  const hasAskContext = (transcript?.length ?? 0) > 0 || runtimeState.sourceCards.length > 0;
  const canFocusAsk = hasAskContext && !isThinking;
  const activeTabRef = useLiveRef(activeTab);
  const canFocusAskRef = useLiveRef(canFocusAsk);
  const showSettingsRef = useLiveRef(showSettings);
  const previousDisplayAnalysisStatusRef = useRef<AnalysisStatus>(analysisStatus);
  const resolvedDisplayAnalysisStatus = resolveDisplayAnalysisStatus({
    previousStatus: previousDisplayAnalysisStatusRef.current,
    nextStatus: analysisStatus,
    sourceCardCount: runtimeState.sourceCards.length,
    pendingClaimCount: runtimeState.pendingClaims.length,
    transcriptChunkCount: runtimeState.transcriptChunkCount,
  });
  const displayAnalysisStatus =
    isRetryingTranscript && analysisStatus === 'no-transcript'
      ? 'loading'
      : resolvedDisplayAnalysisStatus;

  const focusAskInput = useCallback(() => {
    if (typeof document === 'undefined') {
      return false;
    }

    const input = document.getElementById(ASK_INPUT_ID);
    if (!(input instanceof HTMLInputElement) || input.disabled) {
      return false;
    }

    input.focus();
    const caretPosition = input.value.length;
    input.setSelectionRange?.(caretPosition, caretPosition);
    return document.activeElement === input;
  }, []);

  useLayoutEffect(() => {
    previousDisplayAnalysisStatusRef.current = displayAnalysisStatus;
  }, [displayAnalysisStatus]);

  useEffect(() => {
    if (isRetryingTranscript && analysisStatus !== 'no-transcript') {
      setIsRetryingTranscript(false);
    }
  }, [analysisStatus, isRetryingTranscript]);

  useEffect(() => {
    const fallbackNotice = getLatestTranscriptFallbackNotice(
      runtimeState.transcriptFetchLog,
      lastTranscriptFallbackNoticeAtRef.current,
    );

    if (!fallbackNotice) {
      return;
    }

    lastTranscriptFallbackNoticeAtRef.current = fallbackNotice.entryAt;
    enqueueNotice(fallbackNotice.notice);
  }, [enqueueNotice, runtimeState.transcriptFetchLog]);

  useEffect(() => {
    if (!pendingAskFocusRef.current || showSettings || activeTab !== 'live' || !canFocusAsk) {
      return;
    }

    const timerId = window.setTimeout(() => {
      if (focusAskInput()) {
        pendingAskFocusRef.current = false;
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [activeTab, canFocusAsk, focusAskInput, showSettings]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        !shouldHandleAskShortcut({
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          defaultPrevented: event.defaultPrevented,
          target: event.target,
          hasContext: canFocusAskRef.current,
          showSettings: showSettingsRef.current,
        })
      ) {
        return;
      }

      event.preventDefault();
      pendingAskFocusRef.current = true;

      if (activeTabRef.current !== 'live') {
        startTransition(() => {
          setActiveTab('live');
        });
        return;
      }

      if (focusAskInput()) {
        pendingAskFocusRef.current = false;
      }
    };

    document.addEventListener('keydown', handleShortcut);
    return () => {
      document.removeEventListener('keydown', handleShortcut);
    };
  }, [focusAskInput]);

  const feedScrollKey = useMemo(() => {
    return [
      displayAnalysisStatus,
      runtimeState.lastScannedTimestamp ?? 'none',
      runtimeState.chunksScanned,
      runtimeState.currentScanPreview ?? '',
      askHistory.length,
      runtimeState.sourceCards.length,
      runtimeState.pendingClaims.length,
    ].join('::');
  }, [
    displayAnalysisStatus,
    runtimeState.lastScannedTimestamp,
    runtimeState.chunksScanned,
    runtimeState.currentScanPreview,
    askHistory.length,
    runtimeState.sourceCards.length,
    runtimeState.pendingClaims.length
  ]);

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
      setAskHistory((currentHistory) => ([
        ...currentHistory.slice(-(MAX_ASK_HISTORY - 1)),
        {
          query: trimmedQuery,
          answer: result.answer,
          timestampSeconds: submittedTimestamp,
          sources: result.sources ?? [],
        },
      ]));
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
    if (!runtimeState.currentVideo?.videoId) return;
    // Clear stale errors before attempting fresh retry
    setAskError(null);
    setLastProviderError(null);
    setIsRetryingTranscript(true);
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_PROVIDER_ERROR' });
      await chrome.runtime.sendMessage({
        type: 'RETRY_TRANSCRIPT',
        payload: { videoId: runtimeState.currentVideo.videoId }
      });
    } catch (error) {
      console.error('[SourceCheck/UI] Retry transcript failed:', error);
      setIsRetryingTranscript(false);
      if (isMountedRef.current) {
        setAskError('Transcript recovery failed. Please refresh the page.');
      }
    }
  };

  // Listen for provider errors - UNIFIED ERROR HANDLING
  // All errors now flow through classifyError() in background/utils/api.ts
  useEffect(() => {
    const listener = (msgRaw: unknown) => {
      if (typeof msgRaw === 'object' && msgRaw !== null) {
        const msg = msgRaw as Record<string, unknown>;
        if (msg.type === 'PROVIDER_ERROR' && typeof msg.payload === 'object' && msg.payload !== null) {
          const payload = msg.payload as Record<string, unknown>;
          const code = typeof payload.code === 'string' ? payload.code : undefined;
          const message = typeof payload.message === 'string' ? payload.message : undefined;
          const shouldOpenSettings = typeof payload.showSettings === 'boolean' ? payload.showSettings : false;
          
          // Gate: suppress only stale duplicate errors shortly after settings save.
          // This prevents delayed *old* error messages from reopening settings,
          // but allows genuine new errors caused by the just-saved settings to show.
          const timeSinceSave = Date.now() - lastSettingsSaveAtRef.current;
          const isStaleDuplicate = timeSinceSave < 1500 && lastProviderErrorRef.current?.code === code && lastProviderErrorRef.current?.message === message;
          if (isStaleDuplicate) {
            return;
          }
          
          setLastProviderError({ code, message });
          
          // Auto-open settings only for BYOK (user-entered key) flows.
          // Managed-key auth/quota errors should not yank users out of the live view.
          const isUserKeyError = hasCustomKeyRef.current && (code === 'AUTH_ERROR' || code === 'QUOTA_EXHAUSTED' || code === 'INVALID_API_KEY');
          if (shouldOpenSettings || isUserKeyError) {
            setShowSettings(true);
          }
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  if (showSettings) {
    return (
        <SettingsPanel 
        onSaved={() => {
          lastSettingsSaveAtRef.current = Date.now();
          setShowSettings(false);
          setLastProviderError(null);
          enqueueNotice(buildSettingsSavedNotice());
          void chrome.runtime.sendMessage({ type: 'CLEAR_PROVIDER_ERROR' }).catch(() => {});
        }} 
        lastError={lastProviderError}
        effectiveModel={effectiveSelectedModel}
      />
    );
  }

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
    <div className="hud-shell font-sc">
      <div className="hud-grid" aria-hidden="true" />
      <div className="hud-circuit" aria-hidden="true" />
      <div className="flex h-full min-h-0 w-full flex-col bg-sc-bg-0 relative">
        <NoticeStack notices={notices} onDismiss={dismissNotice} />
        <div className="tactile-header hud-header z-20 grid h-[52px] flex-shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <SourceCheckLogo size={16} className="flex-shrink-0" />
            <div className="w-px h-3.5 bg-sc-border-soft/60 flex-shrink-0" aria-hidden="true" />
          </div>

          <nav className="flex h-full min-w-0 items-center justify-center gap-0.5 overflow-hidden" role="tablist">
              <button
                onClick={() => setActiveTab('live')}
                className={`tab-btn min-w-0 px-2.5 transition-all duration-300 ease-out ${activeTab === 'live' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'live'}
              >
                LIVE
                <span className={`tab-indicator transition-all duration-300 ease-out ${activeTab === 'live' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`tab-btn min-w-0 px-2.5 transition-all duration-300 ease-out ${activeTab === 'history' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'history'}
              >
                HISTORY
                <span className={`tab-indicator transition-all duration-300 ease-out ${activeTab === 'history' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </button>
          </nav>

          <div className="flex min-w-0 items-center justify-end gap-1.5 flex-shrink-0">
            <ModelPicker 
              selectedModel={effectiveSelectedModel} 
              hasCustomKey={hasCustomKey}
              compact
              onModelChange={async (model) => {
                if (model === effectiveSelectedModel) {
                  return;
                }

                setLastProviderError(null);
                try {
                  await chrome.runtime.sendMessage({ type: 'MODEL_CHANGED', model });
                  enqueueNotice(buildModelChangedNotice(model, hasCustomKey));
                } catch (error) {
                  console.error('[SourceCheck/UI] Model change failed:', error);
                }
              }} 
            />
            <button
              onClick={() => setShowSettings(true)}
              className="h-7 w-7 flex items-center justify-center text-sc-muted hover:text-sc-text hover:bg-sc-surface-1 rounded-md transition-all duration-200 focus:outline-none"
              aria-label="API key settings"
              title="API key settings"
            >
              <KeyRound size={14} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div ref={feedScrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col" onScroll={handleFeedScroll}>
          {SHOW_DEBUG && (
            <>
              <DebugStatusPanel runtimeState={runtimeState} analysisStatus={displayAnalysisStatus} />
              <EventTimeline runtimeState={runtimeState} />
              <TranscriptFetchLogPanel runtimeState={runtimeState} />
            </>
          )}
          <VideoHeader
            title={runtimeState.currentVideo.title}
            channel={runtimeState.currentVideo.channel}
            activeTab={activeTab}
            status={displayAnalysisStatus}
            playbackState={runtimeState.playbackState}
            chunksScanned={runtimeState.chunksScanned}
            lastScannedTimestamp={runtimeState.lastScannedTimestamp}
            cards={runtimeState.allSourceCards}
            selectedModel={effectiveSelectedModel}
            heroState={heroState}
          />
          <CardFeed
            cards={runtimeState.sourceCards}
            allCards={runtimeState.allSourceCards}
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
            activeTab={activeTab}
            selectedModel={effectiveSelectedModel}
            onHeroStateChange={setHeroState}
          />
        </div>
        {activeTab === 'live' && (
          <AskBox
            transcript={transcript}
            cards={runtimeState.sourceCards}
            queryDraft={askDraft}
            onQueryDraftChange={setAskDraft}
            isThinking={isThinking}
            onSubmit={handleAskSubmit}
            error={askError}
          />
        )}
      </div>
    </div>
  );
};

export const AppWithBoundary = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithBoundary;
