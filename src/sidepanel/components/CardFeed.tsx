import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  AskQuestionSource,
  AnalysisStatus,
  PendingClaimPreview,
  SourceCard,
} from '../../../shared/types';
import { BYOK_DEFAULT_MODEL } from '../../../shared/types';
import { FeedCard } from './FeedCard';
import { AskResponseCard } from './AskResponseCard';
import { buildModelCssVars } from '../styles/modelTheme';
import {
  getStackEntryVariants,
  SOFT_SPRING,
  DURATION,
} from '../styles/motionTokens';


/** @deprecated — kept for API compatibility; the stage now owns this logic */
export type HeroSlotState =
  | { mode: 'verifying'; claimText: string; timestampSeconds: number | null }
  | { mode: 'scanning'; timestampSeconds: number | null }
  | { mode: 'idle'; };

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
  scanActionState?: string | null;
  scanReason?: string | null;
  liveTimestampSeconds?: number | null;
  isPinned?: boolean;
  pinToTop?: () => void;
  onEntitySelect?: (entityLabel: string) => void;
  onRetryTranscript?: () => void;
  selectedModel?: string;
  activeTab?: 'live' | 'history';
  /** @deprecated — no longer used; stage owns its own state */
  onHeroStateChange?: (state: HeroSlotState) => void;
}

const FEED_RAIL_LAYOUT = {
  '--rail-left': '46px',
  '--rail-node-left': '42px',
  '--rail-connector-left': '50px',
} as CSSProperties;

const MAX_HISTORY_ROWS = 20;
void MAX_HISTORY_ROWS; // referenced for future pagination

const STATUS_RGB: Record<string, string> = {
  supported: '129, 201, 149',
  partial: '253, 226, 147',
  disputed: '242, 139, 130',
  unverifiable: '154, 160, 166',
};

