import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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
import {
  getClaimKey,
  getCardClaimKey,
  type LivePhase,
  type ReadingVariant,
  type StageEntryDerived,
} from '../hooks/useLiveStageFlow';


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
  status?: AnalysisStatus;
  chunksScanned?: number;
  livePhase?: LivePhase;
  readingVariant?: ReadingVariant;
  readingPreview?: string | null;
  readingTimestamp?: number | null;
  stageEntries?: StageEntryDerived[];
  dockedKeys?: ReadonlySet<string>;
  recentChecks?: SourceCard[];
  queuedCount?: number;
  showLiveCheckLabel?: boolean;
  isPinned?: boolean;
  pinToTop?: () => void;
  onRetryTranscript?: () => void;
  onClearHistory?: () => void;
  selectedModel?: string;
  activeTab?: 'live' | 'history';
  /** @deprecated — no longer used; stage owns its own state */
  onHeroStateChange?: (state: HeroSlotState) => void;
}

const FEED_RAIL_LAYOUT = {
  '--rail-left': '46px',
} as CSSProperties;

const MAX_HISTORY_ROWS = 20;
void MAX_HISTORY_ROWS; // referenced for future pagination

const STATUS_RGB: Record<string, string> = {
  supported: '129, 201, 149',
  partial: '253, 226, 147',
  disputed: '242, 139, 130',
  unverifiable: '154, 160, 166',
};

const STAGE_SHELL_MIN_HEIGHT = {
  reading: 0,
  checking: 168,
  resolved: 0,
  idle: 0,
} as const;

/* ── Main feed ── */

