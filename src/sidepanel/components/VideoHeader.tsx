import { useMemo } from 'react';
import type { AnalysisStatus, PlaybackState, SourceCard } from '../../../shared/types';
import { formatTime } from '../utils/formatTime';

interface VideoHeaderProps {
  title: string;
  channel: string;
  status?: AnalysisStatus;
  playbackState?: PlaybackState | null;
  chunksScanned?: number;
  lastScannedTimestamp?: number | null;
  cards?: SourceCard[];
}

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
    label: 'Preparing',
    tone: 'text-sc-accent-soft',
    accentClass: 'text-sc-accent-soft',
  },
  monitoring: {
    label: 'Building notes',
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
  status = 'idle',
  playbackState,
  chunksScanned = 0,
  lastScannedTimestamp = null,
  cards = [],
}: VideoHeaderProps) => {
  const safeDuration =
    playbackState?.duration && Number.isFinite(playbackState.duration) && playbackState.duration > 0
      ? playbackState.duration
      : 1;
  const progress = playbackState?.duration
    ? Math.min(100, Math.max(0, ((playbackState.currentTime ?? 0) / safeDuration) * 100))
    : 0;
  const scanProgress = playbackState?.duration && lastScannedTimestamp !== null
    ? Math.min(100, Math.max(0, (lastScannedTimestamp / safeDuration) * 100))
    : progress;
  const isPlaybackActive = Boolean(playbackState && !playbackState.paused);
  const displayStatus = status === 'ready' && isPlaybackActive ? 'monitoring' : status;
  const statusMeta = STATUS_META[displayStatus];
  const timelineCards = useMemo(() => {
    if (!cards.length) return [];

    const timelineStep = cards.length > 60 ? Math.ceil(cards.length / 60) : 1;

    return timelineStep > 1
      ? cards.filter((_card, index) => index % timelineStep === 0)
      : cards;
  }, [cards]);
  const verificationSummary = useMemo(() => {
    if (!cards.length) return null;
    
    const supported = cards.filter(c => c.status === 'supported').length;
    const partial = cards.filter(c => c.status === 'partial').length;
    const disputed = cards.filter(c => c.status === 'disputed').length;
    const unresolved = cards.filter(c => c.status === 'unverifiable').length;
    const resolved = supported + partial + disputed;
    
    if (resolved === 0 && unresolved === 0) return null;
    
    const parts: string[] = [];
    if (supported > 0) parts.push(`${supported} supported`);
    if (partial > 0) parts.push(`${partial} mixed`);
    if (disputed > 0) parts.push(`${disputed} unsupported`);
    if (unresolved > 0) parts.push(`${unresolved} unresolved`);
    
    return { text: parts.join(' • '), resolved, total: cards.length };
  }, [cards]);

  const isActive = displayStatus === 'monitoring' || displayStatus === 'verifying';
  const anchorTime = isActive
    ? playbackState?.currentTime ?? lastScannedTimestamp ?? null
    : lastScannedTimestamp ?? playbackState?.currentTime ?? null;
  const anchorCopy = displayStatus === 'no-transcript'
    ? 'Transcript unavailable'
    : displayStatus === 'verifying' && anchorTime !== null
      ? `Latest note at ${formatTime(anchorTime)}`
      : anchorTime !== null
        ? `At ${formatTime(anchorTime)}`
        : 'Waiting for video';

  // PHASE 1D.11 FIX: Show different status when transcript exists vs waiting for transcript
  const hasTranscriptContent = (chunksScanned ?? 0) > 0 || (lastScannedTimestamp ?? 0) > 0;
  const statusLineCopy =
    displayStatus === 'monitoring'
      ? (hasTranscriptContent ? 'Turning the transcript into verifiable notes.' : 'Waiting for a concrete claim worth checking.')
      : displayStatus === 'verifying'
        ? 'Checking the latest note against web sources.'
        : displayStatus === 'ready'
          ? 'Recent notes are up to date.'
          : null;

  return (
    <header className="glass-deep mx-3 mt-3 px-4 pb-3.5 pt-3.5 rounded-lg">
      {/* Title + badge - HUD Compressed Typography */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1
            className="text-[13.5px] font-semibold tracking-[-0.011em] leading-[1.4] text-sc-text line-clamp-2 text-balance"
          >
            {title}
          </h1>
        </div>

        <div className={[
          'px-2 py-0.5 rounded font-mono text-[9px] font-bold tracking-[0.08em] uppercase bg-sc-surface-2 border border-sc-border-soft/80 shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
          statusMeta.tone,
          isActive ? 'animate-pulse-glow shadow-[0_0_12px_rgba(138,180,248,0.25)]' : '',
        ].join(' ')}>
          {statusMeta.label}
        </div>
      </div>

      {/* Meta row: channel · timestamp */}
      <div className="mt-1.5 flex items-center gap-2">
        <p className="truncate text-[11px] font-mono text-sc-muted uppercase tracking-[0.12em] opacity-75">
          {channel}
          <span className="mx-1.5 opacity-25">·</span>
          {anchorCopy}
        </p>
      </div>

      {verificationSummary && (
        <div className="mt-4 rounded-md border border-sc-border-soft/70 bg-sc-surface-1/60 px-3 py-2.5">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[9px] font-bold tracking-[0.12em] uppercase text-sc-muted/60">
              Verified notes
            </span>
            <span className="text-[11px] text-sc-muted/70">
              {verificationSummary.resolved} resolved of {verificationSummary.total}
            </span>
          </div>
          <p className="mt-1.5 text-[10px] font-mono text-sc-muted/80 tracking-wide">
            {verificationSummary.text}
          </p>
        </div>
      )}

      {/* Compact status line */}
      {statusLineCopy && (
        <p className={`mt-3 text-[10.5px] font-medium leading-relaxed tracking-wide italic opacity-85 font-sc ${statusMeta.accentClass}`}>
          {statusLineCopy}
        </p>
      )}

      {/* Enhanced Timeline with Spectrum Gradient */}
      <div className="relative mt-4 h-5">
        {/* Base track with spectrum gradient */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full timeline-spectrum-track opacity-40" />
        
        {/* Active progress with glow */}
        <div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full timeline-spectrum-progress transition-[width] duration-500"
          style={{ width: `${Math.max(progress, scanProgress)}%` }}
        />
        
        {/* Scan head - diamond shaped with drift animation */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-500 z-10"
          style={{ left: `${scanProgress}%` }}
        >
          <div 
            className={`h-3 w-3 rotate-45 border-2 bg-sc-bg-0 transition-colors shadow-[0_0_10px_rgba(var(--model-accent-rgb,168,199,250),0.5),inset_0_0_4px_#fff] ${
              isActive 
                ? 'border-sc-accent animate-scan-head-drift' 
                : 'border-sc-line-strong'
            }`}
          />
        </div>

        {/* Verdict ticks - diamond shape with color coding */}
        {playbackState?.duration && timelineCards.map((card) => {
          const pct = Math.min(99, Math.max(1, (card.timestampSeconds / playbackState.duration) * 100));

          return (
            <div
              key={card.id}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pct}%` }}
            >
              <div className={`timeline-diamond timeline-diamond-${card.status}`} />
            </div>
          );
        })}
      </div>
    </header>
  );
};
