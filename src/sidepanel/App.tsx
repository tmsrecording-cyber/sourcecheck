import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { usePinnedTopScroll } from './hooks/usePinnedTopScroll';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { useProviderSettings } from './hooks/useProviderSettings';
import { useNoticeQueue } from './hooks/useNoticeQueue';
import { useProviderErrorGate } from './hooks/useProviderErrorGate';
import { useAskFocusShortcut } from './hooks/useAskFocusShortcut';
import { useLiveStageFlow } from './hooks/useLiveStageFlow';
import { VideoHeader } from './components/VideoHeader';
import { CardFeed } from './components/CardFeed';
import { AskBox } from './components/AskBox';
import { SettingsPanel } from './components/SettingsPanel';
import { NoticeStack } from './components/NoticeStack';
import { SourceCheckLogo } from './components/SourceCheckLogo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useExtensionStorage } from './hooks/useExtensionStorage';
import { useCardHistory } from './hooks/useCardHistory';
import { useAskHistory } from './hooks/useAskHistory';
import {
  buildSettingsSavedNotice,
  getLatestTranscriptFallbackNotice,
} from './utils/notices';
import { getPressSettle } from './styles/motionTokens';
import { lifecycleToAnalysisStatus } from './utils/state';
import { resolveDisplayAnalysisStatus } from './utils/displayAnalysisStatus';
import { DebugStatusPanel, EventTimeline, TranscriptFetchLogPanel } from './components/DebugPanels';
import { hardenStorageAccessLevels } from '../utils/storageAccess';
import type {
  AskQuestionResponse,
  AnalysisStatus,
} from '../../shared/types';

