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

const linkedCard: SourceCard = {
  ...baseCard,
  id: 'card-3',
  sourceTitle: 'Federal Register',
  sourceUrl: 'https://www.federalregister.gov/example',
};

const evidenceCard: SourceCard = {
  ...linkedCard,
  id: 'card-4',
  evidenceSnippet: 'The Federal Register confirms records retention requirements for official communications.',
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
    // 'Needs primary source' is a backend placeholder — filtered out; compact fallback shows claim text
    expect(html).toContain('Federal Records Act');
    expect(html).toContain('Unverifiable');
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

  it('renders source titles as external links when a source URL is available', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={linkedCard.timestampSeconds}
        card={linkedCard}
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={linkedCard.timestampSeconds}
        card={linkedCard}
      />,
    );

    expect(heroHtml).toContain('feed-card-source-link');
    expect(heroHtml).toContain('href="https://www.federalregister.gov/example"');
    expect(heroHtml).toContain('target="_blank"');
    expect(heroHtml).toContain('noopener noreferrer');
    expect(heroHtml).toContain('↗');

    expect(compactHtml).toContain('compact-expanded-source-link');
    expect(compactHtml).toContain('href="https://www.federalregister.gov/example"');
    expect(compactHtml).toContain('↗');
  });

  it('surfaces evidence snippets in hero and expanded compact cards', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={evidenceCard.timestampSeconds}
        card={evidenceCard}
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={evidenceCard.timestampSeconds}
        card={evidenceCard}
      />,
    );

    expect(heroHtml).toContain('feed-card-evidence-kicker');
    expect(heroHtml).toContain('Evidence');
    expect(heroHtml).toContain('records retention requirements');

    expect(compactHtml).toContain('compact-expanded-evidence');
    expect(compactHtml).toContain('records retention requirements');
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
    const card2 = { ...baseCard, id: 'card-2', timestampSeconds: 120 };

    // With only 1 card (hero) + ambient scan card and no older cards, the tail
    // is suppressed to avoid dead space below the ambient scanning card.
    const liveNoOlderCardsHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard]}
        pendingClaims={[]}
        status="ready"
        activeTab="live"
      />,
    );
    expect(liveNoOlderCardsHtml).not.toContain('feed-stack-tail');
    // Ambient scanning card should appear instead
    expect(liveNoOlderCardsHtml).toContain('feed-card-scanning');

    // With older cards present the tail reappears to hint at depth.
    const liveWithOlderCardsHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard, card2]}
        pendingClaims={[]}
        status="ready"
        activeTab="live"
      />,
    );
    expect(liveWithOlderCardsHtml).toContain('feed-stack-tail');

    // History never shows the stack tail.
    const historyHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard]}
        allCards={[baseCard]}
        pendingClaims={[]}
        status="ready"
        activeTab="history"
      />,
    );
    expect(historyHtml).not.toContain('feed-stack-tail');
  });
});
