import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  AskQuestionSource,
  AnalysisStatus,
  ExtractionActionState,
  PendingClaimPreview,
  SourceCard,
  VerificationStatus,
} from '../../../shared/types';
import { FeedCard } from './FeedCard';
import { AskResponseCard } from './AskResponseCard';
import { buildModelCssVars } from '../styles/modelTheme';
import {
  getStackEntryVariants,
  heroCardEntry,
  heroResolvedEntry,
} from '../styles/motionTokens';

/**
 * Scan reasons that are safe to display to users.
 * Raw AI rationale (e.g. "The transcript ends mid-sentence…") is suppressed —
 * only our own curated strings are allowed through.
 */
const SAFE_SCAN_REASONS = new Set([
  'Catching up to current playback position…',
  'Watching for the next checkable claim.',
  'Listening for checkable claims.',
]);

/** Hero slot state for header sync and dwell management */
export type HeroSlotState =
  | { mode: 'verifying'; claimText: string; timestampSeconds: number | null }
  | { mode: 'resolved'; card: SourceCard; dwellUntil: number }
  | { mode: 'scanning'; timestampSeconds: number | null }
  | { mode: 'idle' };

interface CardFeedProps {
  askHistory?: Array<{
    query: string;
    answer: string;
    timestampSeconds: number;
    sources: AskQuestionSource[];
  }>;
  cards: SourceCard[];
  /** Complete card history (unfiltered) for HISTORY tab */
  allCards?: SourceCard[];
  pendingClaims: PendingClaimPreview[];
  status?: AnalysisStatus;
  chunksScanned?: number;
  lastScannedTimestamp?: number | null;
  currentScanPreview?: string | null;
  scanEntities?: string[];
  scanActionState?: ExtractionActionState | null;
  scanReason?: string | null;
  liveTimestampSeconds?: number | null;
  isPinned?: boolean;
  pinToTop?: () => void;
  onEntitySelect?: (entityLabel: string) => void;
  onRetryTranscript?: () => void;
  selectedModel?: string;
  activeTab?: 'live' | 'history';
  /** Called when hero slot state changes (for header sync) */
  onHeroStateChange?: (state: HeroSlotState) => void;
}

const VERDICT_META: Record<
  VerificationStatus,
  {
    accentRgb: string;
  }
> = {
  supported: {
    accentRgb: 'var(--sc-supported-rgb)',
  },
  partial: {
    accentRgb: 'var(--sc-partial-rgb)',
  },
  disputed: {
    accentRgb: 'var(--sc-disputed-rgb)',
  },
  unverifiable: {
    accentRgb: 'var(--sc-neutral-rgb)',
  },
};

const FEED_RAIL_LAYOUT = {
  '--rail-left': '46px',
  '--rail-node-left': '42px',
  '--rail-connector-left': '50px',
} as CSSProperties;

const MAX_HISTORY_ROWS = 20;

// Dwell timing: resolved hero card stays promoted for minimum time before yielding
// to new pending claims. This prevents the jarring "blink" when a claim resolves
// and a new one immediately arrives.
const MIN_RESOLVED_DWELL_MS = 1500; // 1.5s minimum dwell

export type LiveStripMode = 'primary' | 'forming' | 'watching';

export type PromotedLiveHeroMode = 'none' | 'pending' | 'checked';

export type LiveNoHeroCardMode =
  | 'none'
  | 'scanning'
  | 'no-transcript'
  | 'error'
  | 'loading';

export const resolvePromotedLiveLayout = ({
  activeTab,
  hasCheckedCard,
  hasPendingClaim,
}: {
  activeTab: 'live' | 'history';
  hasCheckedCard: boolean;
  hasPendingClaim: boolean;
}): {
  heroMode: PromotedLiveHeroMode;
  olderCardsStartIndex: number;
} => {
  if (activeTab !== 'live') {
    return {
      heroMode: 'none',
      olderCardsStartIndex: 0,
    };
  }

  if (hasPendingClaim) {
    return {
      heroMode: 'pending',
      olderCardsStartIndex: 0,
    };
  }

  if (hasCheckedCard) {
    return {
      heroMode: 'checked',
      olderCardsStartIndex: 1,
    };
  }

  return {
    heroMode: 'none',
    olderCardsStartIndex: 0,
  };
};

