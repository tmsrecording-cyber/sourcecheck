/**
 * FeedCard - Unified card primitive for the live feed.
 * 
 * One component handles all feed states:
 * - scanning: Live transcript/forming state
 * - verifying: Active verification with thinking visuals
 * - hero: Resolved claim (supported/partial/disputed/unverifiable)
 * - compact: Collapsed history row
 * 
 * This creates visual continuity as cards flow down the waterfall.
 */

import { Fragment, memo, useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { formatTime } from '../utils/formatTime';
import { stripLegacyCachePrefix } from '../utils/trustCopy';
import { normalizeTranscriptPreview } from '../utils/normalizeTranscriptPreview';
import { sanitizeUrl } from '../utils/sanitizeUrl';
import type { SimilarClaim, SourceCard as SourceCardRecord, VerificationStatus } from '../../../shared/types';
import {
  SOFT_SPRING,
  DURATION,
  DISTANCE,
  hoverLift,
  hoverLiftCompact,
  pressSettle,
  expandReveal,
  chevronRotate,
} from '../styles/motionTokens';

// Backend placeholder strings that should not be displayed as real source titles.
// "Not found" is intentionally excluded — the new backend uses it as a meaningful category label.
const BACKEND_SOURCE_PLACEHOLDERS = new Set(['Needs primary source', 'No strong web match', 'N/A', 'None']);
const resolveSourceTitle = (raw: string | undefined | null): string | null => {
  const trimmed = raw?.trim();
  return (trimmed && !BACKEND_SOURCE_PLACEHOLDERS.has(trimmed)) ? trimmed : null;
};

// Domains from Google's grounding infrastructure — not useful to show users.
const GROUNDING_NOISE_DOMAINS = new Set([
  'vertexaisearch.cloud.google.com',
  'generativelanguage.googleapis.com',
  'googleapis.com',
  'ai.google.dev',
  'cloud.google.com',
]);
const isGroundingNoiseDomain = (hostname: string) =>
  GROUNDING_NOISE_DOMAINS.has(hostname) || hostname.endsWith('.googleapis.com');

// B1: Extract domain from URL for source chip (e.g. "https://nature.com/..." → "nature.com")
const extractDomain = (url: string): string | null => {
  try {
    const { hostname } = new URL(url);
    const domain = hostname.replace(/^www\./, '');
    if (isGroundingNoiseDomain(hostname)) return null;
    return domain;
  } catch {
    return null;
  }
};

// B1: Source type icon map
const SOURCE_TYPE_ICON: Record<string, string> = {
  academic_paper: '📄',
  news_article: '📰',
  official_source: '🏛',
  wikipedia: '📖',
  other: '🔗',
};

// M3.5: SAFE_SCAN_REASONS whitelist - only these reasons are user-safe to display
// Raw AI rationale strings are blocked from UI unless explicitly allowed here
const SAFE_SCAN_REASONS = new Set([
  'Catching up to current playback position…',
  'Waiting for next claim...',
  'Analyzing transcript...',
]);

/**
 * Filter raw AI rationale through whitelist.
 * Returns null if the reason is not user-safe to display.
 */
const sanitizeScanReason = (reason: string | null | undefined): string | null => {
  if (!reason) return null;
  // Exact match whitelist
  if (SAFE_SCAN_REASONS.has(reason)) return reason;
  // Block all other reasons (raw AI rationale)
  return null;
};

// Card size variants
type CardSize = 'scanning' | 'verifying' | 'hero' | 'compact' | 'state' | 'skeleton';
type FeedCardTone = 'accent' | 'soft' | 'supported' | 'partial' | 'disputed' | 'muted';

// Base props all cards share
interface FeedCardBaseProps {
  timestampSeconds: number | null;
  size: CardSize;
  accentRgb?: string;
  glow?: boolean;
  suppressEntry?: boolean;
}

// Scanning state: showing transcript preview
interface ScanningProps extends FeedCardBaseProps {
  size: 'scanning';
  previewText: string;
  entities?: string[];
  actionState?: 'VERIFYING' | 'REJECTED' | 'BUFFERING' | 'PARSE_ERROR' | null;
  reason?: string | null;
  chunksScanned?: number;
}

// Verifying state: active verification
interface VerifyingProps extends FeedCardBaseProps {
  size: 'verifying';
  claimText: string;
  claimType?: string;
}

// Hero state: resolved claim
interface HeroProps extends FeedCardBaseProps {
  size: 'hero';
  card: SourceCardRecord;
}

// Compact state: collapsed history
interface CompactProps extends FeedCardBaseProps {
  size: 'compact';
  card: SourceCardRecord;
  isExpanded?: boolean;
  onToggle?: () => void;
}

interface StateProps extends FeedCardBaseProps {
  size: 'state';
  badgeLabel: string;
  headline: string;
  supportLine: string;
  tone?: FeedCardTone;
  actionLabel?: string;
  onAction?: () => void;
}

interface SkeletonProps extends FeedCardBaseProps {
  size: 'skeleton';
}

type FeedCardProps =
  | ScanningProps
  | VerifyingProps
  | HeroProps
  | CompactProps
  | StateProps
  | SkeletonProps;

// Status metadata shared across all sizes
const STATUS_META: Record<VerificationStatus, { label: string; rgb: string }> = {
  supported: { label: 'Supported', rgb: '129, 201, 149' },
  partial: { label: 'Mixed', rgb: '253, 226, 147' },
  disputed: { label: 'Unsupported', rgb: '242, 139, 130' },
  unverifiable: { label: 'Cannot verify', rgb: '154, 160, 166' },
};

const buildSimilarClaimSummary = (similarClaims: SimilarClaim[]): string | null => {
  if (similarClaims.length === 0) {
    return null;
  }

  const leadClaim = similarClaims[0];
  const leadLabel = `${leadClaim.videoTitle} · ${formatTime(leadClaim.timestampSeconds)}`;
  if (similarClaims.length === 1) {
    return leadLabel;
  }

  return `${leadLabel} +${similarClaims.length - 1} more`;
};

const stopSourceLinkPropagation = (
  event: ReactMouseEvent<HTMLAnchorElement> | ReactKeyboardEvent<HTMLAnchorElement>,
) => {
  event.stopPropagation();
};

// Status icons
const StatusIcon = ({ status, size = 'normal' }: { status: VerificationStatus; size?: 'small' | 'normal' }) => {
  const s = size === 'small' ? 10 : 12;
  const sw = size === 'small' ? 1.75 : 2.6;
  const icons = {
    // Authoritative checkmark — heavier stroke, more decisive angle
    supported: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M2 6.5L4.8 9.2L10 3" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    // Tilde wave — universally reads as "approximately / mixed"
    partial: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M1.5 7 Q3 4.5 5 7 Q7 9.5 9 7 Q10 5.5 10.5 6" stroke="currentColor" strokeWidth={sw - 0.2} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    // Thicker X — definitive rejection
    disputed: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth={sw} strokeLinecap="round"/>
      </svg>
    ),
    // Null circle — open ring + diagonal slash, meaning "void / cannot verify"
    unverifiable: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="3.8" stroke="currentColor" strokeWidth={sw - 0.6} strokeDasharray="2 1.2" strokeLinecap="round"/>
        <path d="M8.2 3.8L3.8 8.2" stroke="currentColor" strokeWidth={sw - 0.8} strokeLinecap="round"/>
      </svg>
    ),
  };

  return (
    <span className={`status-icon ${size === 'small' ? 'status-icon-sm' : ''}`} data-status={status}>
      {icons[status]}
    </span>
  );
};

