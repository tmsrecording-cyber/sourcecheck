import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  AnalysisStatus,
  ExtractionActionState,
  PendingClaimPreview,
  PlaybackState,
  SourceCard,
} from '../../../shared/types';
import { formatTime } from '../utils/formatTime';

export type LivePhase = 'idle' | 'reading' | 'checking' | 'resolved';
export type ReadingVariant = 'preview' | 'quiet' | null;

export const RESOLVED_HOLD_MS = 3000;
export const RESOLVED_HOLD_QUEUED_MS = 1500;
export const RESOLVED_HOLD_TRIVIAL_MS = 320;
export const RESOLVED_HOLD_TRIVIAL_QUEUED_MS = 160;
export const DOCK_COLLAPSE_MS = 400; // Calmer transition - was 180, increased for deliberate feel

/** Per-entry derived state — each active stage claim owns this shape. */
export interface StageEntryDerived {
  claimKey: string;
  checkingClaim: PendingClaimPreview | null;
  resolvedCard: SourceCard | null;
  isDocking: boolean;
}

const isSpecialStatus = (status: AnalysisStatus) =>
  status === 'loading' || status === 'no-transcript' || status === 'error';

const isPlaybackActive = (playbackState?: PlaybackState | null) =>
  Boolean(playbackState && !playbackState.paused);

export const getClaimKey = (claim: Pick<PendingClaimPreview, 'claimText' | 'timestampSeconds'>) =>
  `${claim.timestampSeconds}:${claim.claimText.trim().toLowerCase()}`;

export const getCardClaimKey = (card: SourceCard) => getClaimKey(card.claim);

export const buildLiveStripCopy = ({
  status,
  livePhase,
  anchorTime,
  isDocking,
}: {
  status: AnalysisStatus;
  livePhase: LivePhase;
  anchorTime: number | null;
  isDocking?: boolean;
}) => {
  if (status === 'loading') return 'Loading transcript';
  if (status === 'no-transcript' || status === 'error') return null;
  if (isDocking) return null;

  switch (livePhase) {
    case 'reading':
      return 'Listening';
    case 'checking':
      return anchorTime !== null ? `Checking claim at ${formatTime(anchorTime)}` : 'Checking';
    case 'resolved':
      return null;
    case 'idle':
    default:
      return 'Caught up';
  }
};

export const deriveReadingVariant = ({
  status,
  playbackState,
  currentScanPreview,
  currentScanActionState,
  lastScannedTimestamp,
}: {
  status: AnalysisStatus;
  playbackState?: PlaybackState | null;
  currentScanPreview?: string | null;
  currentScanActionState?: ExtractionActionState | null;
  lastScannedTimestamp?: number | null;
}): ReadingVariant => {
  void lastScannedTimestamp;
  const trimmedPreview = currentScanPreview?.trim() ?? '';
  const hasPlayback = isPlaybackActive(playbackState);
  const hasAmbientSignal =
    !isSpecialStatus(status) &&
    (hasPlayback || trimmedPreview.length > 0 || currentScanActionState !== null);

  if (!hasAmbientSignal) return null;
  return trimmedPreview.length > 0 ? 'preview' : 'quiet';
};

export const resolveLivePhase = ({
  hasCheckingClaim,
  hasResolvedCard,
  readingVariant,
}: {
  hasCheckingClaim: boolean;
  hasResolvedCard: boolean;
  readingVariant: ReadingVariant;
}): LivePhase => {
  if (hasResolvedCard) return 'resolved';
  if (hasCheckingClaim) return 'checking';
  if (readingVariant) return 'reading';
  return 'idle';
};

interface UseLiveStageFlowInput {
  activeTab: 'live' | 'history';
  currentVideoId?: string | null;
  status: AnalysisStatus;
  playbackState?: PlaybackState | null;
  cards: SourceCard[];
  pendingClaims: PendingClaimPreview[];
  currentScanPreview?: string | null;
  currentScanEntities?: string[];
  currentScanActionState?: ExtractionActionState | null;
  currentScanReason?: string | null;
  lastScannedTimestamp?: number | null;
}

