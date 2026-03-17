import type { CSSProperties } from 'react';
import type {
  SourceCard as SourceCardRecord,
  VerificationStatus,
} from '../../../shared/types';
import { VerdictBadge } from './VerdictBadge';
import { panelTones } from '../styles/panelTokens';

interface SourceCardProps extends SourceCardRecord {
  isLatest?: boolean;
}

/* ── Status Icons ── */
const StatusIcon = ({ status }: { status: VerificationStatus }) => {
  const icons = {
    supported: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    partial: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2.5 6H9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    disputed: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M3.5 3.5L8.5 8.5M8.5 3.5L3.5 8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
    unverifiable: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="1.5" fill="currentColor"/>
      </svg>
    ),
  };

  const statusClass = {
    supported: 'status-icon-supported',
    partial: 'status-icon-partial',
    disputed: 'status-icon-disputed',
    unverifiable: 'status-icon-neutral',
  };

  return (
    <span className={`status-icon ${statusClass[status]}`}>
      {icons[status]}
    </span>
  );
};

const STATUS_META: Record<
  VerificationStatus,
  {
    label: string;
    color: string;
    accent: string;
  }
> = {
  supported: {
    label: 'Supported',
    color: 'text-supported',
    accent: panelTones.status.supported,
  },
  partial: {
    label: 'Mixed',
    color: 'text-partial',
    accent: panelTones.status.partial,
  },
  disputed: {
    label: 'Unsupported',
    color: 'text-disputed',
    accent: panelTones.status.disputed,
  },
  unverifiable: {
    label: 'Unresolved',
    color: 'text-textMuted',
    accent: panelTones.status.neutral,
  },
};

export const SourceCard = ({
  claim,
  status,
  sourceTitle,
  sourceUrl,
  nuance,
  isLatest,
}: SourceCardProps) => {
  const statusMeta = STATUS_META[status];
  const sourceLine = sourceTitle?.trim()
    ? sourceTitle.trim()
    : 'No web source found.';
  const nuanceLine = nuance?.trim();
  const cardStyle = {
    borderLeft: `3px solid ${statusMeta.accent}`,
    '--result-accent': statusMeta.accent,
    '--result-accent-soft': `${statusMeta.accent}28`,
    '--result-accent-glow': `${statusMeta.accent}40`,
  } as CSSProperties;

  return (
    <article
      className={`feed-card result-card card-enter relative ml-1 px-4 py-5 hover-lift ${isLatest ? 'result-card-active' : ''}`}
      style={cardStyle}
      data-verdict={status}
    >
      <span
        className="result-card-tab"
        aria-hidden="true"
        style={{ background: statusMeta.accent }}
      />

      {/* Verdict — with status icon */}
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <VerdictBadge status={status} />
      </div>

      {/* Insight — the useful bit. This is what you actually read. */}
      {nuanceLine ? (
        <>
          <p
            className="source-card-insight mt-3 max-w-[38ch] text-lg-sc font-semibold text-textMain font-ui text-balance"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {nuanceLine}
          </p>

          {/* Claim — what was said. You already heard it, this is just context. */}
          <p
            className="source-card-claim-quote mt-3 max-w-[40ch] text-base-sc text-textMain/70 font-ui"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            &ldquo;{claim.claimText}&rdquo;
          </p>
        </>
      ) : (
        <p
          className="source-card-claim mt-4 max-w-[34ch] text-2xl-sc font-semibold text-textMain font-ui text-balance"
        >
          {claim.claimText}
        </p>
      )}

      <div className="result-card-footer mt-4 min-w-0 border-t border-surfaceBorder/50 pt-3">
        <span className="result-card-source-label font-mono text-xs-sc">Source</span>
        {sourceUrl && sourceTitle?.trim() ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="electric-hover result-card-source text-sm-sc text-sc-text-soft font-ui block mt-1"
          >
            {sourceLine}
          </a>
        ) : (
          <p className="result-card-source text-sm-sc text-textMuted/70 font-ui mt-1">{sourceLine}</p>
        )}
      </div>
    </article>
  );
};