const CLAIM_TYPE_LABELS: Record<string, string> = {
  factual: 'Factual claim',
  statistical: 'Statistic',
  historical: 'Historical claim',
  prediction: 'Prediction',
  causal: 'Causal claim',
  quote: 'Quote check',
};

// Adversarial strip — shows dual-agent verification activity
const AdversarialStrip = ({ elapsed }: { elapsed: number }) => {
  const synthesizing = elapsed >= 8;
  const reducedMotion = useReducedMotion();
  const phaseText = synthesizing ? 'merging' : 'checking';

  return (
    <div className="adversarial-strip">
      {/* Advocate agent */}
      <div className="adversarial-agent-group">
        <span className={`adversarial-node adversarial-node-for${reducedMotion ? '' : ' animated'}${synthesizing ? ' done' : ''}`} />
        <span className="adversarial-agent-label adversarial-agent-label-for">for</span>
      </div>

      <span className="adversarial-sep">·</span>

      {/* Challenger agent */}
      <div className="adversarial-agent-group">
        <span className={`adversarial-node adversarial-node-against${reducedMotion ? '' : ' animated'}${synthesizing ? ' done' : ''}`} />
        <span className="adversarial-agent-label adversarial-agent-label-against">against</span>
      </div>

      <span className={`adversarial-phase${synthesizing ? ' synth' : ''}`}>
        {phaseText}
      </span>
      <span className="adversarial-timer">{elapsed}s</span>
    </div>
  );
};