export const getLiveStripMode = ({
  activeTab,
  status,
  hasCheckedCard,
  hasPendingClaim,
  hasScanSignal,
}: {
  activeTab: 'live' | 'history';
  status: AnalysisStatus;
  hasCheckedCard: boolean;
  hasPendingClaim: boolean;
  hasScanSignal: boolean;
}): LiveStripMode | null => {
  if (activeTab !== 'live' || hasPendingClaim) {
    return null;
  }

  if (status === 'ready') {
    return 'watching';
  }

  if (status === 'monitoring' || status === 'verifying') {
    if (!hasScanSignal && !hasCheckedCard) {
      return null;
    }
    return hasCheckedCard ? 'forming' : 'primary';
  }

  if (status === 'loading' && !hasCheckedCard && hasScanSignal) {
    return 'primary';
  }

  return null;
};

export const getLiveNoHeroCardMode = ({
  activeTab,
  effectiveHeroMode,
  status,
  liveStripMode,
}: {
  activeTab: 'live' | 'history';
  effectiveHeroMode: PromotedLiveHeroMode;
  status: AnalysisStatus;
  liveStripMode: LiveStripMode | null;
}): LiveNoHeroCardMode => {
  if (activeTab !== 'live' || effectiveHeroMode !== 'none') {
    return 'none';
  }

  if (status === 'no-transcript') {
    return 'no-transcript';
  }

  if (status === 'error') {
    return 'error';
  }

  if (liveStripMode) {
    return 'scanning';
  }

  if (status === 'loading') {
    return 'loading';
  }

  return 'none';
};

// Stack entry variants now imported from motionTokens

/* ── Main feed ── */

