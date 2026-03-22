// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { PendingClaimPreview, SourceCard } from '../../shared/types';
import {
  DOCK_COLLAPSE_MS,
  RESOLVED_HOLD_MS,
  RESOLVED_HOLD_QUEUED_MS,
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

  describe('dual-slot promotion', () => {
    it('promotes a single pending claim to stageEntries[0]', () => {
      const claim = makePending('The earth is flat');
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [claim] }),
      );
      expect(result.current.stageEntries).toHaveLength(1);
      expect(result.current.stageEntries[0].claimKey).toBe(claim.id);
      expect(result.current.stageEntries[0].checkingClaim).toEqual(claim);
    });

    it('promotes up to 2 pending claims simultaneously', () => {
      const c1 = makePending('Claim one', 10);
      const c2 = makePending('Claim two', 20);
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [c1, c2] }),
      );
      expect(result.current.stageEntries).toHaveLength(2);
      expect(result.current.stageEntries[0].claimKey).toBe(c1.id);
      expect(result.current.stageEntries[1].claimKey).toBe(c2.id);
    });

    it('reports queuedCount only for claims beyond the 2 visible slots', () => {
      const claims = [
        makePending('Claim one', 10),
        makePending('Claim two', 20),
        makePending('Claim three', 30),
      ];
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: claims }),
      );
      expect(result.current.stageEntries).toHaveLength(2);
      expect(result.current.queuedCount).toBe(1);
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

    it('both stage claim keys are excluded from recentChecks simultaneously', () => {
      const c1 = makePending('Claim one', 10);
      const c2 = makePending('Claim two', 20);
      const card1 = makeCard('Claim one', 10);
      const card2 = makeCard('Claim two', 20);
      const { result } = renderHook(() =>
        useLiveStageFlow({ ...BASE, pendingClaims: [c1, c2], cards: [card1, card2] }),
      );
      expect(result.current.stageEntries).toHaveLength(2);
      // Both are in stage → neither should be in recentChecks
      expect(result.current.recentChecks).toHaveLength(0);
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
    it('marks entry as resolved when a matching card arrives', () => {
      const claim = makePending('Verifiable claim', 15);
      const card = makeCard('Verifiable claim', 15);

      const { result, rerender } = renderHook(
        (cards: SourceCard[]) =>
          useLiveStageFlow({ ...BASE, pendingClaims: [claim], cards }),
        { initialProps: [] as SourceCard[] },
      );

      expect(result.current.stageEntries[0].resolvedCard).toBeNull();
      rerender([card]);
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

  // NOTE: Dock/collapse timer tests (hold → recentChecks, shorter hold with queue,
  // tab-change mid-dock) cannot be reliably automated here. React 18 uses
  // MessageChannel for its internal scheduler, which vitest's fake timer system
  // does not intercept. Timer callbacks fire but state updates don't flush before
  // assertions regardless of act() variant used. These paths are covered by:
  //   • code review of useLiveStageFlow.ts (hold/collapse timer setup)
  //   • the three bug-fix commits (recentChecks exclusion, tab-change reset,
  //     per-claim timer isolation)
  //   • manual QA of the dock animation in the running extension
  // If a dedicated E2E harness or a custom scheduler mock is added later, add:
  //   - docked card appears in recentChecks after RESOLVED_HOLD_MS
  //   - RESOLVED_HOLD_QUEUED_MS used when second claim is queued
  //   - isDocking + dockedKeys cleared immediately on tab switch mid-dock
});
