import { describe, expect, it } from 'vitest';

import { resolvePromotedLiveLayout } from '../../src/sidepanel/components/CardFeed';

describe('promoted live layout', () => {
  it('gives the hero slot to the active pending claim in live mode', () => {
    expect(
      resolvePromotedLiveLayout({
        activeTab: 'live',
        hasCheckedCard: true,
        hasPendingClaim: true,
      }),
    ).toEqual({
      heroMode: 'pending',
      olderCardsStartIndex: 0,
    });
  });

  it('keeps the latest checked card in the hero slot when there is no pending claim', () => {
    expect(
      resolvePromotedLiveLayout({
        activeTab: 'live',
        hasCheckedCard: true,
        hasPendingClaim: false,
      }),
    ).toEqual({
      heroMode: 'checked',
      olderCardsStartIndex: 1,
    });
  });

  it('does not promote a live hero slot in history mode', () => {
    expect(
      resolvePromotedLiveLayout({
        activeTab: 'history',
        hasCheckedCard: true,
        hasPendingClaim: true,
      }),
    ).toEqual({
      heroMode: 'none',
      olderCardsStartIndex: 0,
    });
  });
});
