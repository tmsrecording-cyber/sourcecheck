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

import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { formatTime } from '../utils/formatTime';
import { stripLegacyCachePrefix } from '../utils/trustCopy';
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

// Backend placeholder strings that should not be displayed as real source titles
const BACKEND_SOURCE_PLACEHOLDERS = new Set(['Needs primary source', 'No strong web match']);
const resolveSourceTitle = (raw: string | undefined | null): string | null => {
  const trimmed = raw?.trim();
  return (trimmed && !BACKEND_SOURCE_PLACEHOLDERS.has(trimmed)) ? trimmed : null;
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
}

// Scanning state: showing transcript preview
interface ScanningProps extends FeedCardBaseProps {
  size: 'scanning';
  previewText: string;
  entities?: string[];
  actionState?: 'VERIFYING' | 'REJECTED' | 'BUFFERING' | 'PARSE_ERROR' | null;
  reason?: string | null;
}

// Verifying state: active verification
interface VerifyingProps extends FeedCardBaseProps {
  size: 'verifying';
  claimText: string;
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
  unverifiable: { label: 'Unverifiable', rgb: '154, 160, 166' },
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
  const icons = {
    supported: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    partial: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6H9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    disputed: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    unverifiable: (
      <svg width={s} height={s} viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
      </svg>
    ),
  };

  return (
    <span className={`status-icon ${size === 'small' ? 'status-icon-sm' : ''}`} data-status={status}>
      {icons[status]}
    </span>
  );
};

// Verifying card with thinking animation
const VerifyingContent = ({ claimText }: { claimText: string }) => {
  const [thoughtIndex, setThoughtIndex] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setThoughtIndex(i => (i + 1) % 4);
    }, 900);
    return () => clearInterval(interval);
  }, []);
  
  const thoughts = [
    'Reading the claim',
    'Searching sources',
    'Cross-referencing',
    'Synthesizing results',
  ];
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="thinking-pulse-dot" />
        <span className="status-badge status-badge-live">Verifying</span>
      </div>

      <p className="mt-3 text-[17px] font-semibold leading-[1.42] tracking-[-0.016em] text-textMain">
        {claimText}
      </p>

      <div className="thinking-stream mt-3">
        {/* Step pills — one per thought phase, fills left to right */}
        <div className="verifying-pips" aria-hidden="true">
          {thoughts.map((_, i) => (
            <span
              key={i}
              className="verifying-pip"
              data-state={i < thoughtIndex ? 'done' : i === thoughtIndex ? 'active' : 'pending'}
            />
          ))}
        </div>
        <p className="verifying-thought">{thoughts[thoughtIndex]}</p>
      </div>
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
  const hasSourceLink = Boolean(card.sourceUrl?.trim() && resolvedSourceTitle);
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

      <div className="feed-card-source-block mt-3">
        <p className="feed-card-source-kicker">Source</p>
        {hasSourceLink ? (
          <a
            href={card.sourceUrl}
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
  const primaryText = nuance || card.claim.claimText;
  const resolvedSourceTitleCompact = resolveSourceTitle(card.sourceTitle);
  const secondaryText = resolvedSourceTitleCompact || (nuance ? card.claim.claimText : '');
  const evidenceSnippet = card.evidenceSnippet?.trim() || '';
  const hasSourceLink = Boolean(card.sourceUrl?.trim() && resolvedSourceTitleCompact);
  const memorySummary = buildSimilarClaimSummary(card.similarClaims ?? []);
  const isInteractive = Boolean(onToggle);

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
            {memorySummary && (
              <span className="compact-memory-chip">
                Seen before
              </span>
            )}
          </div>
          <p className="compact-claim-text line-clamp-2">
            {primaryText}
          </p>
          {secondaryText && !isExpanded && (
            <p className="compact-secondary-text line-clamp-1">
              {secondaryText}
            </p>
          )}

          {isExpanded && (
            <motion.div
              initial={prefersReducedMotion ? false : expandReveal.initial}
              animate={expandReveal.animate}
              exit={expandReveal.exit}
              transition={expandReveal.transition}
              className="compact-expanded-panel"
            >
              {nuance && nuance !== card.claim.claimText && (
                <p className="compact-expanded-quote">
                  "{card.claim.claimText}"
                </p>
              )}
              {evidenceSnippet && (
                <p className="compact-expanded-evidence">
                  "{evidenceSnippet}"
                </p>
              )}
              {card.sourceTitle && (
                <p className="compact-expanded-source">
                  {hasSourceLink ? (
                    <a
                      href={card.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="compact-expanded-source-link"
                      onClick={stopSourceLinkPropagation}
                      onKeyDown={stopSourceLinkPropagation}
                    >
                      <span>{card.sourceTitle}</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    card.sourceTitle
                  )}
                </p>
              )}
              {memorySummary && (
                <p className="compact-memory-copy">
                  Seen before: {memorySummary}
                </p>
              )}
            </motion.div>
          )}
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

/**
 * Normalize ALL CAPS transcript text for display.
 * YouTube auto-captions on news channels often arrive in uppercase.
 * Detects >60% uppercase letter ratio and converts to sentence case.
 */
const normalizeCapsText = (text: string): string => {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length === 0) return text;
  const upperRatio = (text.match(/[A-Z]/g) ?? []).length / letters.length;
  if (upperRatio < 0.6) return text;
  // Convert to sentence case: lowercase all, capitalize after sentence boundaries
  return text
    .toLowerCase()
    .replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, boundary, char) => boundary + char.toUpperCase());
};

