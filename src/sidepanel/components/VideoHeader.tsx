import { useMemo } from 'react';
import type { AnalysisStatus, PlaybackState, SourceCard } from '../../../shared/types';
import { buildModelCssVars } from '../styles/modelTheme';
import { formatTime } from '../utils/formatTime';
import type { HeroSlotState } from './CardFeed';

interface VideoHeaderProps {
  title: string;
  channel: string;
  activeTab?: 'live' | 'history';
  status?: AnalysisStatus;
  playbackState?: PlaybackState | null;
  chunksScanned?: number;
  lastScannedTimestamp?: number | null;
  cards?: SourceCard[];
  selectedModel?: string;
  /** Hero slot state for header sync - keeps header aligned with promoted card */
  heroState?: HeroSlotState;
}

export interface VerificationSummary {
  supported: number;
  mixed: number;
  unsupported: number;
  unresolved: number;
  total: number;
  text: string;
}

export const buildVerificationSummary = (cards: SourceCard[]): VerificationSummary | null => {
  if (!cards.length) {
    return null;
  }

  const summary = {
    supported: 0,
    mixed: 0,
    unsupported: 0,
    unresolved: 0,
    total: cards.length,
  };

  cards.forEach((card) => {
    switch (card.status) {
      case 'supported':
        summary.supported += 1;
        break;
      case 'partial':
        summary.mixed += 1;
        break;
      case 'disputed':
        summary.unsupported += 1;
        break;
      case 'unverifiable':
        summary.unresolved += 1;
        break;
    }
  });

  return {
    ...summary,
    text: `Supported ${summary.supported} • Mixed ${summary.mixed} • Unsupported ${summary.unsupported} • Unverifiable ${summary.unresolved}`,
  };
};

export const buildHeaderAnchorCopy = (
  status: AnalysisStatus,
  anchorTime: number | null,
): string => {
  switch (status) {
    case 'no-transcript':
      return 'Transcript unavailable';
    case 'loading':
      return 'Preparing transcript';
    case 'monitoring':
    case 'verifying':
      return anchorTime !== null ? `Checking at ${formatTime(anchorTime)}` : 'Checking now';
    case 'ready':
      return anchorTime !== null ? `Last checked at ${formatTime(anchorTime)}` : 'Caught up';
    case 'error':
      return 'Could not verify right now';
    case 'idle':
    default:
      return 'Waiting for video';
  }
};

export const buildStatusLineCopy = (
  status: AnalysisStatus,
  hasTranscriptContent: boolean,
): string | null => {
  switch (status) {
    case 'monitoring':
      return hasTranscriptContent
        ? 'Listening for checkable claims.'
        : 'Waiting for a claim worth checking.';
    case 'verifying':
      return 'Checking the latest claim.';
    case 'ready':
      return 'Checks are up to date.';
    case 'loading':
      return 'Loading transcript.';
    case 'no-transcript':
      return 'No usable captions were found for this video.';
    case 'error':
      return 'Something interrupted verification. Try refreshing the page.';
    case 'idle':
    default:
      return null;
  }
};

export const resolveVideoHeaderStatus = (
  status: AnalysisStatus,
  heroState?: HeroSlotState,
): AnalysisStatus => {
  if (heroState?.mode === 'resolved') {
    return 'ready';
  }

  if (heroState?.mode === 'verifying') {
    return 'verifying';
  }

  return status;
};

const STATUS_META: Record<
  AnalysisStatus,
  {
    label: string;
    tone: string;
    accentClass: string;
  }
> = {
  idle: {
    label: 'Idle',
    tone: 'text-sc-muted',
    accentClass: 'text-sc-neutral',
  },
  loading: {
    label: 'Loading',
    tone: 'text-sc-accent-soft',
    accentClass: 'text-sc-accent-soft',
  },
  monitoring: {
    label: 'Listening',
    tone: 'text-sc-accent',
    accentClass: 'text-sc-accent',
  },
  verifying: {
    label: 'Verifying',
    tone: 'text-sc-partial',
    accentClass: 'text-sc-partial',
  },
  ready: {
    label: 'Caught up',
    tone: 'text-sc-muted',
    accentClass: 'text-sc-supported',
  },
  'no-transcript': {
    label: 'Transcript unavailable',
    tone: 'text-sc-partial',
    accentClass: 'text-sc-partial',
  },
  error: {
    label: 'Error',
    tone: 'text-sc-disputed',
    accentClass: 'text-sc-disputed',
  },
};

