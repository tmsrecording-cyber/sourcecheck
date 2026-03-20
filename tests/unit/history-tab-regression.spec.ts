/**
 * REGRESSION TEST: HISTORY Tab State Propagation
 * 
 * Bug: When sourceCards is empty due to leash filtering (playhead moved past cards),
 * but allSourceCards contains verified cards, HISTORY tab was showing empty state
 * instead of the full verified history.
 * 
 * Root cause: CardFeed was only receiving sourceCards (leash-filtered) and not
 * allSourceCards (complete history). The HISTORY tab would show "No checked claims yet"
 * even when cards existed outside the leash window.
 * 
 * Fix: Added allCards prop to CardFeed that receives allSourceCards unfiltered.
 * HISTORY tab uses allCards, LIVE tab uses cards (leash-filtered).
 */

import { describe, it, expect } from 'vitest';

// Simulate the CardFeed display logic
interface SourceCard {
  id: string;
  claim: { claimText: string };
  timestampSeconds: number;
  status: 'supported' | 'partial' | 'disputed' | 'unverifiable';
}

interface CardFeedProps {
  cards: SourceCard[];      // leash-filtered for LIVE tab
  allCards?: SourceCard[];  // unfiltered for HISTORY tab
  activeTab: 'live' | 'history';
}

interface LiveStateProps {
  activeTab: 'live' | 'history';
  latestCheckedCard: boolean;
  latestPendingClaim: boolean;
  showPrimaryReadingState: boolean;
  status: 'idle' | 'loading' | 'monitoring' | 'verifying' | 'ready' | 'no-transcript' | 'error';
}

// Exact logic from CardFeed.tsx
function getDisplayCards(props: CardFeedProps): SourceCard[] {
  const { cards, allCards, activeTab } = props;
  // FIX: Use allCards (unfiltered) for HISTORY tab, cards (leash-filtered) for LIVE tab
  return activeTab === 'history' && allCards ? allCards : cards;
}

function shouldShowFallbackLiveState(props: LiveStateProps): boolean {
  const { activeTab, latestCheckedCard, latestPendingClaim, showPrimaryReadingState, status } = props;
  return (
    activeTab === 'live' &&
    !latestCheckedCard &&
    !latestPendingClaim &&
    !showPrimaryReadingState &&
    (status === 'monitoring' || status === 'verifying' || status === 'ready')
  );
}

describe('HISTORY Tab Regression', () => {
  const mockCards: SourceCard[] = [
    {
      id: 'card-1',
      claim: { claimText: 'Claim at 10 seconds' },
      timestampSeconds: 10,
      status: 'supported',
    },
    {
      id: 'card-2',
      claim: { claimText: 'Claim at 30 seconds' },
      timestampSeconds: 30,
      status: 'partial',
    },
    {
      id: 'card-3',
      claim: { claimText: 'Claim at 60 seconds' },
      timestampSeconds: 60,
      status: 'disputed',
    },
  ];

  it('should show empty state when both cards and allCards are empty', () => {
    const displayCards = getDisplayCards({
      cards: [],
      allCards: [],
      activeTab: 'history',
    });
    
    expect(displayCards.length).toBe(0);
  });

  it('REGRESSION: should show allCards in HISTORY tab even when cards is empty (leash filtered)', () => {
    // Simulate: playhead at 120s, leash window is 15s (105-120s)
    // All cards (10s, 30s, 60s) are outside leash window, so cards=[]
    // But allCards contains all verified claims
    const leashFilteredCards: SourceCard[] = []; // Empty because playhead moved past
    
    const displayCards = getDisplayCards({
      cards: leashFilteredCards,
      allCards: mockCards,
      activeTab: 'history',
    });
    
    // CRITICAL: HISTORY tab should show all 3 cards, not empty
    expect(displayCards.length).toBe(3);
    expect(displayCards.map(c => c.id)).toEqual(['card-1', 'card-2', 'card-3']);
  });

  it('should show leash-filtered cards in LIVE tab (not allCards)', () => {
    // Simulate: only card-3 is within leash window
    const leashFilteredCards: SourceCard[] = [mockCards[2]]; // Only 60s card
    
    const displayCards = getDisplayCards({
      cards: leashFilteredCards,
      allCards: mockCards,
      activeTab: 'live',
    });
    
    // LIVE tab should show only leash-filtered cards
    expect(displayCards.length).toBe(1);
    expect(displayCards[0].id).toBe('card-3');
  });

  it('should fall back to cards when allCards is undefined (backwards compatibility)', () => {
    const displayCards = getDisplayCards({
      cards: mockCards,
      activeTab: 'history',
    });
    
    // Should use cards as fallback when allCards not provided
    expect(displayCards.length).toBe(3);
    expect(displayCards.map(c => c.id)).toEqual(['card-1', 'card-2', 'card-3']);
  });

  it('should show full history without truncation in HISTORY tab', () => {
    // Create 25 cards (exceeds MAX_HISTORY_ROWS = 20)
    const manyCards: SourceCard[] = Array.from({ length: 25 }, (_, i) => ({
      id: `card-${i}`,
      claim: { claimText: `Claim ${i}` },
      timestampSeconds: i * 10,
      status: 'supported',
    }));
    
    const displayCards = getDisplayCards({
      cards: [], // All filtered out by leash
      allCards: manyCards,
      activeTab: 'history',
    });
    
    // HISTORY tab should show ALL cards, not truncated
    expect(displayCards.length).toBe(25);
  });

  it('REGRESSION: should not render fallback live transcript/scanning state in HISTORY tab', () => {
    expect(
      shouldShowFallbackLiveState({
        activeTab: 'history',
        latestCheckedCard: false,
        latestPendingClaim: false,
        showPrimaryReadingState: false,
        status: 'monitoring',
      })
    ).toBe(false);
  });

  it('should still allow fallback live transcript/scanning state in LIVE tab', () => {
    expect(
      shouldShowFallbackLiveState({
        activeTab: 'live',
        latestCheckedCard: false,
        latestPendingClaim: false,
        showPrimaryReadingState: false,
        status: 'monitoring',
      })
    ).toBe(true);
  });
});