// ─── Stage hold durations ─────────────────────────────────────────────────────
/** How long the resolved card holds in the stage before docking (ms) */
const STAGE_HOLD_MS = 2500;
/** Shorter hold when there's a claim queued behind this one */
const STAGE_HOLD_SHORT_MS = 900;

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
  selectedModel = BYOK_DEFAULT_MODEL,
  allCards,
  onRetryTranscript,
}: CardFeedProps) => {
  const prefersReducedMotion = useReducedMotion();
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const enableListLayoutAnimations = !prefersReducedMotion;

  const isInitialLoading =
    status === 'loading' &&
    cards.length === 0 &&
    pendingClaims.length === 0 &&
    chunksScanned === 0;

  // ── Stage state ──────────────────────────────────────────────────────────────
  // The stage owns exactly ONE claim lifecycle at a time.
  // Flow: pending → checking → resolved (hold) → docked into recent checks
  const [stageCardId, setStageCardId] = useState<string | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const displayCards = useMemo(() => allCards ?? cards, [allCards, cards]);

  // Claim key mirrors getClaimKey() in the service worker.
  // PendingClaimPreview.id is this hash; SourceCard.id is a fresh UUID from
  // the backend, so stage lookups must use the claim key, not the card UUID.
  const cardClaimKey = (card: SourceCard) =>
    `${card.claim.timestampSeconds}:${card.claim.claimText.trim().toLowerCase()}`;

  // Cards in stage and feed
  const stageCheckingClaim = pendingClaims.find((c) => c.id === stageCardId) ?? null;
  const stageResolvedCard = displayCards.find((c) => cardClaimKey(c) === stageCardId) ?? null;
  const stageMode: 'listening' | 'checking' | 'resolved' =
    !stageCardId ? 'listening' :
    stageCheckingClaim ? 'checking' :
    stageResolvedCard ? 'resolved' :
    'listening';

  // Recent checks: all resolved cards except the one currently in stage
  const recentChecks = displayCards.filter((c) => cardClaimKey(c) !== stageCardId);

  // Queue: pending claims that are NOT the one in the stage
  const queuedCount = pendingClaims.filter((c) => c.id !== stageCardId).length;

  // Promote next pending claim into stage when stage is empty
  useEffect(() => {
    if (activeTab !== 'live') return;
    if (stageCardId) return;
    const next = pendingClaims[0];
    if (next) setStageCardId(next.id);
  }, [activeTab, pendingClaims, stageCardId]);

  // When stage claim resolves → hold, then dock
  useEffect(() => {
    if (!stageCardId || !stageResolvedCard) return;

    if (stageTimerRef.current) clearTimeout(stageTimerRef.current);

    // Shorten hold when there's a queue waiting
    const holdMs = queuedCount > 0 ? STAGE_HOLD_SHORT_MS : STAGE_HOLD_MS;

    stageTimerRef.current = setTimeout(() => {
      setStageCardId(null);
      stageTimerRef.current = null;
    }, holdMs);

    return () => {
      if (stageTimerRef.current) {
        clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
    };
  }, [stageCardId, stageResolvedCard?.id, queuedCount]);

  // Safety: clear stage if claim vanished entirely (edge case)
  useEffect(() => {
    if (!stageCardId) return;
    if (!stageCheckingClaim && !stageResolvedCard) setStageCardId(null);
  }, [stageCardId, stageCheckingClaim, stageResolvedCard]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    };
  }, []);

  // Clear expanded card if it leaves recent checks
  useEffect(() => {
    if (!expandedClaimId) return;
    if (!recentChecks.some((c) => c.id === expandedClaimId)) setExpandedClaimId(null);
  }, [expandedClaimId, recentChecks]);

  const hasScanSignal = chunksScanned > 0 || lastScannedTimestamp !== null;
  const isLiveReading = (status === 'monitoring' || status === 'verifying') && hasScanSignal;
  const showResumeLive =
    !isPinned &&
    isLiveReading &&
    activeTab === 'live' &&
    (cards.length > 0 || pendingClaims.length > 0);

  const modelCssVars = buildModelCssVars(selectedModel);

  return (
    <div className="relative" style={modelCssVars}>
      <div
        className={`relative flex flex-col gap-0 ${activeTab === 'live' ? 'pt-1' : 'pt-2'}`}
        style={{ ...FEED_RAIL_LAYOUT, ...modelCssVars } as CSSProperties}
      >

        {/* ── LIVE TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'live' && (
          <div className="live-tab-rail flex flex-col">

            {/* Stage zone */}
            <div className="px-3 pt-2 pb-1">
              {(isInitialLoading || (stageCardId && stageMode !== 'listening')) && (
                <p className="stage-section-label ml-[46px] mb-2">Live Check</p>
              )}

              <div className="relative">
                <AnimatePresence mode="wait">

                  {/* Skeleton */}
                  {isInitialLoading && (
                    <motion.div
                      key="skeleton"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DURATION.micro }}
                    >
                      <FeedCard
                        size="skeleton"
                        timestampSeconds={null}
                        accentRgb="var(--sc-neutral-rgb)"
                      />
                    </motion.div>
                  )}

                  {/* Active claim in stage: checking or resolved */}
                  {!isInitialLoading && stageCardId && stageMode !== 'listening' && (
                    <motion.div
                      key={stageCardId}
                      layoutId={enableListLayoutAnimations ? `claim-${stageCardId}` : undefined}
                      layout={enableListLayoutAnimations}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0.06 } }}
                      transition={{ duration: DURATION.heroEnter, ease: SOFT_SPRING }}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {stageMode === 'checking' && stageCheckingClaim && (
                          <motion.div
                            key="checking"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, transition: { duration: 0.1 } }}
                            transition={{ duration: 0.15 }}
                          >
                            <FeedCard
                              size="verifying"
                              claimText={stageCheckingClaim.claimText || 'Checking that claim…'}
                              timestampSeconds={stageCheckingClaim.timestampSeconds}
                              accentRgb="var(--model-accent-rgb)"
                              glow
                              suppressEntry
                            />
                          </motion.div>
                        )}
                        {stageMode === 'resolved' && stageResolvedCard && (
                          <motion.div
                            key="resolved"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, transition: { duration: 0.06 } }}
                            transition={{ duration: 0.2 }}
                          >
                            <FeedCard
                              size="hero"
                              card={stageResolvedCard}
                              timestampSeconds={stageResolvedCard.timestampSeconds}
                              accentRgb={STATUS_RGB[stageResolvedCard.status] ?? '154, 160, 166'}
                              suppressEntry
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Queue overlay — overlaid on stage card */}
                      <AnimatePresence>
                        {queuedCount > 0 && (
                          <motion.div
                            key="queue-chip"
                            className="absolute bottom-3 right-3 pointer-events-none"
                            initial={{ opacity: 0, scale: 0.88 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.18, ease: SOFT_SPRING }}
                          >
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] text-[10px] font-medium text-sc-muted/65 bg-sc-bg-0/85 border border-sc-border-soft/50 backdrop-blur-sm tabular-nums">
                              {queuedCount} queued
                            </span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  {/* Ambient state: no active claim in stage */}
                  {!isInitialLoading && !stageCardId && (
                    <motion.div
                      key={`ambient-${status}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DURATION.standard }}
                    >
                      {status === 'no-transcript' && (
                        <FeedCard
                          size="state"
                          badgeLabel="No captions"
                          timestampSeconds={null}
                          accentRgb="var(--sc-neutral-rgb)"
                          tone="muted"
                          headline="No usable captions found."
                          supportLine="Try a different video, or enable auto-captions."
                          actionLabel={onRetryTranscript ? 'Retry' : undefined}
                          onAction={onRetryTranscript}
                        />
                      )}
                      {status === 'error' && (
                        <FeedCard
                          size="state"
                          badgeLabel="Error"
                          timestampSeconds={null}
                          accentRgb="var(--sc-neutral-rgb)"
                          tone="muted"
                          headline="Something interrupted verification."
                          supportLine="Try refreshing the page."
                        />
                      )}
                      {(status === 'monitoring' || status === 'ready' || status === 'idle' || status === 'verifying') && (
                        currentScanPreview ? (
                          <FeedCard
                            size="scanning"
                            previewText={currentScanPreview}
                            entities={scanEntities}
                            actionState={scanActionState as 'VERIFYING' | 'REJECTED' | 'BUFFERING' | 'PARSE_ERROR' | null}
                            reason={scanReason}
                            timestampSeconds={liveTimestampSeconds}
                            accentRgb="var(--model-accent-rgb)"
                          />
                        ) : (
                          <div className="ml-[46px] py-3 pr-2 flex items-center gap-2.5">
                            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-sc-muted/25 animate-pulse" />
                            <p className="text-[12px] text-sc-muted/40">
                              Waiting for a claim worth checking
                            </p>
                          </div>
                        )
                      )}
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </div>

            {/* Recent checks */}
            {recentChecks.length > 0 && (
              <div className="px-3 mt-3.5">
                <p className="stage-section-label ml-[46px] mb-2">Recent checks</p>
                <div className="flex flex-col gap-1">
                  {recentChecks.map((card, index) => (
                    <motion.div
                      key={card.id}
                      layoutId={enableListLayoutAnimations ? `claim-${cardClaimKey(card)}` : undefined}
                      layout={enableListLayoutAnimations}
                      custom={index}
                      variants={getStackEntryVariants(prefersReducedMotion)}
                      initial={prefersReducedMotion ? false : 'hidden'}
                      animate={prefersReducedMotion ? undefined : 'visible'}
                    >
                      <FeedCard
                        size="compact"
                        card={card}
                        timestampSeconds={card.timestampSeconds}
                        accentRgb={STATUS_RGB[card.status] ?? '154, 160, 166'}
                        isExpanded={expandedClaimId === card.id}
                        onToggle={() =>
                          setExpandedClaimId((c) => (c === card.id ? null : card.id))
                        }
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ── HISTORY TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="px-3 pt-1 flex flex-col gap-2.5" style={FEED_RAIL_LAYOUT as CSSProperties}>
            <div className="signal-rail signal-rail-feed" />

            {/* Q&A History */}
            {askHistory.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="feed-rail-offset">
                  <div className="ml-1">
                    <p className="feed-section-label feed-section-label-qa">Q&A History</p>
                  </div>
                </div>
                {askHistory.slice().reverse().map((entry) => (
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

            {/* Fact checks */}
            {displayCards.length > 0 && (
              <motion.div
                layout={enableListLayoutAnimations}
                className="feed-card-stack flex flex-col gap-1"
              >
                <div className="feed-rail-offset mb-0.5">
                  <div className="ml-1">
                    <p className="feed-section-label">Fact checks</p>
                  </div>
                </div>
                {displayCards.slice().reverse().map((card, reverseIndex) => (
                  <motion.div
                    key={card.id}
                    layout={enableListLayoutAnimations}
                    layoutId={enableListLayoutAnimations ? `claim-${card.id}` : undefined}
                    custom={displayCards.length - 1 - reverseIndex}
                    variants={getStackEntryVariants(prefersReducedMotion)}
                    initial={prefersReducedMotion ? false : 'hidden'}
                    animate={prefersReducedMotion ? undefined : 'visible'}
                    exit={prefersReducedMotion ? undefined : 'exit'}
                  >
                    <FeedCard
                      size="compact"
                      timestampSeconds={card.timestampSeconds}
                      card={card}
                      accentRgb={STATUS_RGB[card.status] ?? '154, 160, 166'}
                      isExpanded={expandedClaimId === card.id}
                      onToggle={() => {
                        setExpandedClaimId((current) => (current === card.id ? null : card.id));
                      }}
                    />
                  </motion.div>
                ))}
              </motion.div>
            )}

            {/* Empty history state */}
            {displayCards.length === 0 && askHistory.length === 0 && (
              <FeedCard
                size="state"
                badgeLabel="No history"
                timestampSeconds={null}
                accentRgb="var(--sc-neutral-rgb)"
                tone="muted"
                headline="Nothing checked yet."
                supportLine="Verified claims will appear here as the video plays."
              />
            )}
          </div>
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
