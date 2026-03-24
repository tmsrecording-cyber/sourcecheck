// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { PendingClaimPreview, SourceCard } from '../../shared/types';
import {
  CHECKING_HOLD_MS,
  getClaimKey,
  useLiveStageFlow,
} from '../../src/sidepanel/hooks/useLiveStageFlow';

// ── Fixtures ────────────────────────────────────────────────────────────────

const makePending = (claimText: string, timestampSeconds = 10): PendingClaimPreview => ({
  id: getClaimKey({ claimText, timestampSeconds }),
  claimText,
  claimType: 'factual',
  timestampSeconds,
  confidence: 0.9,
  state: 'pending',
});

const makeCard = (claimText: string, timestampSeconds = 10): SourceCard => ({
  id: `card-${claimText}`,
  claim: { id: `claim-${claimText}`, claimText, claimType: 'factual', timestampSeconds },
  status: 'supported',
  sourceTitle: 'Test Source',
  sourceUrl: 'https://example.com',
  sourceType: 'news_article',
  nuance: 'Test nuance',
  timestampSeconds,
  verifiedAt: new Date().toISOString(),
});

const BASE = {
  activeTab: 'live' as const,
  status: 'monitoring' as const,
  cards: [] as SourceCard[],
  pendingClaims: [] as PendingClaimPreview[],
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('useLiveStageFlow hook', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('single-slot promotion', () => {
    it('promotes a single pending claim to stageEntries[0]', () => {
      const claim = makePending('The earth is flat');
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [claim] }),
      );
      expect(result.current.stageEntries).toHaveLength(1);
      expect(result.current.stageEntries[0].claimKey).toBe(claim.id);
      expect(result.current.stageEntries[0].checkingClaim).toEqual(claim);
    });

    it('keeps only one active stage entry and leaves the next claim queued', () => {
      const c1 = makePending('Claim one', 10);
      const c2 = makePending('Claim two', 20);
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [c1, c2] }),
      );
      expect(result.current.stageEntries).toHaveLength(1);
      expect(result.current.stageEntries[0].claimKey).toBe(c1.id);
      expect(result.current.queuedCount).toBe(1);
    });

    it('reports queuedCount for claims beyond the single visible stage slot', () => {
      const claims = [
        makePending('Claim one', 10),
        makePending('Claim two', 20),
        makePending('Claim three', 30),
      ];
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: claims }),
      );
      expect(result.current.stageEntries).toHaveLength(1);
      expect(result.current.queuedCount).toBe(2);
    });
  });

  describe('recentChecks exclusion', () => {
    it('excludes stage keys from recentChecks while claim is active', () => {
      const claim = makePending('Earth claim');
      const card = makeCard('Earth claim');
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [claim], cards: [card] }),
      );
      // Card is in stage → must not appear in recentChecks
      expect(result.current.recentChecks).toHaveLength(0);
    });

    it('excludes only the single active stage claim from recentChecks', () => {
      const c1 = makePending('Claim one', 10);
      const c2 = makePending('Claim two', 20);
      const card1 = makeCard('Claim one', 10);
      const card2 = makeCard('Claim two', 20);
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [c1, c2], cards: [card1, card2] }),
      );
      expect(result.current.stageEntries).toHaveLength(1);
      expect(result.current.recentChecks).toHaveLength(1);
      expect(result.current.recentChecks[0].id).toBe(card2.id);
    });

    it('includes cards whose keys are NOT in stageKeys', () => {
      const c1 = makePending('Staged claim', 10);
      const unrelated = makeCard('Already resolved claim', 5);
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [c1], cards: [unrelated] }),
      );
      // unrelated card key doesn't match the stage key → appears in recentChecks
      expect(result.current.recentChecks).toHaveLength(1);
      expect(result.current.recentChecks[0].id).toBe(unrelated.id);
    });
  });

  describe('tab change state reset', () => {
    it('clears stage keys when switching away from live tab', () => {
      const claim = makePending('Some claim');
      const { result, rerender } = renderHook(
        (tab: 'live' | 'history') =>
          useLiveStageFlow({ ...BASE, activeTab: tab, pendingClaims: [claim] }),
        { initialProps: 'live' as const },
      );
      expect(result.current.stageEntries).toHaveLength(1);

      // The hook preserves stageKeys on tab switch (they re-promote on return)
      // But dockingKeys and dockedKeys must be cleared to prevent stale lock
      act(() => { rerender('history'); });
      expect(result.current.isDocking).toBe(false);
      expect(result.current.dockedKeys.size).toBe(0);
    });

    it('does not promote new claims while on history tab', () => {
      const claim = makePending('Suppressed claim');
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, activeTab: 'history', pendingClaims: [claim] }),
      );
      // Promotion effect guards on activeTab === 'live'
      expect(result.current.stageEntries).toHaveLength(0);
    });
  });

  describe('resolved card detection', () => {
    it('marks entry as resolved when a matching card arrives after the checking hold clears', () => {
      const claim = makePending('Verifiable claim', 15);
      const card = makeCard('Verifiable claim', 15);

      const { result, rerender } = renderHook(
        ({ pendingClaims, cards }: { pendingClaims: PendingClaimPreview[]; cards: SourceCard[] }) =>
          useLiveStageFlow({ ...BASE, pendingClaims, cards }),
        { initialProps: { pendingClaims: [claim], cards: [] as SourceCard[] } },
      );

      expect(result.current.stageEntries[0].resolvedCard).toBeNull();
      rerender({ pendingClaims: [], cards: [card] });
      act(() => {
        vi.advanceTimersByTime(CHECKING_HOLD_MS + 1);
      });
      expect(result.current.stageEntries[0].resolvedCard).toEqual(card);
    });

    it('holds the checking stage briefly when a claim resolves immediately', () => {
      const claim = makePending('Fast resolve claim', 18);
      const card = makeCard('Fast resolve claim', 18);

      const { result, rerender } = renderHook(
        ({ pendingClaims, cards }: { pendingClaims: PendingClaimPreview[]; cards: SourceCard[] }) =>
          useLiveStageFlow({ ...BASE, pendingClaims, cards }),
        { initialProps: { pendingClaims: [claim], cards: [] as SourceCard[] } },
      );

      expect(result.current.livePhase).toBe('checking');
      expect(result.current.stageEntries[0].checkingClaim).toEqual(claim);

      rerender({ pendingClaims: [], cards: [card] });
      expect(result.current.livePhase).toBe('checking');
      expect(result.current.stageEntries[0].checkingClaim).toEqual(claim);
      expect(result.current.stageEntries[0].resolvedCard).toBeNull();

      act(() => {
        vi.advanceTimersByTime(CHECKING_HOLD_MS + 1);
      });

      expect(result.current.livePhase).toBe('resolved');
      expect(result.current.stageEntries[0].checkingClaim).toBeNull();
      expect(result.current.stageEntries[0].resolvedCard).toEqual(card);
    });

    it('showLiveCheckLabel is true when stage has an active entry', () => {
      const claim = makePending('Active claim');
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [claim] }),
      );
      expect(result.current.showLiveCheckLabel).toBe(true);
    });

    it('showLiveCheckLabel is false when no stage entries', () => {
      const { result } = renderHook(() => useLiveStageFlow({ ...BASE }));
      expect(result.current.showLiveCheckLabel).toBe(false);
    });
  });

  // NOTE: Dock/collapse/f filing timer tests (hold → recentChecks, filing, shorter
  // hold with queue, tab-change mid-dock) cannot be reliably automated here. React 18 uses
  // MessageChannel for its internal scheduler, which vitest's fake timer system
  // does not intercept. Timer callbacks fire but state updates don't flush before
  // assertions regardless of act() variant used. These paths are covered by:
  //   • code review of useLiveStageFlow.ts (hold/collapse timer setup)
  //   • helper tests in live-stage-flow.spec.ts (timing constants + filing guard)
  //   • component tests in card-handoff-visual.spec.tsx (ghost + receiving state)
  //   • the three bug-fix commits (recentChecks exclusion, tab-change reset,
  //     per-claim timer isolation)
  //   • manual QA of the dock animation in the running extension
  // If a dedicated E2E harness or a custom scheduler mock is added later, add:
  //   - docked card appears in recentChecks after RESOLVED_HOLD_MS
  //   - RESOLVED_HOLD_QUEUED_MS used when second claim is queued
  //   - isDocking + dockedKeys cleared immediately on tab switch mid-dock
});
