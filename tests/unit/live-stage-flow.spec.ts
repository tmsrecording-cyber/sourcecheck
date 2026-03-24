import { describe, expect, it } from 'vitest';

import type { PlaybackState } from '../../shared/types';
import {
  CHECKING_HOLD_MS,
  DOCK_COLLAPSE_MS,
  FILING_GHOST_MS,
  FILING_HERO_FADE_MS,
  FILING_STACK_SETTLE_MS,
  RESOLVED_HOLD_MS,
  RESOLVED_HOLD_QUEUED_MS,
  RESOLVED_HOLD_TRIVIAL_MS,
  RESOLVED_HOLD_TRIVIAL_QUEUED_MS,
  buildLiveStripCopy,
  canPromoteQueuedClaim,
  deriveReadingVariant,
  resolveHeroVisualState,
  resolveLivePhase,
} from '../../src/sidepanel/hooks/useLiveStageFlow';

const activePlayback: PlaybackState = {
  currentTime: 42,
  duration: 300,
  paused: false,
};

describe('useLiveStageFlow helpers', () => {
  describe('deriveReadingVariant', () => {
    it('returns preview when active playback has scan text', () => {
      expect(
        deriveReadingVariant({
          status: 'monitoring',
          playbackState: activePlayback,
          currentScanPreview: 'The speaker is describing an active claim.',
          currentScanActionState: null,
          lastScannedTimestamp: 42,
        }),
      ).toBe('preview');
    });

    it('returns quiet when playback is active but no preview text is available', () => {
      expect(
        deriveReadingVariant({
          status: 'ready',
          playbackState: activePlayback,
          currentScanPreview: null,
          currentScanActionState: null,
          lastScannedTimestamp: null,
        }),
      ).toBe('quiet');
    });

    it('returns null for idle playback without ambient signal', () => {
      expect(
        deriveReadingVariant({
          status: 'idle',
          playbackState: { ...activePlayback, paused: true },
          currentScanPreview: null,
          currentScanActionState: null,
          lastScannedTimestamp: null,
        }),
      ).toBeNull();
    });

    it('returns null when paused even if a prior scan timestamp exists', () => {
      expect(
        deriveReadingVariant({
          status: 'ready',
          playbackState: { ...activePlayback, paused: true },
          currentScanPreview: null,
          currentScanActionState: null,
          lastScannedTimestamp: 120,
        }),
      ).toBeNull();
    });
  });

  describe('resolveLivePhase', () => {
    it('prefers resolved over reading', () => {
      expect(
        resolveLivePhase({
          hasCheckingClaim: false,
          hasResolvedCard: true,
          readingVariant: 'preview',
        }),
      ).toBe('resolved');
    });

    it('prefers checking over reading', () => {
      expect(
        resolveLivePhase({
          hasCheckingClaim: true,
          hasResolvedCard: false,
          readingVariant: 'preview',
        }),
      ).toBe('checking');
    });

    it('falls back to reading when no active claim exists', () => {
      expect(
        resolveLivePhase({
          hasCheckingClaim: false,
          hasResolvedCard: false,
          readingVariant: 'quiet',
        }),
      ).toBe('reading');
    });
  });

  describe('visual phase helpers', () => {
    it('reports filing as the dominant hero visual state', () => {
      expect(
        resolveHeroVisualState({
          isFiling: true,
          livePhase: 'reading',
        }),
      ).toBe('filing');
    });

    it('blocks queued-claim promotion while filing is active', () => {
      expect(
        canPromoteQueuedClaim({
          activeTab: 'live',
          stageCount: 0,
          isDocking: false,
          isFiling: true,
        }),
      ).toBe(false);
    });
  });

  describe('buildLiveStripCopy', () => {
    it('suppresses header state copy while the live card is active', () => {
      expect(
        buildLiveStripCopy({
          status: 'ready',
          livePhase: 'reading',
          anchorTime: null,
        }),
      ).toBeNull();

      expect(
        buildLiveStripCopy({
          status: 'verifying',
          livePhase: 'checking',
          anchorTime: 42,
        }),
      ).toBeNull();
    });

    it('returns null during resolved docking', () => {
      expect(
        buildLiveStripCopy({
          status: 'ready',
          livePhase: 'resolved',
          anchorTime: 42,
          isDocking: true,
        }),
      ).toBeNull();
    });
  });

  it('documents the live-flow timing contract', () => {
    expect(CHECKING_HOLD_MS).toBe(1200);
    expect(RESOLVED_HOLD_MS).toBe(3000);
    expect(RESOLVED_HOLD_QUEUED_MS).toBe(1500);
    expect(RESOLVED_HOLD_TRIVIAL_MS).toBe(900);
    expect(RESOLVED_HOLD_TRIVIAL_QUEUED_MS).toBe(550);
    expect(FILING_GHOST_MS).toBe(360);
    expect(FILING_HERO_FADE_MS).toBe(220);
    expect(FILING_STACK_SETTLE_MS).toBe(240);
    expect(DOCK_COLLAPSE_MS).toBe(360); // filing duration now defines the full handoff window
    // trivial hold must be shorter than full hold in both queue states
    expect(RESOLVED_HOLD_TRIVIAL_MS).toBeLessThan(RESOLVED_HOLD_MS);
    expect(RESOLVED_HOLD_TRIVIAL_QUEUED_MS).toBeLessThan(RESOLVED_HOLD_QUEUED_MS);
  });
});
