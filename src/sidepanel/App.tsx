import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePinnedTopScroll } from './hooks/usePinnedTopScroll';
import { AlertTriangle, Settings, KeyRound } from 'lucide-react';
import { PROVIDER_SETTINGS_KEY } from '../background/providers/types';
import { VideoHeader } from './components/VideoHeader';
import { CardFeed } from './components/CardFeed';
import { AskBox } from './components/AskBox';
import { ModelPicker } from './components/ModelPicker';
import { SettingsPanel } from './components/SettingsPanel';
import { SourceCheckLogo } from './components/SourceCheckLogo';
import { useExtensionStorage } from './hooks/useExtensionStorage';
import { lifecycleToAnalysisStatus } from './utils/state';
import { DebugStatusPanel, EventTimeline, TranscriptFetchLogPanel } from './components/DebugPanels';
import type {
  AskQuestionResponse,
  AskQuestionSource,
  AnalysisStatus,
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
            className={`rail-node ${error ? 'bg-sc-disputed animate-pulse shadow-[0_0_0_4px_rgba(198,111,93,0.18)]' : 'bg-sc-accent-soft animate-rail-node-pulse shadow-[0_0_0_4px_rgba(231,210,173,0.18)]'}`}
            style={{
              top: '10px',
            }}
          />
          <span
            className={`rail-connector absolute h-[1px] w-[14px] left-[26px] bg-gradient-to-r to-transparent opacity-80 ${error ? 'from-sc-disputed' : 'from-sc-accent-soft'}`}
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
  const [lastProviderError, setLastProviderError] = useState<{ code?: string; message?: string } | null>(null);
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const isMountedRef = useRef(true);
  const lastSettingsSaveAtRef = useRef(0);
  const byokCheckVersionRef = useRef(0);
  
  // Refs to avoid stale closures in message listeners
  const hasCustomKeyRef = useRef(hasCustomKey);
  const lastProviderErrorRef = useRef(lastProviderError);
  
  useEffect(() => { hasCustomKeyRef.current = hasCustomKey; }, [hasCustomKey]);
  useEffect(() => { lastProviderErrorRef.current = lastProviderError; }, [lastProviderError]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  // Use runtimeState.selectedModel directly - single source of truth

  // Check BYOK status from storage
  useEffect(() => {
    const checkByokStatus = () => {
      const currentVersion = ++byokCheckVersionRef.current;
      chrome.storage.local.get([PROVIDER_SETTINGS_KEY], (result) => {
        if (chrome.runtime.lastError || !isMountedRef.current) {
          return;
        }
        // Only apply if this is still the latest request (monotonic versioning)
        if (currentVersion !== byokCheckVersionRef.current) {
          return;
        }
        const stored = result[PROVIDER_SETTINGS_KEY];
        const hasKey = !!(stored && typeof stored === 'object' && typeof stored.apiKey === 'string' && stored.apiKey.trim());
        setHasCustomKey(hasKey);
      });
    };

    checkByokStatus();

    // Listen for storage changes to update BYOK status in real-time
    const storageListener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[PROVIDER_SETTINGS_KEY]) {
        checkByokStatus();
      }
    };

    chrome.storage.local.onChanged.addListener(storageListener);
    return () => chrome.storage.local.onChanged.removeListener(storageListener);
  }, []);

  useEffect(() => {
    setAskDraft('');
    setAskHistory([]);
    setAskError(null);
    setIsThinking(false);
    setActiveTab('live');
    // Clear stale provider errors when switching videos
    setLastProviderError(null);
    // Note: displayAnalysisStatus is synced separately via the effect below;
    // do not force-set it here to avoid dual authority.
  }, [runtimeState.currentVideo?.videoId]);

  const analysisStatus = lifecycleToAnalysisStatus(runtimeState.lifecycle);
  const [displayAnalysisStatus, setDisplayAnalysisStatus] = useState<AnalysisStatus>(analysisStatus);

  useEffect(() => {
    setDisplayAnalysisStatus((prevStatus) => {
      const shouldHoldUnavailableState =
        prevStatus === 'no-transcript' &&
        analysisStatus === 'loading' &&
        runtimeState.sourceCards.length === 0 &&
        runtimeState.pendingClaims.length === 0 &&
        runtimeState.transcriptChunkCount === 0;

      return shouldHoldUnavailableState ? prevStatus : analysisStatus;
    });
  }, [
    analysisStatus,
    runtimeState.pendingClaims.length,
    runtimeState.sourceCards.length,
    runtimeState.transcriptChunkCount,
  ]);

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
    if (!runtimeState.currentVideo?.videoId) return;
    // Clear stale errors before attempting fresh retry
    setAskError(null);
    setLastProviderError(null);
    try {
      await chrome.runtime.sendMessage({
        type: 'RETRY_TRANSCRIPT',
        payload: { videoId: runtimeState.currentVideo.videoId }
      });
    } catch (error) {
      console.error('[SourceCheck/UI] Retry transcript failed:', error);
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
        }} 
        lastError={lastProviderError}
        effectiveModel={runtimeState.selectedModel}
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
        <div className="tactile-header flex-shrink-0 flex justify-between items-center h-[52px] px-5 hud-header z-20">
          <div className="flex gap-4 items-center h-full min-w-0">
            <SourceCheckLogo size={18} className="flex-shrink-0" />
            <div className="w-px h-4 bg-sc-border-soft/60" aria-hidden="true" />
            <nav className="flex gap-1 h-full items-center" role="tablist">
              <button
                onClick={() => setActiveTab('live')}
                className={`tab-btn transition-all duration-300 ease-out ${activeTab === 'live' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'live'}
              >
                LIVE
                <span className={`tab-indicator transition-all duration-300 ease-out ${activeTab === 'live' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`tab-btn transition-all duration-300 ease-out ${activeTab === 'history' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'history'}
              >
                HISTORY
                <span className={`tab-indicator transition-all duration-300 ease-out ${activeTab === 'history' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ModelPicker 
              selectedModel={runtimeState.selectedModel} 
              hasCustomKey={hasCustomKey}
              onModelChange={async (model) => {
                try {
                  await chrome.runtime.sendMessage({ type: 'MODEL_CHANGED', model });
                } catch (error) {
                  console.error('[SourceCheck/UI] Model change failed:', error);
                }
              }} 
            />
            <button
              onClick={() => setShowSettings(true)}
              className="h-[32px] w-[32px] flex items-center justify-center text-sc-muted hover:text-sc-text hover:bg-sc-surface-1 rounded-md transition-all duration-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-sc-accent/30"
              aria-label="API key settings"
              title="API key settings"
            >
              <KeyRound size={15} strokeWidth={1.75} />
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
            status={displayAnalysisStatus}
            playbackState={runtimeState.playbackState}
            chunksScanned={runtimeState.chunksScanned}
            lastScannedTimestamp={runtimeState.lastScannedTimestamp}
            cards={runtimeState.sourceCards}
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
            selectedModel={runtimeState.selectedModel}
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

// Error Boundary to prevent white-screen crashes
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[SourceCheck] App crashed:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <PanelShell
          label="Something went wrong"
          subcopy="Refresh the YouTube tab to try again."
          error
        />
      );
    }
    return this.props.children;
  }
}

// Export wrapped App with Error Boundary
export const AppWithBoundary = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithBoundary;
