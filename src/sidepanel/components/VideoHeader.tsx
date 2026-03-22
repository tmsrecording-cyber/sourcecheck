import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AnalysisStatus, PlaybackState, SourceCard } from '../../../shared/types';
import type { LivePhase } from '../hooks/useLiveStageFlow';
import { buildModelCssVars } from '../styles/modelTheme';
import { formatTime } from '../utils/formatTime';

interface VideoHeaderProps {
  title: string;
  channel: string;
  activeTab?: 'live' | 'history';
  status?: AnalysisStatus;
  playbackState?: PlaybackState | null;
  lastScannedTimestamp?: number | null;
  cards?: SourceCard[];
  selectedModel?: string;
  livePhase?: LivePhase;
  liveStripCopy?: string | null;
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
    text: `Supported ${summary.supported} · Mixed ${summary.mixed} · Unsupported ${summary.unsupported} · Unverifiable ${summary.unresolved}`,
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

const STATUS_META: Record<
  AnalysisStatus,
  { label: string; tone: string }
> = {
  idle: { label: 'Idle', tone: 'text-sc-muted' },
  loading: { label: 'Loading', tone: 'text-sc-accent-soft' },
  monitoring: { label: 'Listening', tone: 'text-sc-accent' },
  verifying: { label: 'Verifying', tone: 'text-sc-partial' },
  ready: { label: 'Caught up', tone: 'text-sc-muted' },
  'no-transcript': { label: 'Unavailable', tone: 'text-sc-partial' },
  error: { label: 'Error', tone: 'text-sc-disputed' },
};

const getStatusBadgeStyle = (status: AnalysisStatus) => {
  const isModelDriven = status === 'loading' || status === 'monitoring' || status === 'verifying';

  if (isModelDriven) {
    return {
      borderColor: 'rgba(var(--model-accent-rgb), 0.32)',
      background: 'linear-gradient(180deg, var(--model-accent-10), rgba(var(--sc-surface-0-rgb), 0.92))',
      color: 'var(--model-accent-solid)',
    };
  }
  if (status === 'ready') {
    return {
      borderColor: 'rgba(var(--sc-supported-rgb), 0.24)',
      background: 'rgba(var(--sc-supported-rgb), 0.10)',
      color: 'var(--sc-supported)',
    };
  }
  if (status === 'no-transcript') {
    return {
      borderColor: 'rgba(var(--sc-partial-rgb), 0.24)',
      background: 'rgba(var(--sc-partial-rgb), 0.10)',
      color: 'var(--sc-partial)',
    };
  }
  if (status === 'error') {
    return {
      borderColor: 'rgba(var(--sc-disputed-rgb), 0.24)',
      background: 'rgba(var(--sc-disputed-rgb), 0.10)',
      color: 'var(--sc-disputed)',
    };
  }
  return undefined;
};

export const VideoHeader = ({
  title,
  channel,
  activeTab = 'live',
  status = 'idle',
  playbackState,
  lastScannedTimestamp = null,
  cards = [],
  selectedModel,
  livePhase = 'idle',
  liveStripCopy = null,
}: VideoHeaderProps) => {
  const modelCssVars = buildModelCssVars(selectedModel);
  const isLiveTab = activeTab === 'live';
  const statusMeta = STATUS_META[status];
  const isScanning = status === 'monitoring' || status === 'verifying';
  const statusBadgeStyle = getStatusBadgeStyle(status);

  const verificationSummary = useMemo(() => buildVerificationSummary(cards), [cards]);
  const showSummary = !isLiveTab && verificationSummary;

  const anchorTime = isScanning
    ? playbackState?.currentTime ?? lastScannedTimestamp ?? null
    : lastScannedTimestamp ?? playbackState?.currentTime ?? null;

  const anchorCopy = buildHeaderAnchorCopy(status, anchorTime);
  const stripCopy = liveStripCopy;

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
              'font-bold tracking-[-0.02em] leading-[1.3] text-sc-text line-clamp-2',
              isLiveTab ? 'text-[15px]' : 'text-[13.5px] font-semibold tracking-[-0.011em] leading-[1.4]',
            ].join(' ')}
          >
            {title}
          </h1>
        </div>

        {!isLiveTab && (
          <div
            className={[
              'video-header-status-badge px-2 py-0.5 rounded font-mono text-[9px] font-bold tracking-[0.08em] uppercase bg-sc-surface-2 border border-sc-border-soft/80 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
              statusMeta.tone,
              isScanning ? 'animate-pulse-glow' : '',
            ].join(' ')}
            style={{
              ...(statusBadgeStyle ?? {}),
              boxShadow: isScanning ? 'var(--model-accent-glow)' : undefined,
            }}
          >
            {statusMeta.label}
          </div>
        )}
      </div>

      {isLiveTab && (
        <AnimatePresence mode="wait">
          <motion.p
            key={`${livePhase}-${stripCopy ?? 'idle'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="mt-0.5 text-[11px] text-sc-muted/50 tracking-[0.005em] truncate"
          >
            {channel}{stripCopy ? <><span className="mx-1.5 opacity-40">·</span>{stripCopy}</> : null}
          </motion.p>
        </AnimatePresence>
      )}

      {!isLiveTab && (
        <div className="mt-1.5 flex items-center gap-2">
          <p className="truncate font-mono uppercase tracking-[0.12em] text-sc-muted opacity-75 text-[11px]">
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
