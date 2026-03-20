import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CardFeed } from '../../src/sidepanel/components/CardFeed';
import { FeedCard } from '../../src/sidepanel/components/FeedCard';
import type { SourceCard } from '../../shared/types';

const baseCard: SourceCard = {
  id: 'card-1',
  claim: {
    id: 'claim-1',
    claimText: 'The Federal Records Act governs the preservation of official government communications.',
    claimType: 'historical_event',
    exactQuote: 'The Federal Records Act governs the preservation of official government communications.',
    timestampSeconds: 233,
    confidence: 0.82,
  },
  status: 'unverifiable',
  sourceTitle: 'Needs primary source',
  sourceUrl: '',
  sourceType: 'official_source',
  nuance: 'This likely needs a paper, dataset, or official record.',
  timestampSeconds: 233,
  verifiedAt: '2026-03-20T18:00:00.000Z',
};

const crossVideoCard: SourceCard = {
  ...baseCard,
  id: 'card-2',
  similarClaims: [
    {
      id: 'similar-1',
      claimText: 'The Federal Records Act governs official communications.',
      status: 'supported',
      videoTitle: 'Presidential records explainer',
      videoId: 'abc123',
      timestampSeconds: 88,
      similarity: 0.96,
    },
  ],
  relatedClaimIds: ['similar-1'],
};

describe('FeedCard variants', () => {
  it('renders compact cards with compressed secondary metadata', () => {
    const html = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={baseCard.timestampSeconds}
        card={baseCard}
      />,
    );

    expect(html).toContain('feed-card-compact');
    expect(html).toContain('compact-secondary-text');
    expect(html).toContain('Needs primary source');
    expect(html).toContain('Needs review');
  });

  it('surfaces seen-before context when cross-video memory is available', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={crossVideoCard.timestampSeconds}
        card={crossVideoCard}
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={crossVideoCard.timestampSeconds}
        card={crossVideoCard}
      />,
    );

    expect(compactHtml).toContain('Seen before');
    expect(compactHtml).toContain('Presidential records explainer');
    expect(heroHtml).toContain('Seen before');
    expect(heroHtml).toContain('Presidential records explainer');
  });

  it('renders state cards through the unified feed-card family', () => {
    const html = renderToStaticMarkup(
      <FeedCard
        size="state"
        timestampSeconds={null}
        badgeLabel="No results yet"
        headline="Nothing checked yet."
        supportLine="Verified claims will appear here as the video plays."
        tone="muted"
      />,
    );

    expect(html).toContain('feed-card-state');
    expect(html).toContain('state-badge');
    expect(html).toContain('Nothing checked yet.');
  });

  it('renders loading placeholders through the unified skeleton variant', () => {
    const html = renderToStaticMarkup(
      <FeedCard
        size="skeleton"
        timestampSeconds={null}
      />,
    );

    expect(html).toContain('feed-card-skeleton');
    expect(html).toContain('feed-card-skeleton-lines');
    expect(html).toContain('class="skeleton');
  });

  it('keeps the passive stack tail scoped to live feed composition', () => {
    const liveHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard]}
        pendingClaims={[]}
        status="ready"
        activeTab="live"
      />,
    );
    const historyHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard]}
        allCards={[baseCard]}
        pendingClaims={[]}
        status="ready"
        activeTab="history"
      />,
    );

    expect(liveHtml).toContain('feed-stack-tail');
    expect(liveHtml).toContain('data-density="hero"');
    expect(historyHtml).not.toContain('feed-stack-tail');
  });
});