export const CardFeed = ({
  askHistory = [],
  cards,
  status = 'idle',
  chunksScanned = 0,
  livePhase = 'idle',
  readingVariant = null,
  readingPreview = null,
  readingTimestamp = null,
  stageEntries = [],
  dockedKeys,
  recentChecks: derivedRecentChecks,
  queuedCount = 0,
  showLiveCheckLabel = false,
  isPinned = true,
  pinToTop,
  activeTab = 'live',
  selectedModel = BYOK_DEFAULT_MODEL,
  allCards,
  onRetryTranscript,
  onClearHistory,
}: CardFeedProps) => {
  const prefersReducedMotion = useReducedMotion();
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const enableListLayoutAnimations = !prefersReducedMotion;
  const recentChecks = derivedRecentChecks ?? cards;

  const isInitialLoading =
    status === 'loading' &&
    cards.length === 0 &&
    livePhase === 'idle' &&
    chunksScanned === 0;

  // Live tab uses current-video cards; History tab uses accumulated cross-video history
  const historyCards = useMemo(() => allCards ?? cards, [allCards, cards]);

  // Clear expanded card if it leaves recent checks
  useEffect(() => {
    if (!expandedClaimId) return;
    if (!recentChecks.some((c) => c.id === expandedClaimId)) setExpandedClaimId(null);
  }, [expandedClaimId, recentChecks]);

  const anyDocking = (dockedKeys?.size ?? 0) > 0 || stageEntries.some((e) => e.isDocking);
  const isLiveReading = livePhase !== 'idle' || anyDocking;
  const showResumeLive =
    !isPinned &&
    isLiveReading &&
    activeTab === 'live' &&
    (recentChecks.length > 0 || livePhase !== 'idle');

  const showStateCard = status === 'no-transcript' || status === 'error';
  const showAmbientWaiting = !isInitialLoading && !showStateCard && livePhase === 'idle';
  const stageShellMinHeight = isInitialLoading
    ? STAGE_SHELL_MIN_HEIGHT.checking
    : anyDocking
      ? STAGE_SHELL_MIN_HEIGHT.resolved
      : STAGE_SHELL_MIN_HEIGHT[livePhase];

  const modelCssVars = buildModelCssVars(selectedModel);

  return (
    <div className="relative" style={modelCssVars}>
      <div
        className={`relative flex flex-col gap-0 ${activeTab === 'live' ? 'pt-1' : 'pt-2'}`}
        style={{ ...FEED_RAIL_LAYOUT, ...modelCssVars } as CSSProperties}
      >

        {/* ── LIVE TAB ─────────────────────────────────────────────────────── */}
        {activeTab === 'live' && (
          <LayoutGroup id="live-stage-feed">
            <div className="live-tab-rail flex flex-col">
              <div className="px-3 pt-2 pb-1">
                {(showLiveCheckLabel || (livePhase === 'reading' && readingVariant != null)) && (
                  <div className="stage-section-row ml-[46px] mb-2">
                    <span className="stage-section-rule" />
                    <p className="stage-section-label">Live Check</p>
                  </div>
                )}

                <motion.div
                  className="relative live-stage-shell"
                  animate={{ minHeight: stageShellMinHeight }}
                  transition={{ duration: DURATION.standard, ease: SOFT_SPRING }}
                >
                  <AnimatePresence mode="wait" initial={false}>
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

                    {/* Unified live card — scanning and verifying share one persistent shell.
                        key="live-primary" never changes while the stage is active, so the
                        outer wrapper stays mounted. Only the inner content crossfades.
                        This gives the "one card morphing" feel instead of a sequential swap. */}
                    {!isInitialLoading && ((livePhase === 'reading' && readingVariant != null) || !!stageEntries[0]) && (
                      <motion.div
                        key="live-primary"
                        layout={enableListLayoutAnimations}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.22, ease: SOFT_SPRING } }}
                        transition={{ duration: 0.28, ease: SOFT_SPRING }}
                      >
                        {/* Inner content crossfades between scanning → checking → resolved.
                            mode="popLayout" lets entering and exiting content overlap briefly
                            so the card feels like it changes content, not swaps. */}
                        <AnimatePresence mode="popLayout" initial={false}>
                          {livePhase === 'reading' && readingVariant != null && !stageEntries[0] && (
                            <motion.div
                              key="scanning"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0, transition: { duration: 0.2, ease: SOFT_SPRING } }}
                              transition={{ duration: 0.28, ease: SOFT_SPRING }}
                            >
                              <FeedCard
                                size="scanning"
                                previewText=""
                                timestampSeconds={readingTimestamp}
                                accentRgb="var(--model-accent-rgb)"
                                suppressEntry
                                chunksScanned={chunksScanned}
                              />
                            </motion.div>
                          )}

                          {stageEntries[0] && (() => {
                            const entry = stageEntries[0];
                            const entryPhase = entry.resolvedCard ? 'resolved' : (entry.checkingClaim ? 'checking' : null);
                            if (!entryPhase) return null;
                            return (
                              <motion.div
                                key={entry.claimKey}
                                layoutId={enableListLayoutAnimations ? `claim-${entry.claimKey}` : undefined}
                                layout={enableListLayoutAnimations}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, transition: { duration: 0.22, ease: SOFT_SPRING } }}
                                transition={{ duration: 0.3, ease: SOFT_SPRING }}
                              >
                                <AnimatePresence mode="wait" initial={false}>
                                  {entryPhase === 'checking' && entry.checkingClaim && (
                                    <motion.div
                                      key="checking"
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      exit={{ opacity: 0, transition: { duration: 0.18, ease: SOFT_SPRING } }}
                                      transition={{ duration: 0.24, ease: SOFT_SPRING }}
                                    >
                                      <FeedCard
                                        size="verifying"
                                        claimText={entry.checkingClaim.claimText || 'Checking that claim…'}
                                        claimType={entry.checkingClaim.claimType}
                                        timestampSeconds={entry.checkingClaim.timestampSeconds}
                                        accentRgb="var(--model-accent-rgb)"
                                        glow
                                        suppressEntry
                                      />
                                    </motion.div>
                                  )}
                                  {entryPhase === 'resolved' && entry.resolvedCard && (
                                    <motion.div
                                      key="resolved"
                                      initial={{ opacity: 0, scale: 1.01 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: SOFT_SPRING } }}
                                      transition={{ duration: 0.24, ease: SOFT_SPRING }}
                                    >
                                      <FeedCard
                                        size="compact"
                                        card={entry.resolvedCard}
                                        timestampSeconds={entry.resolvedCard.timestampSeconds}
                                        accentRgb={STATUS_RGB[entry.resolvedCard.status] ?? '154, 160, 166'}
                                        suppressEntry
                                      />
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </motion.div>
                            );
                          })()}
                        </AnimatePresence>
                      </motion.div>
                    )}

                    {!isInitialLoading && showStateCard && (
                      <motion.div
                        key={`state-${status}`}
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
                            headline="Captions couldn't be loaded."
                            supportLine="Try refreshing the page or click CC in the player to enable captions."
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
                      </motion.div>
                    )}

                    {showAmbientWaiting && (
                      <motion.div
                        key="waiting"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: DURATION.standard }}
                      >
                        <div className="ml-[46px] py-3 pr-2">
                          <div className="flex items-center gap-2.5">
                            <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-sc-muted/25 animate-heartbeat" />
                            <p className="text-[12px] text-sc-muted/40">
                              Waiting for a claim worth checking
                            </p>
                          </div>
                          {chunksScanned > 0 && (
                            <p className="mt-1 ml-4 text-[10px] font-mono tabular-nums text-sc-muted/25">
                              {chunksScanned} segments analyzed
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Secondary stage entry — outside mode="wait", independent lifecycle */}
                  <AnimatePresence>
                    {!isInitialLoading && stageEntries[1] && (() => {
                      const entry = stageEntries[1];
                      const entryPhase = entry.resolvedCard ? 'resolved' : (entry.checkingClaim ? 'checking' : null);
                      if (!entryPhase) return null;
                      return (
                        <motion.div
                          key={entry.claimKey}
                          layoutId={enableListLayoutAnimations ? `claim-${entry.claimKey}` : undefined}
                          layout={enableListLayoutAnimations}
                          className="relative mt-1"
                          initial={prefersReducedMotion ? false : { opacity: 0, y: -6 }}
                          animate={{ opacity: 0.45, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97, transition: { duration: DURATION.micro, ease: SOFT_SPRING } }}
                          transition={{ duration: DURATION.standard, ease: SOFT_SPRING }}
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            {entryPhase === 'checking' && entry.checkingClaim && (
                              <motion.div
                                key="checking"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0, transition: { duration: 0.16, ease: SOFT_SPRING } }}
                                transition={{ duration: DURATION.micro }}
                              >
                                <FeedCard
                                  size="verifying"
                                  claimText={entry.checkingClaim.claimText || 'Checking that claim…'}
                                  claimType={entry.checkingClaim.claimType}
                                  timestampSeconds={entry.checkingClaim.timestampSeconds}
                                  accentRgb="var(--sc-neutral-rgb)"
                                  suppressEntry
                                />
                              </motion.div>
                            )}
                            {entryPhase === 'resolved' && entry.resolvedCard && (
                              <motion.div
                                key="resolved"
                                initial={{ opacity: 0, scale: 1.01 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: SOFT_SPRING } }}
                                transition={{ duration: DURATION.micro }}
                              >
                                <FeedCard
                                  size="compact"
                                  card={entry.resolvedCard}
                                  timestampSeconds={entry.resolvedCard.timestampSeconds}
                                  accentRgb={STATUS_RGB[entry.resolvedCard.status] ?? '154, 160, 166'}
                                  suppressEntry
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
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
                                  {queuedCount} more
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })()}
                  </AnimatePresence>

                  {/* Queue chip when no secondary visible but overflow exists */}
                  <AnimatePresence>
                    {!stageEntries[1] && queuedCount > 0 && stageEntries[0] && (
                      <motion.div
                        key="queue-chip-primary"
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
              </div>

              {recentChecks.length > 0 && (
                <div className={`px-3 ${livePhase === 'reading' ? 'mt-2.5' : 'mt-3.5'}`}>
                  <div className="stage-section-row ml-[46px] mb-2">
                    <span className="stage-section-rule" />
                    <p className="stage-section-label">Recent checks</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {recentChecks.map((card, index) => {
                      const claimKey = getCardClaimKey(card);
                      const isDockTarget = Boolean(dockedKeys?.has(claimKey));

                      // CALM TRANSITION: Docking cards should NOT use layoutId morphing
                      // The stage card exits gracefully; this card appears with simple fade
                      // This prevents the chaotic "morphing" animation that fights with exit
                      return (
                        <motion.div
                          key={card.id}
                          // NO layoutId for docking cards - prevents animation collision
                          layoutId={enableListLayoutAnimations && !isDockTarget ? `claim-${claimKey}` : undefined}
                          layout={enableListLayoutAnimations && !isDockTarget}
                          custom={index}
                          variants={isDockTarget ? undefined : getStackEntryVariants(prefersReducedMotion)}
                          initial={isDockTarget ? { opacity: 0, y: 8 } : prefersReducedMotion ? false : 'hidden'}
                          animate={{ opacity: 1, y: 0 }}
                          transition={isDockTarget ? { duration: 0.35, ease: SOFT_SPRING } : undefined}
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
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </LayoutGroup>
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
            {historyCards.length > 0 && (
              <motion.div
                layout={enableListLayoutAnimations}
                className="feed-card-stack flex flex-col gap-1"
              >
                <div className="feed-rail-offset mb-0.5 flex items-center justify-between">
                  <div className="ml-1">
                    <p className="feed-section-label">Fact checks</p>
                  </div>
                  {onClearHistory && (
                    <button
                      type="button"
                      onClick={onClearHistory}
                      className="text-[10px] text-sc-muted/50 hover:text-sc-muted/80 transition-colors mr-1"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {historyCards.slice().reverse().map((card, reverseIndex) => (
                  <motion.div
                    key={card.id}
                    layout={enableListLayoutAnimations}
                    layoutId={enableListLayoutAnimations ? `claim-${card.id}` : undefined}
                    custom={historyCards.length - 1 - reverseIndex}
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
            {historyCards.length === 0 && askHistory.length === 0 && (
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