const SHOW_DEBUG =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('debug') === '1';

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
  <div role="status" aria-live="polite" className="flex h-full min-h-0 w-full items-center justify-center bg-sc-bg-0 px-5 font-sc">
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
            style={{ top: '14px' }}
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
  const prefersReducedMotion = useReducedMotion();
  const [askDraft, setAskDraft] = useState('');
  const { askHistory, addEntry: addAskEntry, resetForVideo: resetAskForVideo } = useAskHistory();
  const { cardHistory, clearHistory: clearCardHistory } = useCardHistory(runtimeState.allSourceCards);
  const [isThinking, setIsThinking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'live' | 'history'>('live');
  const [showSettings, setShowSettings] = useState(false);
  const { hasCustomKey } = useProviderSettings();
  const [isRetryingTranscript, setIsRetryingTranscript] = useState(false);
  const { notices, enqueueNotice, dismissNotice } = useNoticeQueue();
  const isMountedRef = useRef(true);
  const lastTranscriptFallbackNoticeAtRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    void hardenStorageAccessLevels().catch((err) => {
      console.warn('[SourceCheck/UI] Storage access hardening failed:', err);
    });
  }, []);

  const { lastProviderError, setLastProviderError, recordSettingsSave } = useProviderErrorGate({
    hasCustomKey,
    runtimeProviderError: runtimeState.lastProviderError,
    showSettings,
    onOpenSettings: () => setShowSettings(true),
  });

  // Reset per-video state; ask history restore is handled by the hook
  useEffect(() => {
    const videoId = runtimeState.currentVideo?.videoId ?? null;
    // M5 PRIVACY: Check if this is a private session (e.g., Google Meet)
    const isPrivate = runtimeState.currentVideo?.sourceContext?.visibility === 'private';
    if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
    setAskDraft('');
    setAskError(null);
    setIsThinking(false);
    setActiveTab('live');
    setLastProviderError(null);
    setIsRetryingTranscript(false);
    lastTranscriptFallbackNoticeAtRef.current = 0;
    resetAskForVideo(videoId, isPrivate);
  }, [runtimeState.currentVideo?.videoId, runtimeState.currentVideo?.sourceContext?.visibility, resetAskForVideo]);

  const analysisStatus = lifecycleToAnalysisStatus(runtimeState.lifecycle);
  const hasAskContext = (transcript?.length ?? 0) > 0 || runtimeState.sourceCards.length > 0;
  const canFocusAsk = hasAskContext && !isThinking;
  const pressFeedback = getPressSettle(prefersReducedMotion);
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
  const liveFlow = useLiveStageFlow({
    activeTab,
    currentVideoId: runtimeState.currentVideo?.videoId ?? null,
    status: displayAnalysisStatus,
    playbackState: runtimeState.playbackState,
    cards: runtimeState.sourceCards,
    pendingClaims: runtimeState.pendingClaims,
    currentScanPreview: runtimeState.currentScanPreview,
    currentScanEntities: runtimeState.currentScanEntities,
    currentScanActionState: runtimeState.currentScanActionState,
    currentScanReason: runtimeState.currentScanReason,
    lastScannedTimestamp: runtimeState.lastScannedTimestamp,
  });

  useAskFocusShortcut({ activeTab, setActiveTab, canFocusAsk, showSettings });

  useLayoutEffect(() => {
    previousDisplayAnalysisStatusRef.current = displayAnalysisStatus;
  }, [displayAnalysisStatus]);

  useEffect(() => {
    if (isRetryingTranscript && analysisStatus !== 'no-transcript') {
      if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
      setIsRetryingTranscript(false);
    }
  }, [analysisStatus, isRetryingTranscript]);

  // E4: Rate limit feedback — show a notice when a live 429 hits the pipeline.
  // Uses direct message listener (not persisted lastProviderError) so stale state
  // from a previous session never shows a false "paused" toast on load.
  useEffect(() => {
    const listener = (msgRaw: unknown) => {
      if (typeof msgRaw !== 'object' || msgRaw === null) return;
      const msg = msgRaw as Record<string, unknown>;
      if (msg.type !== 'PROVIDER_ERROR') return;
      const payload = msg.payload as Record<string, unknown> | null;
      if (payload?.code === 'RATE_LIMITED') {
        enqueueNotice({
          dedupeKey: 'rate-limited',
          title: 'Verification paused',
          message: 'Rate limit reached — resuming shortly.',
          tone: 'warning',
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [enqueueNotice]);

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

  const feedScrollKey = useMemo(() => {
    return [
      displayAnalysisStatus,
      askHistory.length,
      runtimeState.sourceCards.length,
      runtimeState.pendingClaims.length,
      liveFlow.livePhase,
      liveFlow.stageEntries.length,
      Array.from(liveFlow.dockedKeys).sort().join(','),
      liveFlow.isDocking ? 'docking' : 'steady',
    ].join('::');
  }, [
    displayAnalysisStatus,
    askHistory.length,
    runtimeState.sourceCards.length,
    runtimeState.pendingClaims.length,
    liveFlow.livePhase,
    liveFlow.stageEntries.length,
    liveFlow.dockedKeys,
    liveFlow.isDocking,
  ]);

  const { scrollRef: feedScrollRef, isPinned: isFeedPinned, pinToTop: pinFeedToTop } =
    usePinnedTopScroll<HTMLDivElement>(feedScrollKey);
  const historyItemCount = cardHistory.length + askHistory.length;
  const headerCards = activeTab === 'history' ? cardHistory : runtimeState.allSourceCards;

  const handleAskSubmit = async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery || isThinking) return;
    const submittedVideoId = currentVideoIdRef.current;
    const submittedTimestamp = runtimeState.playbackState?.currentTime ?? runtimeState.lastScannedTimestamp ?? 0;

    setIsThinking(true);
    setAskError(null);

    try {
      const rawResult: unknown = await Promise.race([
        chrome.runtime.sendMessage({
          type: 'ASK_QUESTION',
          payload: { question: trimmedQuery },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out. Please try again.')), 45_000)
        ),
      ]);

      if (!isMountedRef.current || currentVideoIdRef.current !== submittedVideoId) {
        return;
      }

      if (!rawResult || typeof rawResult !== 'object') {
        setAskError('Could not answer that yet.');
        return;
      }

      const result = rawResult as AskQuestionResult;
      if (result.status !== 'ok') {
        setAskError(result.error || 'Could not answer that yet.');
        return;
      }

      if (typeof result.answer !== 'string') {
        setAskError('Could not answer that yet.');
        return;
      }

      setAskDraft('');
      addAskEntry({
        query: trimmedQuery,
        answer: result.answer,
        timestampSeconds: submittedTimestamp,
        sources: result.sources ?? [],
      });
      setActiveTab('history');
    } catch (askSubmitError: unknown) {
      if (isMountedRef.current && currentVideoIdRef.current === submittedVideoId) {
        setAskError(getErrorMessage(askSubmitError, 'Could not answer that yet.'));
      }
    } finally {
      if (isMountedRef.current && currentVideoIdRef.current === submittedVideoId) {
        setIsThinking(false);
      }
    }
  };

  const handleRetryTranscript = async () => {
    if (!runtimeState.currentVideo?.videoId) return;
    const submittedVideoId = currentVideoIdRef.current;
    // Clear stale errors before attempting fresh retry
    setAskError(null);
    setLastProviderError(null);
    setIsRetryingTranscript(true);
    // Backstop: if analysisStatus never leaves 'no-transcript', clear the retrying flag after 20s
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      if (isMountedRef.current) {
        setIsRetryingTranscript(false);
        setAskError('Transcript retry timed out. Refresh the page.');
      }
    }, 20_000);
    // Best-effort cleanup — do not let it block the actual retry
    void chrome.runtime.sendMessage({ type: 'CLEAR_PROVIDER_ERROR' }).catch(() => {});
    try {
      const retryResponse: unknown = await chrome.runtime.sendMessage({
        type: 'RETRY_TRANSCRIPT',
        payload: { videoId: runtimeState.currentVideo.videoId }
      });
      // MV3 sendMessage only throws on transport failure, not app-level errors.
      // Check the response payload for service-worker-reported failures.
      if (retryResponse && typeof retryResponse === 'object' && (retryResponse as { status?: string }).status === 'error') {
        throw new Error((retryResponse as { error?: string }).error || 'Retry failed');
      }
    } catch (error) {
      if (retryTimeoutRef.current) { clearTimeout(retryTimeoutRef.current); retryTimeoutRef.current = null; }
      console.error('[SourceCheck/UI] Retry transcript failed:', error);
      if (isMountedRef.current && currentVideoIdRef.current === submittedVideoId) {
        setIsRetryingTranscript(false);
        setAskError('Transcript retry failed. Refresh the page.');
      }
    }
  };

  if (showSettings) {
    return (
        <SettingsPanel
        onSaved={() => {
          recordSettingsSave();
          setShowSettings(false);
          setLastProviderError(null);
          enqueueNotice(buildSettingsSavedNotice());
          void chrome.runtime.sendMessage({ type: 'CLEAR_PROVIDER_ERROR' }).catch(() => {});
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
        subcopy="Open a YouTube video to start fact-checking. Claims are checked automatically as you watch — no setup required."
        disclosureNote="Transcript text and questions you ask are processed server-side using Gemini AI. No account or identity data is collected."
      />
    );
  }

  return (
    <div className="hud-shell font-sc">
      <div className="flex h-full min-h-0 w-full flex-col bg-sc-bg-0 relative">
        <div className="tactile-header hud-header z-20 grid h-[52px] flex-shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3">
          <div className="flex items-center gap-2 min-w-0">
            <SourceCheckLogo size={16} className="flex-shrink-0" />
            <div className="w-px h-3.5 bg-sc-border-soft/60 flex-shrink-0" aria-hidden="true" />
          </div>

          <nav className="flex h-full min-w-0 items-center justify-center gap-0.5 overflow-hidden" role="tablist">
              <motion.button
                onClick={() => setActiveTab('live')}
                className={`tab-btn min-w-0 px-2.5 ${activeTab === 'live' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'live'}
                whileTap={pressFeedback}
              >
                LIVE
                <span className={`tab-indicator ${activeTab === 'live' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </motion.button>
              <motion.button
                onClick={() => setActiveTab('history')}
                className={`tab-btn min-w-0 px-2.5 ${activeTab === 'history' ? 'active' : ''}`}
                role="tab"
                aria-selected={activeTab === 'history'}
                whileTap={pressFeedback}
              >
                <span className="flex items-center gap-1.5">
                HISTORY
                {historyItemCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-[14px] px-1 rounded-[3px] bg-sc-surface-1 border border-sc-border-soft/60 font-mono text-[8px] font-semibold text-sc-muted/60 tabular-nums">
                    {historyItemCount}
                  </span>
                )}
              </span>
                <span className={`tab-indicator ${activeTab === 'history' ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true" />
              </motion.button>
          </nav>

          <div className="flex min-w-0 items-center justify-end gap-1.5 flex-shrink-0">
            <motion.button
              onClick={() => setShowSettings(true)}
              className="header-icon-btn h-7 w-7 flex items-center justify-center rounded-md text-sc-muted hover:bg-sc-surface-1 hover:text-sc-text focus:outline-none"
              aria-label="API key settings"
              title="API key settings"
              whileTap={pressFeedback}
            >
              <KeyRound size={14} strokeWidth={1.75} />
            </motion.button>
          </div>
        </div>

        <div ref={feedScrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col pt-0.5">
          {SHOW_DEBUG && (
            <>
              <DebugStatusPanel runtimeState={runtimeState} analysisStatus={displayAnalysisStatus} />
              <EventTimeline runtimeState={runtimeState} />
              <TranscriptFetchLogPanel runtimeState={runtimeState} />
            </>
          )}
          {notices.length > 0 && (
            <div className="sidepanel-notice-lane">
              <NoticeStack notices={notices} onDismiss={dismissNotice} />
            </div>
          )}
          <VideoHeader
            title={runtimeState.currentVideo.title}
            channel={runtimeState.currentVideo.channel}
            activeTab={activeTab}
            status={displayAnalysisStatus}
            playbackState={runtimeState.playbackState}
            lastScannedTimestamp={runtimeState.lastScannedTimestamp}
            cards={headerCards}
            livePhase={liveFlow.livePhase}
            liveStripCopy={liveFlow.headerStripCopy}
          />
          {runtimeState.currentVideo.sourceContext?.visibility === 'private' && (
            <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-sc-border-soft/60 bg-sc-surface-1/50 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-sc-muted/70">Private session</span>
              <span className="text-[10px] text-sc-muted/60">— claims and captions are not saved.</span>
            </div>
          )}
          <CardFeed
            cards={runtimeState.sourceCards}
            allCards={cardHistory}
            status={displayAnalysisStatus}
            livePhase={liveFlow.livePhase}
            readingVariant={liveFlow.readingVariant}
            readingPreview={liveFlow.readingPreview}
            readingTimestamp={liveFlow.readingTimestamp}
            stageEntries={liveFlow.stageEntries}
            dockedKeys={liveFlow.dockedKeys}
            recentChecks={liveFlow.recentChecks}
            queuedCount={liveFlow.queuedCount}
            showLiveCheckLabel={liveFlow.showLiveCheckLabel}
            isPinned={isFeedPinned}
            pinToTop={pinFeedToTop}
            chunksScanned={runtimeState.chunksScanned}
            askHistory={askHistory}
            onRetryTranscript={handleRetryTranscript}
            onClearHistory={clearCardHistory}
            activeTab={activeTab}
          />
        </div>
        <AskBox
          transcript={transcript}
          cards={runtimeState.sourceCards}
          queryDraft={askDraft}
          onQueryDraftChange={(v) => { setAskDraft(v); if (askError) setAskError(null); }}
          isThinking={isThinking}
          onSubmit={handleAskSubmit}
          error={askError}
        />
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
