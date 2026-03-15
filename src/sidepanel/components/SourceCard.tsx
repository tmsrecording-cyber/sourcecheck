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
      className={`feed-card result-card card-enter relative ml-1 px-4 py-5 ${isLatest ? 'result-card-active' : ''}`}
      style={cardStyle}
      data-verdict={status}
    >
      <span
        className="result-card-tab"
        aria-hidden="true"
        style={{ background: statusMeta.accent }}
      />

      {/* Verdict — the hero. This is the first thing you see. */}
      <VerdictBadge status={status} />

      {/* Insight — the useful bit. This is what you actually read. */}
      {nuanceLine ? (
        <>
          <p
            className="source-card-insight mt-3 max-w-[38ch] text-[14px] font-semibold leading-[1.50] text-textMain"
            style={{
              textWrap: 'balance',
              letterSpacing: '-0.012em',
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
            className="source-card-claim-quote mt-3 max-w-[40ch] text-[13px] leading-[1.50]"
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
          className="source-card-claim mt-4 max-w-[34ch] text-[18px] font-semibold leading-[1.38] text-textMain"
          style={{ textWrap: 'balance', letterSpacing: '-0.022em' }}
        >
          {claim.claimText}
        </p>
      )}

      <div className="result-card-footer mt-4 min-w-0 border-t border-surfaceBorder/50 pt-3">
        <span className="result-card-source-label">Source</span>
        {sourceUrl && sourceTitle?.trim() ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="result-card-source text-[12px] leading-[1.55] text-textMuted transition-colors hover:text-accentSoft"
          >
            {sourceLine}
          </a>
        ) : (
          <p className="result-card-source text-[12px] leading-[1.55] text-textMuted/70">{sourceLine}</p>
        )}
      </div>
    </article>
  );
};