// Verifying card — shows elapsed time so the user knows something real is happening
const VerifyingContent = ({ claimText, claimType }: { claimText: string; claimType?: string }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const claimTypeLabel = claimType ? (CLAIM_TYPE_LABELS[claimType] ?? null) : null;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="thinking-pulse-dot" />
        <span className="status-badge status-badge-live">Verifying</span>
        {claimTypeLabel && (
          <span className="text-[10px] font-medium text-sc-muted/50 tracking-[0.02em]">
            {claimTypeLabel}
          </span>
        )}
      </div>

      <p className="mt-3 text-[16px] font-semibold leading-[1.42] tracking-[-0.016em] text-textMain">
        {claimText}
      </p>

      <AdversarialStrip elapsed={elapsed} />
    </>
  );
};

// Hero resolved card
const HeroContent = ({ card }: { card: SourceCardRecord }) => {
  const meta = STATUS_META[card.status];
  const nuance = stripLegacyCachePrefix(card.nuance);
  const resolvedSourceTitle = resolveSourceTitle(card.sourceTitle);
  const source = resolvedSourceTitle || 'No reliable source found';
  const evidenceSnippet = card.evidenceSnippet?.trim() || '';
  const contradictionContext = card.contradictionContext?.trim() || '';
  const safeSourceUrl = sanitizeUrl(card.sourceUrl);
  const hasSourceLink = Boolean(safeSourceUrl && resolvedSourceTitle);
  const memorySummary = buildSimilarClaimSummary(card.similarClaims ?? []);

  return (
    <>
      <div className="flex items-center gap-2.5">
        <StatusIcon status={card.status} />
        <span className={`verdict-badge verdict-${card.status}`}>
          {meta.label}
        </span>
      </div>

      {nuance && (
        <p className="feed-card-claim-summary mt-2.5 line-clamp-3">
          {nuance}
        </p>
      )}

      <p className="feed-card-quote mt-2.5 line-clamp-2">
        "{card.claim.claimText}"
      </p>

      {evidenceSnippet && (
        <div className="feed-card-evidence-block mt-3">
          <p className="feed-card-evidence-kicker">Evidence</p>
          <p className="feed-card-evidence-copy mt-1 line-clamp-4">
            "{evidenceSnippet}"
          </p>
        </div>
      )}

      {contradictionContext && (
        <div className="feed-card-contradiction-block mt-3">
          <p className="feed-card-evidence-kicker feed-card-contradiction-kicker">Conflict detected</p>
          <p className="feed-card-contradiction-copy mt-1">
            {contradictionContext}
          </p>
        </div>
      )}

      <div className="feed-card-source-block mt-3">
        <p className="feed-card-source-kicker">Source</p>
        {hasSourceLink ? (
          <a
            href={safeSourceUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="feed-card-source-link feed-card-source-copy mt-1"
            onClick={stopSourceLinkPropagation}
            onKeyDown={stopSourceLinkPropagation}
          >
            <span>{source}</span>
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <p className="feed-card-source-copy mt-1">{source}</p>
        )}
      </div>

      {memorySummary && (
        <div className="feed-card-memory mt-3">
          <p className="feed-card-memory-kicker">Seen before</p>
          <p className="feed-card-memory-copy">{memorySummary}</p>
        </div>
      )}
    </>
  );
};

// Compact history row
const CompactContent = ({ 
  card, 
  isExpanded, 
  onToggle 
}: { 
  card: SourceCardRecord; 
  isExpanded?: boolean; 
  onToggle?: () => void;
}) => {
  const meta = STATUS_META[card.status];
  const nuance = stripLegacyCachePrefix(card.nuance);
  const prefersReducedMotion = useReducedMotion();
  const resolvedSourceTitleCompact = resolveSourceTitle(card.sourceTitle);
  const evidenceSnippet = card.evidenceSnippet?.trim() || '';
  const contradictionContext = card.contradictionContext?.trim() || '';
  const safeSourceUrlCompact = sanitizeUrl(card.sourceUrl);
  const hasSourceLink = Boolean(safeSourceUrlCompact && resolvedSourceTitleCompact);
  const memorySummary = buildSimilarClaimSummary(card.similarClaims ?? []);
  const isInteractive = Boolean(onToggle);
  
  // Extract first sentence of nuance for primary display (truncate at first period, or use full nuance)
  const nuanceFirstSentence = nuance ? nuance.split(/\.(\s|$)/)[0] + (nuance.includes('.') ? '.' : '') : '';
  
  // Full boilerplate filter for supported/partial/disputed cards — these phrases contradict the verdict
  const BOILERPLATE_RE = /^we could not verify|^this claim could not|^unable to verify|^this likely needs|^no verifiable|^this requires|^verifying this|^cannot be verified|^insufficient (public )?evidence|^there (is|are) no|^no reliable source|^no (strong|credible|independent) (web|source)|^this (claim|statement) (cannot|could not)|^based on (available|the) (evidence|sources?|information)/i;
  const isUnverifiable = card.status === 'unverifiable';
  // For unverifiable cards, only filter pure "verification failed" phrases — ones that say
  // nothing about WHY or WHAT is missing. Explanatory phrases ("needs specifics",
  // "requires a primary source", etc.) are kept — they're the useful signal.
  // When pure boilerplate is detected, fall back to the claim text so the user sees WHAT
  // couldn't be verified rather than a generic failure message.
  const UV_PURE_BOILERPLATE_RE = /^we could not verify|^this claim could not|^unable to verify|^cannot be verified|^this (claim|statement) (cannot|could not)|^verifying this claim/i;
  const reasoningText = isUnverifiable
    ? (nuanceFirstSentence && !UV_PURE_BOILERPLATE_RE.test(nuanceFirstSentence))
      ? nuanceFirstSentence
      : card.claim.claimText
    : (nuanceFirstSentence && !BOILERPLATE_RE.test(nuanceFirstSentence))
      ? nuanceFirstSentence
      : card.claim.claimText;

  return (
    <div 
      className="compact-card-inner"
      onClick={onToggle}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onToggle?.();
              }
            }
          : undefined
      }
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-expanded={isInteractive ? Boolean(isExpanded) : undefined}
    >
      <div className="compact-card-layout">
        <div className="compact-card-leading">
          <StatusIcon status={card.status} size="small" />
        </div>
        <div className="flex-1 min-w-0 compact-card-copy">
          <div className="compact-meta-row">
            <span className={`compact-verdict compact-verdict-${card.status}`}>
              {meta.label}
            </span>
            {/* A5: Show category chip for unverifiable cards — "Missing details", "Not found", etc. */}
            {isUnverifiable && resolvedSourceTitleCompact && !card.isTransientFailure && (
              <span className="compact-unverifiable-category">
                {resolvedSourceTitleCompact}
              </span>
            )}
            {card.timestampSeconds !== null && card.timestampSeconds !== undefined && (
              <span className="compact-timestamp">{formatTime(card.timestampSeconds)}</span>
            )}
            {memorySummary && (
              <span className="compact-memory-chip" title={memorySummary}>
                ↺
              </span>
            )}
          </div>
          
          {/* Primary reasoning - the "why" */}
          <p className="compact-reasoning-text line-clamp-3">
            {reasoningText}
          </p>
          
          {/* Source chip — shown for verified cards and unverifiable cards with URL.
              B1: domain pill with source-type icon, compact for quick scanning */}
          {resolvedSourceTitleCompact && (!isUnverifiable || hasSourceLink) && (
            <p className="compact-source-line">
              {hasSourceLink ? (
                <a
                  href={safeSourceUrlCompact!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="compact-source-chip-link"
                  onClick={stopSourceLinkPropagation}
                  onKeyDown={stopSourceLinkPropagation}
                >
                  <span aria-hidden="true">{SOURCE_TYPE_ICON[card.sourceType] ?? '🔗'}</span>
                  <span className="compact-source-chip-domain">
                    {extractDomain(safeSourceUrlCompact!) ?? resolvedSourceTitleCompact}
                  </span>
                  <span aria-hidden="true" className="compact-source-chip-arrow">↗</span>
                </a>
              ) : (
                <span className="compact-source-text">{resolvedSourceTitleCompact}</span>
              )}
            </p>
          )}

          <AnimatePresence>
          {isExpanded && (
            <motion.div
              key="expanded"
              initial={prefersReducedMotion ? false : expandReveal.initial}
              animate={expandReveal.animate}
              exit={expandReveal.exit}
              transition={expandReveal.transition}
              style={{ overflow: 'hidden' }}
              className="compact-expanded-panel"
            >
              {/* Only show claim quote if it differs from the reasoning text above */}
              {reasoningText !== card.claim.claimText && (
                <p className="compact-expanded-quote">
                  "{card.claim.claimText}"
                </p>
              )}
              {/* Show full nuance when reasoning was truncated to first sentence */}
              {nuance && nuanceFirstSentence !== nuance && !BOILERPLATE_RE.test(nuanceFirstSentence) && (
                <p className="compact-expanded-nuance">
                  {nuance}
                </p>
              )}
              {evidenceSnippet && (
                <p className="compact-expanded-evidence">
                  "{evidenceSnippet}"
                </p>
              )}
              {/* E2: Debate view — what each agent found before synthesis */}
              {card.advocateNuance && card.challengerNuance && (
                <div className="debate-block">
                  <div className="debate-side debate-side-for">
                    <span className="debate-side-label debate-side-label-for">for</span>
                    <p className="debate-side-text">{card.advocateNuance}</p>
                  </div>
                  <div className="debate-side debate-side-against">
                    <span className="debate-side-label debate-side-label-against">against</span>
                    <p className="debate-side-text">{card.challengerNuance}</p>
                  </div>
                </div>
              )}
              {contradictionContext && (
                <p className="compact-contradiction-copy">
                  ⚠ {contradictionContext}
                </p>
              )}
              {memorySummary && (
                <p className="compact-memory-copy">
                  Seen before: {memorySummary}
                </p>
              )}
            </motion.div>
          )}
          </AnimatePresence>
        </div>
        {isInteractive && (
          <motion.span
            className="compact-expand-indicator"
            initial={false}
            animate={{ rotate: isExpanded ? 180 : 0, opacity: isExpanded ? 0.88 : 0.52 }}
            transition={chevronRotate.transition}
            aria-hidden="true"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.span>
        )}
      </div>
    </div>
  );
};

