import { useEffect, useMemo, useRef, useState } from 'react';
import { usePinnedTopScroll } from './hooks/usePinnedTopScroll';
import { AlertTriangle, Settings } from 'lucide-react';
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
  const isMountedRef = useRef(true);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  // Use runtimeState.selectedModel directly - single source of truth

  useEffect(() => {
    setAskDraft('');
    setAskHistory([]);
    setAskError(null);
    setIsThinking(false);
    setActiveTab('live');
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
    try {
      await chrome.runtime.sendMessage({
        type: 'RETRY_TRANSCRIPT',
        payload: { videoId: runtimeState.currentVideo.videoId }
      });
    } catch (error) {
      console.error('[SourceCheck/UI] Retry transcript failed:', error);
      setAskError('Failed to retry transcript. Please reload the page and try again.');
    }
  };

  // Listen for provider errors - UNIFIED ERROR HANDLING
  // All errors now flow through classifyError() in background/utils/api.ts
  useEffect(() => {
    const listener = (message: unknown) => {
      if (typeof message === 'object' && message !== null) {
        const msg = message as Record<string, unknown>;
        if (msg.type === 'PROVIDER_ERROR' && typeof msg.payload === 'object' && msg.payload !== null) {
          const payload = msg.payload as Record<string, unknown>;
          const code = typeof payload.code === 'string' ? payload.code : undefined;
          const message = typeof payload.message === 'string' ? payload.message : undefined;
          const shouldOpenSettings = typeof payload.showSettings === 'boolean' ? payload.showSettings : false;
          
          setLastProviderError({ code, message });
          
          // Auto-open settings when error signals it's needed (AUTH, QUOTA, INVALID_KEY)
          // This is the unified behavior across all error paths
          if (shouldOpenSettings || code === 'AUTH_ERROR' || code === 'QUOTA_EXHAUSTED' || code === 'INVALID_API_KEY') {
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
          setShowSettings(false);
          setLastProviderError(null);
        }} 
        lastError={lastProviderError}
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
        <div className="tactile-header flex-shrink-0 flex justify-between items-center h-[44px] px-3.5 hud-header z-20">
          <div className="flex gap-3.5 items-center h-full min-w-0">
            <SourceCheckLogo size={18} className="flex-shrink-0" />
            <div className="w-px h-4 bg-sc-border-soft/60" aria-hidden="true" />
            <nav className="flex gap-0.5 h-full items-center" role="tablist">
              <button
                onClick={() => setActiveTab('live')}
                className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'live'}
              >
                LIVE
                {activeTab === 'live' && <span className="tab-indicator" aria-hidden="true" />}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'history'}
              >
                HISTORY
                {activeTab === 'history' && <span className="tab-indicator" aria-hidden="true" />}
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ModelPicker 
              selectedModel={runtimeState.selectedModel} 
              onModelChange={async (model) => {
                try {
                  await chrome.storage.sync.set({ selectedModel: model });
                  await chrome.runtime.sendMessage({ type: 'MODEL_CHANGED', model });
                } catch (error) {
                  console.error('[SourceCheck/UI] Model change failed:', error);
                }
              }} 
            />
            <button
              onClick={() => setShowSettings(true)}
              className="h-[28px] px-2.5 text-[11px] font-medium tracking-wide border border-sc-border bg-sc-surface-0 hover:bg-sc-surface-1 rounded-md text-sc-text-soft transition-all duration-150 flex items-center gap-1.5 focus:outline-none whitespace-nowrap"
              aria-label="Open settings"
              title="API key settings"
            >
              <Settings size={12} />
              <span>Key</span>
            </button>
          </div>
        </div>

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