export const CardFeed = ({
  askHistory = [],
  cards,
  pendingClaims,
  status = 'idle',
  chunksScanned = 0,
  lastScannedTimestamp = null,
  currentScanPreview = null,
  scanEntities = [],
  scanActionState = null,
  scanReason = null,
  liveTimestampSeconds = null,
  isPinned = true,
  pinToTop,
  activeTab = 'live',
  selectedModel = 'gemini-3.1-flash-lite-preview',
  allCards,
  onHeroStateChange,
}: CardFeedProps) => {
  const prefersReducedMotion = useReducedMotion();
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const enableListLayoutAnimations = !prefersReducedMotion;
  const isInitialLoading =
    status === 'loading' &&
    cards.length === 0 &&
    pendingClaims.length === 0 &&
    chunksScanned === 0;

  // ── Basic derived values (needed by dwell logic) ──
  const latestCheckedCard = activeTab === 'live' ? (cards[0] ?? null) : null;
  const latestPendingClaim = pendingClaims[0] ?? null;
  const hasScanSignal =
    chunksScanned > 0 ||
    lastScannedTimestamp !== null ||
    Boolean(currentScanPreview);
  const liveStripMode = getLiveStripMode({
    activeTab,
    status,
    hasCheckedCard: Boolean(latestCheckedCard),
    hasPendingClaim: Boolean(latestPendingClaim),
    hasScanSignal,
  });

  // ── Dwell state for resolved hero cards ──
  // When a claim resolves, we hold it in the hero slot for MIN_RESOLVED_DWELL_MS
  // even if a new pending claim arrives. This prevents the jarring "blink" when
  // focus rapidly shifts from a just-resolved card to a new verifying claim.
  const [dwellState, setDwellState] = useState<{
    card: SourceCard;
    dwellUntil: number;
    yieldedToNext: boolean;
  } | null>(null);

  // Track previous values to detect transitions
  const prevLatestPendingRef = useRef<PendingClaimPreview | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref to dwellState so it can be read in effects without being a dependency
  // (adding dwellState as a dep causes the cleanup to kill the timer on every state update)
  const dwellStateRef = useRef(dwellState);
  dwellStateRef.current = dwellState;

  // ── Dwell logic: start dwell when a pending claim resolves ──
  // Does NOT list dwellState as a dep — its cleanup must not cancel the dwell timer.
  useEffect(() => {
    const wasPending = prevLatestPendingRef.current !== null;
    const isNowPending = latestPendingClaim !== null;

    if (wasPending && !isNowPending && latestCheckedCard) {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      const dwellUntil = Date.now() + MIN_RESOLVED_DWELL_MS;
      setDwellState({ card: latestCheckedCard, dwellUntil, yieldedToNext: false });
      dwellTimerRef.current = setTimeout(() => {
        setDwellState((prev) => (prev ? { ...prev, yieldedToNext: true } : null));
      }, MIN_RESOLVED_DWELL_MS);
    }

    prevLatestPendingRef.current = latestPendingClaim;
  }, [latestPendingClaim, latestCheckedCard]);

  // ── Dwell logic: clear dwell when a different checked card arrives ──
  useEffect(() => {
    const currentDwell = dwellStateRef.current;
    if (currentDwell && latestCheckedCard && currentDwell.card.id !== latestCheckedCard.id) {
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
      setDwellState(null);
    }
  }, [latestCheckedCard]);

  // ── Cleanup dwell timer on unmount ──
  useEffect(() => {
    return () => {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    };
  }, []);

  // ── Compute effective hero mode considering dwell ──
  // If we're in dwell period, force heroMode to 'checked' even if there's a new pending claim
  const effectiveHeroMode: PromotedLiveHeroMode = useMemo(() => {
    if (activeTab !== 'live') return 'none';

    // During dwell, show the resolved card regardless of new pending claims
    if (dwellState && !dwellState.yieldedToNext) {
      return 'checked';
    }

    // Normal behavior: pending claim takes priority
    if (latestPendingClaim) return 'pending';
    if (latestCheckedCard) return 'checked';
    return 'none';
  }, [activeTab, dwellState, latestPendingClaim, latestCheckedCard]);

  // ── Compute and emit hero slot state ──
  const heroState: HeroSlotState = useMemo(() => {
    if (effectiveHeroMode === 'pending' && latestPendingClaim) {
      return {
        mode: 'verifying',
        claimText: latestPendingClaim.claimText,
        timestampSeconds: latestPendingClaim.timestampSeconds,
      };
    }

    if (effectiveHeroMode === 'checked' && latestCheckedCard) {
      // Check if we're in dwell period
      const isDwell = dwellState && dwellState.card.id === latestCheckedCard.id && !dwellState.yieldedToNext;
      return {
        mode: 'resolved',
        card: latestCheckedCard,
        dwellUntil: isDwell ? dwellState!.dwellUntil : 0,
      };
    }

    if (liveStripMode && activeTab === 'live') {
      return {
        mode: 'scanning',
        timestampSeconds: lastScannedTimestamp ?? liveTimestampSeconds,
      };
    }

    return { mode: 'idle' };
  }, [effectiveHeroMode, latestPendingClaim, latestCheckedCard, dwellState, liveStripMode, activeTab, lastScannedTimestamp, liveTimestampSeconds]);

  // Notify parent of hero state changes
  useEffect(() => {
    onHeroStateChange?.(heroState);
  }, [heroState, onHeroStateChange]);

  // ── Derived values (after dwell/hero state computation) ──
  const displayCards = useMemo(
    () => (activeTab === 'history' && allCards ? allCards : cards),
    [activeTab, allCards, cards]
  );

  const checkingTimestamp = latestPendingClaim?.timestampSeconds ?? lastScannedTimestamp;
  const activePreview = latestPendingClaim?.claimText?.trim() || currentScanPreview?.trim() || '';
  const activeReadingTimestamp = lastScannedTimestamp ?? liveTimestampSeconds;
  const isLiveReading = liveStripMode !== null || status === 'verifying';

  const liveNoHeroCardMode = getLiveNoHeroCardMode({
    activeTab,
    effectiveHeroMode,
    status,
    liveStripMode,
  });

  const showResumeLive =
    !isPinned &&
    isLiveReading &&
    activeTab === 'live' &&
    (cards.length > 0 || pendingClaims.length > 0 || Boolean(currentScanPreview));

  // Compute olderCards based on effective hero mode (not raw layout)
  // During dwell, latest checked card stays in hero slot, so olderCards starts from index 0
  const olderCardsStartIndex = effectiveHeroMode === 'checked' ? 1 : 0;
  const olderCards = useMemo(
    () => (
      activeTab === 'live'
        ? cards.slice(olderCardsStartIndex, olderCardsStartIndex + MAX_HISTORY_ROWS)
        : displayCards
    ),
    [activeTab, cards, displayCards, olderCardsStartIndex]
  );
  const hasLiveFeedSurface =
    activeTab === 'live' &&
    (effectiveHeroMode !== 'none' || liveNoHeroCardMode !== 'none' || olderCards.length > 0);
  const liveStackTailDensity =
    olderCards.length >= 2
      ? 'stacked'
      : olderCards.length === 1
        ? 'single'
        : effectiveHeroMode !== 'none'
          ? 'hero'
          : 'ambient';

  useEffect(() => {
    if (!expandedClaimId) {
      return;
    }

    if (!olderCards.some((card) => card.id === expandedClaimId)) {
      setExpandedClaimId(null);
    }
  }, [expandedClaimId, olderCards]);

  const modelCssVars = buildModelCssVars(selectedModel);

  return (
    <div className="relative" style={modelCssVars}>
      <div
        className={`relative flex flex-col gap-2.5 px-3 pb-3 ${activeTab === 'live' ? 'pt-0.5' : 'pt-2'}`}
        style={{ ...FEED_RAIL_LAYOUT, ...modelCssVars } as CSSProperties}
      >
        <div className="signal-rail signal-rail-feed" />

        {isInitialLoading ? (
          <FeedCard
            size="skeleton"
            timestampSeconds={null}
            accentRgb="var(--sc-neutral-rgb)"
          />
        ) : (
          <>
            {/* Hero slot: unified FeedCard for all states */}
            {activeTab === 'live' && (
              <AnimatePresence mode="popLayout">
                {effectiveHeroMode === 'pending' && latestPendingClaim && (
                  <motion.div
                    key={latestPendingClaim.id}
                    initial={prefersReducedMotion ? false : heroCardEntry.initial}
                    animate={heroCardEntry.animate}
                    exit={heroCardEntry.exit}
                    transition={heroCardEntry.transition}
                  >
                    <FeedCard
                      size="verifying"
                      timestampSeconds={checkingTimestamp}
                      claimText={latestPendingClaim.claimText || 'Checking that claim…'}
                      glow
                    />
                  </motion.div>
                )}
                
                {effectiveHeroMode === 'checked' && latestCheckedCard && (
                  <motion.div
                    layout={!prefersReducedMotion}
                    layoutId={`card-${latestCheckedCard.id}`}
                    initial={prefersReducedMotion ? false : heroResolvedEntry.initial}
                    animate={heroResolvedEntry.animate}
                    exit={heroResolvedEntry.exit}
                    transition={heroResolvedEntry.transition}
                  >
                    <FeedCard
                      size="hero"
                      timestampSeconds={latestCheckedCard.timestampSeconds}
                      card={latestCheckedCard}
                      accentRgb={VERDICT_META[latestCheckedCard.status].accentRgb}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            )}

            {/* Scanning / idle / error states - unified FeedCard */}
            {liveNoHeroCardMode !== 'none' && (
              liveNoHeroCardMode === 'no-transcript' ? (
                <FeedCard
                  size="scanning"
                  timestampSeconds={null}
                  previewText="No usable captions were returned for this video."
                  reason="Transcript unavailable"
                />
              ) : liveNoHeroCardMode === 'error' ? (
                <FeedCard
                  size="scanning"
                  timestampSeconds={null}
                  previewText="Something went wrong. Refresh the YouTube tab to try again."
                  reason="Error"
                />
              ) : liveNoHeroCardMode === 'scanning' ? (
                <FeedCard
                  size="scanning"
                  timestampSeconds={activeReadingTimestamp}
                  previewText={
                    activePreview ||
                    (liveStripMode === 'watching'
                      ? 'Watching for the next checkable claim.'
                      : 'Scanning for claims…')
                  }
                  entities={scanEntities}
                  actionState={scanActionState}
                  reason={
                    (scanReason && SAFE_SCAN_REASONS.has(scanReason) ? scanReason : null) ||
                    (liveStripMode === 'watching'
                      ? 'Watching for the next checkable claim.'
                      : 'Listening for checkable claims.')
                  }
                />
              ) : liveNoHeroCardMode === 'loading' ? (
                <FeedCard
                  size="scanning"
                  timestampSeconds={null}
                  previewText="Loading transcript…"
                  reason="Loading transcript…"
                />
              ) : null
            )}

            {/* Checked claims stack - unified compact cards */}
            {olderCards.length > 0 && (
              <motion.div 
                layout={enableListLayoutAnimations} 
                className="feed-card-stack flex flex-col gap-1"
              >
                {activeTab === 'history' && (
                  <div className="px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-sc-muted font-medium">
                      All checked claims
                    </p>
                  </div>
                )}
                {olderCards.map((card, index) => (
                  <motion.div
                    key={card.id}
                    layout={enableListLayoutAnimations}
                    layoutId={enableListLayoutAnimations ? `card-${card.id}` : undefined}
                    custom={index}
                    variants={getStackEntryVariants(prefersReducedMotion)}
                    initial={prefersReducedMotion ? false : 'hidden'}
                    animate={prefersReducedMotion ? undefined : 'visible'}
                    exit={prefersReducedMotion ? undefined : 'exit'}
                  >
                    <FeedCard
                      size="compact"
                      timestampSeconds={card.timestampSeconds}
                      card={card}
                      isExpanded={expandedClaimId === card.id}
                      onToggle={() => {
                        setExpandedClaimId((current) => (current === card.id ? null : card.id));
                      }}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}

            {hasLiveFeedSurface && (
              <div
                className="feed-stack-tail"
                data-density={liveStackTailDensity}
                aria-hidden="true"
              >
                <div className="feed-stack-tail-card feed-stack-tail-card-primary" />
                <div className="feed-stack-tail-card feed-stack-tail-card-secondary" />
              </div>
            )}

            {/* Empty history state */}
            {activeTab === 'history' && displayCards.length === 0 && askHistory.length === 0 && (
              <FeedCard
                size="state"
                badgeLabel="No results yet"
                timestampSeconds={null}
                accentRgb="var(--sc-neutral-rgb)"
                tone="muted"
                headline="Nothing checked yet."
                supportLine="Verified claims will appear here as the video plays. Switch to LIVE to see active scanning."
              />
            )}

            {/* Q&A History (HISTORY tab only) */}
            {activeTab === 'history' && askHistory.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="feed-rail-offset">
                  <div className="ml-1">
                    <p className="feed-section-label feed-section-label-qa">Q&A History</p>
                  </div>
                </div>
                {askHistory.map((entry) => (
                  <AskResponseCard
                    key={`${entry.timestampSeconds}-${entry.query}`}
                    query={entry.query}
                    answer={entry.answer}
                    timestampSeconds={entry.timestampSeconds}
                    sources={entry.sources}
                  />
                ))}
              </div>
            )}

          </>
        )}
      </div>

      {showResumeLive && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={() => pinToTop?.()}
            className="resume-live-btn pointer-events-auto"
          >
            <span
              className="block h-[7px] w-[7px] rotate-45"
              style={{ backgroundColor: 'var(--model-accent-solid)' }}
            />
            <span>Resume Live</span>
          </button>
        </div>
      )}
    </div>
  );
};
