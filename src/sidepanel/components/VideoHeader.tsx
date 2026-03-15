import { useMemo } from 'react';
import type { AnalysisStatus, PlaybackState, SourceCard, VerificationStatus } from '../../../shared/types';
import { formatTime } from '../utils/formatTime';
import { panelTones } from '../styles/panelTokens';

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
    accent: string;
  }
> = {
  idle: {
    label: 'Idle',
    tone: 'text-textMuted',
    accent: panelTones.status.neutral,
  },
  loading: {
    label: 'Loading',
    tone: 'text-accentSoft',
    accent: panelTones.status.accentSoft,
  },
  monitoring: {
    label: 'Monitoring',
    tone: 'text-accent',
    accent: panelTones.status.accent,
  },
  verifying: {
    label: 'Checking',
    tone: 'text-partial',
    accent: panelTones.status.partial,
  },
  ready: {
    label: 'Ready',
    tone: 'text-textMuted',
    accent: panelTones.status.supported,
  },
  'no-transcript': {
    label: 'Transcript unavailable',
    tone: 'text-partial',
    accent: panelTones.status.partial,
  },
  error: {
    label: 'Error',
    tone: 'text-disputed',
    accent: panelTones.status.disputed,
  },
};

const VERDICT_TICK: Record<VerificationStatus, string> = {
  supported: 'bg-supported',
  partial: 'bg-partial',
  disputed: 'bg-disputed',
  unverifiable: 'bg-white/20',
};

const TRUTH_WEIGHTS: Record<VerificationStatus, number> = {
  supported: 1,
  partial: 0.68,
  disputed: 0.22,
  unverifiable: -1, // sentinel: excluded from score
};

export const VideoHeader = ({
  title,
  channel,
  status = 'idle',
  playbackState,
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
  const statusMeta = STATUS_META[status];
  const timelineCards = useMemo(() => {
    if (!cards.length) return [];

    const timelineStep = cards.length > 60 ? Math.ceil(cards.length / 60) : 1;

    return timelineStep > 1
      ? cards.filter((_card, index) => index % timelineStep === 0)
      : cards;
  }, [cards]);
  const truthScore = useMemo(() => {
    if (!cards.length) return null;

    // Only score claims that had real evidence — unverifiable claims are
    // not wrong, they're just uncheckable, so they shouldn't tank the score.
    const scorable = cards.filter((card) => card.status !== 'unverifiable');
    if (!scorable.length) return null;

    const sample = scorable.slice(0, 6);
    const average = sample.reduce((sum, card) => sum + TRUTH_WEIGHTS[card.status], 0) / sample.length;

    return Math.round(average * 100);
  }, [cards]);
  const scoreColor = truthScore === null
    ? undefined
    : truthScore >= 65
      ? panelTones.status.supported
      : truthScore >= 38
        ? panelTones.status.accent
        : panelTones.status.disputed;
  const isActive = status === 'monitoring' || status === 'verifying';
  const syncLabel = status === 'ready'
    ? 'Fully synced'
    : status === 'verifying'
      ? 'Checking'
      : status === 'monitoring'
        ? 'Live'
        : 'Standby';
  const anchorTime = isActive
    ? playbackState?.currentTime ?? lastScannedTimestamp ?? null
    : lastScannedTimestamp ?? playbackState?.currentTime ?? null;
  const anchorCopy = status === 'no-transcript'
    ? 'Transcript unavailable'
    : status === 'verifying' && anchorTime !== null
      ? `Checking near ${formatTime(anchorTime)}`
      : anchorTime !== null
        ? `Reading near ${formatTime(anchorTime)}`
        : 'Waiting for video';

  const statusLineCopy =
    status === 'monitoring' ? 'Listening for a checkable claim.' :
    status === 'verifying' ? 'Verifying a claim…' :
    null;

  return (
    <header className="video-header-shell mx-3 mt-3 border-b border-surfaceBorder px-4 pb-2 pt-3">
      {/* Title + badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1
            className="video-header-title text-[14.5px] font-semibold leading-[1.28] tracking-[-0.016em] text-textMain"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </h1>
        </div>

        <div className={[
          'status-badge mt-0.5 shrink-0',
          statusMeta.tone,
          isActive ? 'status-badge-live' : '',
        ].join(' ')}>
          {statusMeta.label}
        </div>
      </div>

      {/* Meta row: channel · anchor */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="video-header-meta min-w-0 truncate text-[10.5px]">
          {channel}
          <span className="mx-1 opacity-40">·</span>
          {anchorCopy}
        </p>
        {truthScore === null && syncLabel && (
          <span className="video-header-sync shrink-0 text-[9px]">{syncLabel}</span>
        )}
      </div>

      {/* Truth score — the number that makes you keep looking */}
      {truthScore !== null && (
        <div className="truth-score-row mt-2.5">
          <div className="flex items-center justify-between">
            <span className="truth-score-label">Accuracy so far</span>
            <span className="truth-score-value" style={{ color: scoreColor }}>{truthScore}%</span>
          </div>
          <div className="truth-score-bar mt-1.5">
            <div
              className="truth-score-fill"
              style={{ width: `${truthScore}%`, background: scoreColor }}
            />
          </div>
        </div>
      )}

      {/* Compact status line — what the system is doing right now */}
      {statusLineCopy && (
        <p className="mt-[6px] text-[10px] leading-[1.4] tracking-[0.02em]" style={{ color: statusMeta.accent, opacity: 0.72 }}>
          {statusLineCopy}
        </p>
      )}

      {/* Compact timeline */}
      <div className="relative mt-2 h-[18px]">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-surfaceBorder" />
        <div
          className="absolute left-0 top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,rgba(113,106,91,0.3),rgba(200,163,106,0.35))] transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
        <div
          className="timeline-spectrum absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-[width] duration-500"
          style={{ width: `${scanProgress}%` }}
        />
        {/* Scan head */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-500"
          style={{ left: `${scanProgress}%` }}
        >
          <div className="scan-burst" aria-hidden="true" />
          <div
            className={`h-[10px] w-[10px] rotate-45 border bg-transparent${isActive ? ' scan-head-live' : ''}`}
            style={{ borderColor: isActive ? statusMeta.accent : `${statusMeta.accent}88` }}
          />
        </div>

        {/* Verdict ticks */}
        {playbackState?.duration && timelineCards.map((card) => {
          const pct = Math.min(99, Math.max(1, (card.timestampSeconds / playbackState.duration) * 100));

          return (
            <div
              key={card.id}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pct}%` }}
            >
              <div className={`h-[5px] w-[5px] rotate-45 ${VERDICT_TICK[card.status]}`} />
            </div>
          );
        })}
      </div>
    </header>
  );
};
