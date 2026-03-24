// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CardFeed } from '../../src/sidepanel/components/CardFeed';
import type { SourceCard } from '../../shared/types';

const baseCard: SourceCard = {
  id: 'handoff-card-1',
  claim: {
    id: 'handoff-claim-1',
    claimText: 'The Department of Homeland Security has been in a funding shutdown for 40 days.',
    claimType: 'historical_event',
    timestampSeconds: 24,
    confidence: 0.82,
  },
  status: 'disputed',
  sourceTitle: 'DHS funding talks in limbo',
  sourceUrl: 'https://example.com/dhs',
  sourceType: 'news_article',
  nuance: 'The shutdown was 38 days on March 23, not 40.',
  timestampSeconds: 24,
  verifiedAt: '2026-03-20T18:00:00.000Z',
};

const filingClaimKey = '24:the department of homeland security has been in a funding shutdown for 40 days.';

afterEach(() => {
  cleanup();
});

describe('CardFeed handoff visuals', () => {
  it('renders a ghost and landing shelf when filing into an empty recent stack', async () => {
    render(
      <CardFeed
        cards={[]}
        allCards={[]}
        recentChecks={[]}
        status="ready"
        livePhase="idle"
        heroVisualState="filing"
        filingClaimKey={filingClaimKey}
        filingCard={baseCard}
        isFiling
        activeTab="live"
      />,
    );

    expect(screen.getByTestId('recent-landing-shelf')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId('handoff-ghost')).toBeTruthy();
    });
  });

  it('marks the receiving recent card without promoting it to primary emphasis', async () => {
    const { container } = render(
      <CardFeed
        cards={[baseCard]}
        allCards={[baseCard]}
        recentChecks={[baseCard]}
        status="ready"
        livePhase="reading"
        heroVisualState="filing"
        filingClaimKey={filingClaimKey}
        filingCard={baseCard}
        isFiling
        activeTab="live"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('handoff-ghost')).toBeTruthy();
    });

    const receivingTarget = container.querySelector('[data-receiving-target="true"]');
    expect(receivingTarget).toBeTruthy();

    const receivingCard = container.querySelector('[data-surface-mode="receiving"]');
    expect(receivingCard).toBeTruthy();
    expect(receivingCard?.getAttribute('data-emphasis')).toBe('secondary');

    const ghost = screen.getByTestId('handoff-ghost');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
  });
});