interface UseLiveStageFlowResult {
  livePhase: LivePhase;
  readingVariant: ReadingVariant;
  stageEntries: StageEntryDerived[];
  dockedKeys: ReadonlySet<string>;
  recentChecks: SourceCard[];
  queuedCount: number;
  readingPreview: string | null;
  readingTimestamp: number | null;
  headerStripCopy: string | null;
  showLiveCheckLabel: boolean;
  isDocking: boolean;
}

type TimerPair = { hold: ReturnType<typeof setTimeout> | null; collapse: ReturnType<typeof setTimeout> | null };

export const useLiveStageFlow = ({
  activeTab,
  currentVideoId = null,
  status,
  playbackState = null,
  cards,
  pendingClaims,
  currentScanPreview = null,
  currentScanEntities = [],
  currentScanActionState = null,
  currentScanReason = null,
  lastScannedTimestamp = null,
}: UseLiveStageFlowInput): UseLiveStageFlowResult => {
  void currentScanEntities;
  void currentScanReason;

  // Array of up to 2 active claim keys (ordered: primary at [0], secondary at [1])
  const [stageKeys, setStageKeys] = useState<string[]>([]);
  // Keys currently animating their dock transition
  const [dockingKeys, setDockingKeys] = useState<ReadonlySet<string>>(new Set());
  // Keys that have docked (used to skip stack-entry in Recent Checks)
  const [dockedKeys, setDockedKeys] = useState<ReadonlySet<string>>(new Set());
  // Per-claim timer pairs
  const timerMap = useRef<Map<string, TimerPair>>(new Map());

  const clearAllTimers = () => {
    for (const { hold, collapse } of timerMap.current.values()) {
      if (hold) clearTimeout(hold);
      if (collapse) clearTimeout(collapse);
    }
    timerMap.current.clear();
  };

  const clearTimersForKey = (key: string) => {
    const t = timerMap.current.get(key);
    if (!t) return;
    if (t.hold) clearTimeout(t.hold);
    if (t.collapse) clearTimeout(t.collapse);
    timerMap.current.delete(key);
  };

  // Derived entries — each stage key maps to its current claim/card state
  const stageEntries = useMemo((): StageEntryDerived[] =>
    stageKeys.map((key) => ({
      claimKey: key,
      checkingClaim: pendingClaims.find((c) => c.id === key) ?? null,
      resolvedCard: cards.find((c) => getCardClaimKey(c) === key) ?? null,
      isDocking: dockingKeys.has(key),
    })),
    [stageKeys, pendingClaims, cards, dockingKeys],
  );

  // Recent checks excludes keys actively in stage only.
  // Docking keys must remain visible so the shared layoutId has a destination.
  const recentChecks = useMemo(
    () => cards.filter((card) => !stageKeys.includes(getCardClaimKey(card))),
    [cards, stageKeys],
  );

  // Pending claims beyond the 2 visible stage slots
  const queuedCount = useMemo(
    () => pendingClaims.filter((c) => !stageKeys.includes(c.id)).length,
    [pendingClaims, stageKeys],
  );

  // Promote pending claims into stage (max 2 slots)
  useEffect(() => {
    if (activeTab !== 'live') return;
    if (stageKeys.length >= 2) return;
    const next = pendingClaims.find((c) => !stageKeys.includes(c.id));
    if (!next) return;
    setStageKeys((prev) => {
      if (prev.length >= 2 || prev.includes(next.id)) return prev;
      return [...prev, next.id];
    });
  }, [activeTab, pendingClaims, stageKeys]);

  // Resolved → dock timer (per entry, each with its own timer)
  useEffect(() => {
    for (const entry of stageEntries) {
      const { claimKey, resolvedCard, isDocking: entryIsDocking } = entry;
      if (!resolvedCard || entryIsDocking) continue;
      if (timerMap.current.has(claimKey)) continue; // already scheduled

      // Disputed/partial verdicts deserve stage dwell so users can read the nuance.
      // Supported/unverifiable are low-signal — dock them quickly to avoid banner blindness.
      const isTrivial = resolvedCard.status === 'supported' || resolvedCard.status === 'unverifiable';
      const holdMs = isTrivial
        ? (queuedCount > 0 ? RESOLVED_HOLD_TRIVIAL_QUEUED_MS : RESOLVED_HOLD_TRIVIAL_MS)
        : (queuedCount > 0 ? RESOLVED_HOLD_QUEUED_MS : RESOLVED_HOLD_MS);

      const holdTimer = setTimeout(() => {
        setStageKeys((prev) => prev.filter((k) => k !== claimKey));
        setDockingKeys((prev) => new Set([...prev, claimKey]));
        setDockedKeys((prev) => new Set([...prev, claimKey]));

        const collapseTimer = setTimeout(() => {
          setDockingKeys((prev) => { const s = new Set(prev); s.delete(claimKey); return s; });
          setDockedKeys((prev) => { const s = new Set(prev); s.delete(claimKey); return s; });
          timerMap.current.delete(claimKey);
        }, DOCK_COLLAPSE_MS);

        timerMap.current.set(claimKey, { hold: null, collapse: collapseTimer });
      }, holdMs);

      timerMap.current.set(claimKey, { hold: holdTimer, collapse: null });
    }
  }, [stageEntries, queuedCount]);

  // Drop stale stage keys (claim vanished from both pending and cards)
  // Also clear any pending timers for dropped keys so they can't fire against a non-existent destination
  useEffect(() => {
    if (stageKeys.length === 0) return;
    const isAlive = (key: string) =>
      pendingClaims.some((c) => c.id === key) || cards.some((c) => getCardClaimKey(c) === key);
    const dropped = stageKeys.filter((key) => !isAlive(key));
    if (dropped.length === 0) return;
    dropped.forEach(clearTimersForKey);
    setStageKeys((prev) => prev.filter(isAlive));
  }, [pendingClaims, cards, stageKeys]);

  // Clear everything on video change
  useEffect(() => {
    clearAllTimers();
    setStageKeys([]);
    setDockingKeys(new Set());
    setDockedKeys(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideoId]);

  // Clear timers and docking state when leaving live tab to prevent permanent docking lock
  useEffect(() => {
    if (activeTab === 'live') return;
    clearAllTimers();
    setDockingKeys(new Set());
    setDockedKeys(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { clearAllTimers(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trimmedPreview = currentScanPreview?.trim() ?? '';
  const readingVariant = deriveReadingVariant({
    status,
    playbackState,
    currentScanPreview: trimmedPreview,
    currentScanActionState,
    lastScannedTimestamp,
  });

  // livePhase and header copy are driven by the primary (first) entry
  const primaryEntry = stageEntries[0] ?? null;
  const livePhase = resolveLivePhase({
    hasCheckingClaim: Boolean(primaryEntry?.checkingClaim),
    hasResolvedCard: Boolean(primaryEntry?.resolvedCard),
    readingVariant,
  });

  const readingTimestamp =
    lastScannedTimestamp ??
    playbackState?.currentTime ??
    null;

  const headerAnchorTime = livePhase === 'checking'
    ? (primaryEntry?.checkingClaim?.timestampSeconds ?? readingTimestamp)
    : readingTimestamp;

  const anyDocking = dockingKeys.size > 0;

  const headerStripCopy = activeTab === 'live'
    ? buildLiveStripCopy({
        status,
        livePhase,
        anchorTime: headerAnchorTime,
        isDocking: anyDocking,
      })
    : null;

  return {
    livePhase,
    readingVariant,
    stageEntries,
    dockedKeys,
    recentChecks,
    queuedCount,
    readingPreview: trimmedPreview || null,
    readingTimestamp,
    headerStripCopy,
    showLiveCheckLabel: stageEntries.length > 0 || anyDocking,
    isDocking: anyDocking,
  };
};