export const VideoHeader = ({
  title,
  channel,
  activeTab = 'live',
  status = 'idle',
  playbackState,
  chunksScanned = 0,
  lastScannedTimestamp = null,
  cards = [],
  selectedModel,
  heroState,
}: VideoHeaderProps) => {
  const modelCssVars = buildModelCssVars(selectedModel);
  const effectiveStatus = useMemo(
    () => resolveVideoHeaderStatus(status, heroState),
    [status, heroState],
  );
  const isResolvedHero = heroState?.mode === 'resolved';
  const isLiveTab = activeTab === 'live';
  const displayStatus = effectiveStatus;
  const statusMeta = STATUS_META[displayStatus];
  const isModelDrivenStatus = displayStatus === 'loading' || displayStatus === 'monitoring' || displayStatus === 'verifying';
  const statusBadgeStyle = isResolvedHero
    ? {
        borderColor: 'rgba(var(--sc-neutral-rgb), 0.18)',
        background: 'rgba(var(--sc-surface-1-rgb), 0.72)',
        color: 'var(--sc-text-soft)',
      }
    : isModelDrivenStatus
    ? {
        borderColor: 'rgba(var(--model-accent-rgb), 0.32)',
        background: 'linear-gradient(180deg, var(--model-accent-10), rgba(var(--sc-surface-0-rgb), 0.92))',
        color: 'var(--model-accent-solid)',
      }
    : displayStatus === 'ready'
      ? {
          borderColor: 'rgba(var(--sc-supported-rgb), 0.24)',
          background: 'rgba(var(--sc-supported-rgb), 0.10)',
          color: 'var(--sc-supported)',
        }
      : displayStatus === 'no-transcript'
        ? {
            borderColor: 'rgba(var(--sc-partial-rgb), 0.24)',
            background: 'rgba(var(--sc-partial-rgb), 0.10)',
            color: 'var(--sc-partial)',
          }
        : displayStatus === 'error'
          ? {
              borderColor: 'rgba(var(--sc-disputed-rgb), 0.24)',
              background: 'rgba(var(--sc-disputed-rgb), 0.10)',
              color: 'var(--sc-disputed)',
            }
          : undefined;
  const verificationSummary = useMemo(() => buildVerificationSummary(cards), [cards]);

  const isScanning = !isResolvedHero && (displayStatus === 'monitoring' || displayStatus === 'verifying');
  const anchorTime = isResolvedHero
    ? heroState.card.timestampSeconds
    : isScanning
    ? playbackState?.currentTime ?? lastScannedTimestamp ?? null
    : lastScannedTimestamp ?? playbackState?.currentTime ?? null;

  const heroAwareCopy = useMemo(() => {
    if (heroState?.mode === 'resolved') {
      return { anchor: `Checked at ${formatTime(heroState.card.timestampSeconds)}` };
    }
    if (heroState?.mode === 'verifying') {
      return { anchor: anchorTime !== null ? `Checking at ${formatTime(anchorTime)}` : 'Checking now' };
    }
    return null;
  }, [heroState, anchorTime]);

  const anchorCopy = heroAwareCopy?.anchor ?? buildHeaderAnchorCopy(displayStatus, anchorTime);
  const statusBadgeLabel = !isLiveTab
    ? isResolvedHero
      ? 'Just checked'
      : heroState?.mode === 'verifying'
        ? 'Verifying'
        : statusMeta.label
    : null;
  const showSummary = !isLiveTab && verificationSummary;

  return (
    <header
      className={[
        'video-header mx-3',
        isLiveTab
          ? 'mt-2.5 pl-[52px] pr-3 pb-0 pt-1.5'
          : 'glass-deep rounded-lg px-4 pb-3 pt-3',
      ].join(' ').trim()}
      style={modelCssVars}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1
            className={[
              'font-semibold tracking-[-0.011em] leading-[1.4] text-sc-text line-clamp-2 text-balance',
              isLiveTab ? 'text-[12.75px] opacity-95' : 'text-[13.5px]',
            ].join(' ')}
          >
            {title}
          </h1>
        </div>

        {statusBadgeLabel && (
          <div
            className={[
              'video-header-status-badge px-2 py-0.5 rounded font-mono text-[9px] font-bold tracking-[0.08em] uppercase bg-sc-surface-2 border border-sc-border-soft/80 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
              isResolvedHero ? 'video-header-status-badge-resolved' : '',
              statusMeta.tone,
              isScanning ? 'animate-pulse-glow' : '',
            ].join(' ')}
            style={{
              ...(statusBadgeStyle ?? {}),
              boxShadow: isScanning ? 'var(--model-accent-glow)' : undefined,
            }}
          >
            {statusBadgeLabel}
          </div>
        )}
      </div>

      {!isLiveTab && (
        <div className="mt-1.5 flex items-center gap-2">
          <p
            className={`truncate font-mono uppercase tracking-[0.12em] text-sc-muted ${isResolvedHero ? 'opacity-60' : 'opacity-75'} text-[11px]`}
          >
            {channel}
            <span className="mx-1.5 opacity-25">·</span>
            {anchorCopy}
          </p>
        </div>
      )}

      {showSummary && (
        <div className="mt-3 rounded-md border border-sc-border-soft/70 bg-sc-surface-1/60 px-3 py-2.5">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-sc-muted/60">
              Verification summary
            </span>
            <span className="text-[11px] text-sc-muted/70">
              {verificationSummary.total} checked
            </span>
          </div>
          <p className="mt-1.5 text-[10px] font-mono text-sc-muted/80 tracking-wide">
            {verificationSummary.text}
          </p>
        </div>
      )}
    </header>
  );
};
