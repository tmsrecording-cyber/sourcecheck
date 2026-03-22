import { describe, expect, it } from 'vitest';

import type { PlaybackState } from '../../shared/types';
import {
  DOCK_COLLAPSE_MS,
  RESOLVED_HOLD_MS,
  RESOLVED_HOLD_QUEUED_MS,
  RESOLVED_HOLD_TRIVIAL_MS,
  RESOLVED_HOLD_TRIVIAL_QUEUED_MS,
  buildLiveStripCopy,
  deriveReadingVariant,
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

  describe('buildLiveStripCopy', () => {
    it('never emits Caught up while reading', () => {
      expect(
        buildLiveStripCopy({
          status: 'ready',
          livePhase: 'reading',
          anchorTime: null,
        }),
      ).toBe('Listening');
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
    expect(RESOLVED_HOLD_MS).toBe(3000);
    expect(RESOLVED_HOLD_QUEUED_MS).toBe(1500);
    expect(RESOLVED_HOLD_TRIVIAL_MS).toBe(320);
    expect(RESOLVED_HOLD_TRIVIAL_QUEUED_MS).toBe(160);
    expect(DOCK_COLLAPSE_MS).toBe(400); // Calmer transition - increased from 180
    // trivial hold must be shorter than full hold in both queue states
    expect(RESOLVED_HOLD_TRIVIAL_MS).toBeLessThan(RESOLVED_HOLD_MS);
    expect(RESOLVED_HOLD_TRIVIAL_QUEUED_MS).toBeLessThan(RESOLVED_HOLD_QUEUED_MS);
  });
});