// Pulse bar — 5 thin bars representing data segments flowing through the pipeline
const ScanPulseBar = ({ active }: { active?: boolean }) => (
  <div className={`scan-pulse-bar ${active ? 'scan-pulse-bar-active' : ''}`}>
    <span className="scan-pulse-segment" />
    <span className="scan-pulse-segment" />
    <span className="scan-pulse-segment" />
    <span className="scan-pulse-segment" />
    <span className="scan-pulse-segment" />
  </div>
);

// Scanning/forming card
const ScanningContent = ({
  previewText,
  entities = [],
  actionState,
  reason,
  chunksScanned,
}: {
  previewText: string;
  entities?: string[];
  actionState?: 'VERIFYING' | 'REJECTED' | 'BUFFERING' | 'PARSE_ERROR' | null;
  reason?: string | null;
  chunksScanned?: number;
}) => {
  const isVerifying = actionState === 'VERIFYING';

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`status-dot ${isVerifying ? 'status-dot-pulse' : 'status-dot-subtle'}`} />
        <span className={`font-mono text-[10px] font-bold tracking-[0.07em] uppercase ${isVerifying ? 'scanning-label-active' : 'text-sc-muted/70'}`}>
          {isVerifying ? 'Checking…' : 'Listening'}
        </span>
        <ScanPulseBar active={isVerifying} />
      </div>

      {previewText && (
        <p className={`mt-2.5 leading-relaxed line-clamp-2 ${
          isVerifying
            ? 'text-[15px] font-semibold text-textMain tracking-[-0.012em]'
            : 'text-[14px] text-textMain/92'
        }`}>
          {normalizeTranscriptPreview(previewText)}
        </p>
      )}

      {entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entities.slice(0, 4).map((entity, i) => (
            <span key={i} className="entity-chip">{entity}</span>
          ))}
        </div>
      )}

      {!isVerifying && !previewText && chunksScanned !== undefined && chunksScanned >= 5 && (
        <p className="mt-1.5 text-[10px] font-mono tabular-nums text-sc-muted/30">
          {chunksScanned} segments analyzed
        </p>
      )}

      {reason && actionState === 'BUFFERING' && (
        // M3.5: Filter through SAFE_SCAN_REASONS whitelist before displaying
        (() => {
          const safeReason = sanitizeScanReason(reason);
          return safeReason ? (
            <p className="mt-2 text-[11px] text-sc-muted/70">{safeReason}</p>
          ) : null;
        })()
      )}
    </>
  );
};

