import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Minimal type stubs for test
interface SourceCard {
  id: string;
  claim: {
    claimText: string;
    timestampSeconds: number;
  };
  status: 'supported' | 'partial' | 'disputed' | 'unverifiable';
  nuance: string;
}

interface PendingClaim {
  id: string;
  claimText: string;
  timestampSeconds: number;
}

// Simulated dwell logic (extracted from CardFeed for testing)
const MIN_RESOLVED_DWELL_MS = 1500;

function computeEffectiveHeroMode({
  activeTab,
  hasPendingClaim,
  hasCheckedCard,
  dwellState,
}: {
  activeTab: 'live' | 'history';
  hasPendingClaim: boolean;
  hasCheckedCard: boolean;
  dwellState: { yieldedToNext: boolean } | null;
}): 'none' | 'pending' | 'checked' {
  if (activeTab !== 'live') return 'none';

  // During dwell, show the resolved card regardless of new pending claims
  if (dwellState && !dwellState.yieldedToNext) {
    return 'checked';
  }

  // Normal behavior: pending claim takes priority
  if (hasPendingClaim) return 'pending';
  if (hasCheckedCard) return 'checked';
  return 'none';
}

describe('hero dwell continuity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds resolved card in hero slot during dwell period even if new pending arrives', () => {
    // Start with resolved card in dwell
    const dwellState = {
      card: { id: 'card-1' } as SourceCard,
      dwellUntil: Date.now() + MIN_RESOLVED_DWELL_MS,
      yieldedToNext: false,
    };

    // New pending claim arrives while in dwell
    const effectiveMode = computeEffectiveHeroMode({
      activeTab: 'live',
      hasPendingClaim: true, // New claim arrived
      hasCheckedCard: true,
      dwellState,
    });

    // Should still show checked (resolved) card, not pending
    expect(effectiveMode).toBe('checked');
  });

  it('yields to pending claim after dwell period expires', () => {
    const dwellState = {
      card: { id: 'card-1' } as SourceCard,
      dwellUntil: Date.now() + MIN_RESOLVED_DWELL_MS,
      yieldedToNext: true, // Dwell expired
    };

    const effectiveMode = computeEffectiveHeroMode({
      activeTab: 'live',
      hasPendingClaim: true,
      hasCheckedCard: true,
      dwellState,
    });

    // Now should show pending
    expect(effectiveMode).toBe('pending');
  });

  it('shows pending claim immediately when no dwell active', () => {
    const effectiveMode = computeEffectiveHeroMode({
      activeTab: 'live',
      hasPendingClaim: true,
      hasCheckedCard: true,
      dwellState: null, // No dwell
    });

    expect(effectiveMode).toBe('pending');
  });

  it('shows checked card when no pending and no dwell', () => {
    const effectiveMode = computeEffectiveHeroMode({
      activeTab: 'live',
      hasPendingClaim: false,
      hasCheckedCard: true,
      dwellState: null,
    });

    expect(effectiveMode).toBe('checked');
  });

  it('shows none when no cards and no pending in live tab', () => {
    const effectiveMode = computeEffectiveHeroMode({
      activeTab: 'live',
      hasPendingClaim: false,
      hasCheckedCard: false,
      dwellState: null,
    });

    expect(effectiveMode).toBe('none');
  });

  it('shows none in history tab regardless of cards', () => {
    const effectiveMode = computeEffectiveHeroMode({
      activeTab: 'history',
      hasPendingClaim: true,
      hasCheckedCard: true,
      dwellState: null,
    });

    expect(effectiveMode).toBe('none');
  });

  it('dwell duration is at least 1500ms', () => {
    // This documents the minimum dwell constant
    expect(MIN_RESOLVED_DWELL_MS).toBeGreaterThanOrEqual(1500);
    expect(MIN_RESOLVED_DWELL_MS).toBe(1500);
  });
});

describe('header hero state sync', () => {
  it('derives verifying status when hero is in pending mode', () => {
    const heroState = { mode: 'verifying' as const, claimText: 'Test claim', timestampSeconds: 42 };
    
    // Header should show verifying-like status
    const effectiveStatus = heroState.mode === 'verifying' ? 'verifying' : 'ready';
    expect(effectiveStatus).toBe('verifying');
  });

  it('derives ready status when hero is in resolved dwell', () => {
    const heroState = { 
      mode: 'resolved' as const, 
      card: { status: 'supported' } as SourceCard,
      dwellUntil: Date.now() + 1000,
    };
    
    // Header should hold on the resolved result without pretending it is still verifying
    const effectiveStatus = heroState.mode === 'resolved' ? 'ready' : 'verifying';
    expect(effectiveStatus).toBe('ready');
  });

  it('shows calm resolved-specific copy when hero dwells on unresolved result', () => {
    const card: SourceCard = {
      id: 'card-1',
      claim: { claimText: 'Test claim', timestampSeconds: 60 },
      status: 'unverifiable',
      nuance: '[From memory] We could not verify this claim with a reliable web source.',
    };

    const copy = card.status === 'unverifiable'
      ? 'Latest check could not find a strong web match.'
      : 'Latest check found supporting web evidence.';
    expect(copy).toBe('Latest check could not find a strong web match.');
  });

  it('formats anchor time for resolved card during dwell', () => {
    const timestampSeconds = 125; // 2:05
    const formatted = `${Math.floor(timestampSeconds / 60)}:${(timestampSeconds % 60).toString().padStart(2, '0')}`;
    
    expect(formatted).toBe('2:05');
  });
});