// Scanning/forming card
const ScanningContent = ({ 
  previewText, 
  entities = [],
  actionState,
  reason 
}: { 
  previewText: string; 
  entities?: string[];
  actionState?: 'VERIFYING' | 'REJECTED' | 'BUFFERING' | 'PARSE_ERROR' | null;
  reason?: string | null;
}) => {
  const isVerifying = actionState === 'VERIFYING';
  
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`status-dot ${isVerifying ? 'status-dot-pulse' : 'status-dot-subtle'}`} />
        <span className="text-[11px] text-sc-muted font-medium tracking-[0.02em]">
          {isVerifying ? 'Checking claim…' : 'Scanning'}
        </span>
      </div>

      {previewText && (
        <p className="mt-2.5 text-[14px] text-textMain/80 leading-relaxed line-clamp-2">
          {normalizeCapsText(previewText)}
        </p>
      )}

      {entities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entities.slice(0, 4).map((entity, i) => (
            <span key={i} className="entity-chip">{entity}</span>
          ))}
        </div>
      )}

      {reason && !isVerifying && (
        <p className="mt-2 text-[11px] text-sc-muted/70">{reason}</p>
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
    <div className="skeleton h-4 w-16 rounded" />
    <div className="mt-3 skeleton h-4 w-full rounded" />
    <div className="mt-2 skeleton h-4 w-4/5 rounded" />
  </div>
);

// Main FeedCard component
export const FeedCard = (props: FeedCardProps) => {
  const { timestampSeconds, size, accentRgb = '138, 180, 248', glow = false } = props;
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
          />
        );
      case 'verifying':
        return <VerifyingContent claimText={props.claimText} />;
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
  const isPassiveCard = size === 'scanning' || size === 'state' || size === 'skeleton';
  const showRail = !isCompact;
  const railLeft = isCompact ? 0 : 44; // Reduced from 72px

  return (
    <div 
      className={`feed-card-wrapper ${isCompact ? '' : 'feed-card-wrapper-rail'}`}
      style={{ '--rail-left': `${railLeft}px` } as CSSProperties}
    >
      {showRail && (
        <div className="feed-card-rail">
          {/* Timestamp */}
          {timestampSeconds !== null && (
            <div className="rail-timestamp-wrap">
              <span className="rail-timestamp">{formatTime(timestampSeconds)}</span>
            </div>
          )}
          
          {/* Vertical rail line */}
          <span 
            className="rail-line"
            style={{
              background: `linear-gradient(180deg, transparent 0%, rgba(${accentRgb}, 0.38) 8%, rgba(${accentRgb}, 0.22) 50%, rgba(${accentRgb}, 0.08) 92%, transparent 100%)`,
            }}
          />
          
          {/* Diamond node */}
          <span
            className={`rail-node ${glow ? 'rail-node-glow' : ''}`}
            style={{ 
              backgroundColor: `rgba(${accentRgb}, 1)`,
              borderColor: `rgba(${accentRgb}, ${glow ? 0.5 : 0.34})`,
              boxShadow: glow
                ? `0 0 10px rgba(${accentRgb}, 0.3), inset 0 0 2px rgba(255, 255, 255, 0.45)`
                : `0 0 6px rgba(${accentRgb}, 0.18), inset 0 0 2px rgba(255, 255, 255, 0.3)`,
            }}
          />
          
          {/* Connector to card */}
          <span
            className="rail-connector"
            style={{ 
              background: `linear-gradient(to right, rgba(${accentRgb}, 0.82), rgba(${accentRgb}, 0.22) 80%, transparent)`
            }}
          />
        </div>
      )}

      {/* Card content */}
      <motion.div
        className={`feed-card ${sizeClasses[size]}`}
        data-size={size}
        data-status={status}
        data-tone={tone}
        initial={prefersReducedMotion || isCompact ? false : { y: DISTANCE.enterY, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: DURATION.heroEnter, ease: SOFT_SPRING }}
        layout={size !== 'scanning' && size !== 'skeleton'}
        whileHover={
          prefersReducedMotion || isPassiveCard
            ? undefined
            : isCompact
              ? hoverLiftCompact
              : hoverLift
        }
        whileTap={
          prefersReducedMotion || isPassiveCard
            ? undefined
            : pressSettle
        }
      >
        {content}
      </motion.div>
    </div>
  );
};

export default FeedCard;