const StateContent = ({
  badgeLabel,
  headline,
  supportLine,
  tone = 'muted',
  actionLabel,
  onAction,
}: {
  badgeLabel: string;
  headline: string;
  supportLine: string;
  tone?: FeedCardTone;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <>
    <span className="state-badge" data-tone={tone}>
      {badgeLabel}
    </span>
    <p className="feed-card-state-headline mt-3">{headline}</p>
    <p className="feed-card-state-copy mt-2">{supportLine}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="state-card-action mt-4"
      >
        {actionLabel}
      </button>
    )}
  </>
);

const SkeletonContent = () => (
  <div className="feed-card-skeleton-lines" aria-hidden="true">
    {/* Badge row */}
    <div className="skeleton h-[11px] w-[52px] rounded" />
    {/* Title */}
    <div className="mt-3 skeleton h-[14px] w-3/4 rounded" />
    <div className="mt-1.5 skeleton h-[14px] w-full rounded" />
    {/* Body */}
    <div className="mt-3 skeleton h-[11px] w-11/12 rounded" />
    <div className="mt-1.5 skeleton h-[11px] w-2/3 rounded" />
  </div>
);

// Main FeedCard component
export const FeedCard = (props: FeedCardProps) => {
  const { timestampSeconds, size, accentRgb = '138, 180, 248', glow = false, suppressEntry = false } = props;
  const prefersReducedMotion = useReducedMotion();
  const status = props.size === 'hero' || props.size === 'compact' ? props.card.status : undefined;
  const tone = props.size === 'state' ? (props.tone ?? 'muted') : undefined;
  // Determine content based on size
  const content = (() => {
    switch (props.size) {
      case 'scanning':
        return (
          <ScanningContent
            previewText={props.previewText}
            entities={props.entities}
            actionState={props.actionState}
            reason={props.reason}
            chunksScanned={props.chunksScanned}
          />
        );
      case 'verifying':
        return <VerifyingContent claimText={props.claimText} claimType={props.claimType} />;
      case 'hero':
        return <HeroContent card={props.card} />;
      case 'compact':
        return (
          <CompactContent 
            card={props.card} 
            isExpanded={props.isExpanded}
            onToggle={props.onToggle}
          />
        );
      case 'state':
        return (
          <StateContent
            badgeLabel={props.badgeLabel}
            headline={props.headline}
            supportLine={props.supportLine}
            tone={props.tone}
            actionLabel={props.actionLabel}
            onAction={props.onAction}
          />
        );
      case 'skeleton':
        return <SkeletonContent />;
    }
  })();

  // Size-based classes
  const sizeClasses = {
    scanning: 'feed-card-scanning',
    verifying: 'feed-card-verifying',
    hero: 'feed-card-hero',
    compact: 'feed-card-compact',
    state: 'feed-card-state',
    skeleton: 'feed-card-skeleton',
  };

  const isCompact = size === 'compact';
  const isScanning = size === 'scanning';
  const isPassiveCard = size === 'state' || size === 'skeleton';
  // State and skeleton cards span full width with no timeline context
  const showRail = !isPassiveCard;

  return (
    <div
      className="feed-card-wrapper feed-card-wrapper-rail"
      style={{ '--rail-left': '52px' } as CSSProperties}
    >
      {showRail && (
        <div className="feed-card-rail">
          {/* Timestamp — only on stage cards (compact shows timestamp in its own header row) */}
          {timestampSeconds !== null && !isCompact && (
            <div className="rail-timestamp-wrap">
              <span className="rail-timestamp">{formatTime(timestampSeconds)}</span>
            </div>
          )}

          {/* Diamond node — full size for stage cards, compact dot for resolved checks */}
          {/* NOTE: No per-card rail-line rendered here. The live-tab-rail::before pseudo-element
              is the single source of truth for the vertical spine. Removing the per-card line
              eliminates the double-line / fighting-animation visual artifact. */}
          <span
            className={[
              'rail-node',
              isCompact ? 'rail-node-compact' : '',
              !isCompact && glow ? 'rail-node-glow' : '',
              // B4: Pulse ring when card is actively being verified
              !isCompact && size === 'verifying' ? 'rail-node-active' : '',
            ].filter(Boolean).join(' ')}
            style={isCompact ? {
              // Compact: small solid-fill verdict dot
              backgroundColor: `rgba(${accentRgb}, 0.9)`,
              borderColor: `rgba(${accentRgb}, 0.30)`,
              boxShadow: `0 0 4px rgba(${accentRgb}, 0.22)`,
            } : {
              // Stage cards: dark interior + accent border — visually breaks the spine
              // so the line reads as "terminating" at the node, not passing through it
              backgroundColor: 'rgba(var(--sc-bg-0-rgb, 23, 23, 23), 0.97)',
              borderColor: `rgba(${accentRgb}, ${glow ? 0.88 : 0.68})`,
              borderWidth: '2px',
              boxShadow: glow
                ? `0 0 14px rgba(${accentRgb}, 0.42), 0 0 5px rgba(${accentRgb}, 0.24), inset 0 0 3px rgba(${accentRgb}, 0.18)`
                : `0 0 8px rgba(${accentRgb}, 0.28), 0 0 3px rgba(${accentRgb}, 0.14)`,
            }}
          />

          {/* Connector to card — only on stage cards; compact cards rely on proximity */}
          {!isCompact && (
            <span
              className="rail-connector"
              style={{
                background: `linear-gradient(to right, rgba(${accentRgb}, 0.72), rgba(${accentRgb}, 0.18) 80%, transparent)`
              }}
            />
          )}
        </div>
      )}

      {/* Card content */}
      <motion.div
        className={`feed-card ${sizeClasses[size]}`}
        data-size={size}
        data-status={status}
        data-tone={tone}
        data-action={size === 'scanning' && props.size === 'scanning' ? (props.actionState ?? undefined) : undefined}
        data-testid={size === 'compact' || size === 'hero' ? 'source-card' : undefined}
        initial={prefersReducedMotion || isCompact || suppressEntry ? false : { y: DISTANCE.enterY, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: DURATION.heroEnter, ease: SOFT_SPRING }}
        layout={size !== 'scanning' && size !== 'skeleton'}
        whileHover={
          prefersReducedMotion || isPassiveCard
            ? undefined
            : isCompact || isScanning
              ? hoverLiftCompact
              : hoverLift
        }
        whileTap={
          prefersReducedMotion || isPassiveCard || isScanning
            ? undefined
            : pressSettle
        }
      >
        {content}
      </motion.div>
    </div>
  );
};

export default memo(FeedCard);
