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
  it('renders compact cards with reasoning and source visible', () => {
    const html = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={baseCard.timestampSeconds}
        card={baseCard}
      />,
    );

    expect(html).toContain('feed-card-compact');
    // Reasoning text element is always present
    expect(html).toContain('compact-reasoning-text');
    // Boilerplate nuance ("This likely needs a paper...") falls back to the actual claim text
    expect(html).toContain('Federal Records Act');
    expect(html).toContain('Cannot verify');
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

    // Compact card now shows source always visible (not just expanded), with compact-source-link class
    expect(compactHtml).toContain('compact-source-link');
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

  it('live feed renders the quiet reading strip above recent checks', () => {
    const html = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard]}
        allCards={[baseCard]}
        recentChecks={[baseCard]}
        status="monitoring"
        livePhase="reading"
        readingVariant="preview"
        readingPreview="A pending claim being verified"
        readingTimestamp={100}
        activeTab="live"
      />,
    );
    expect(html).toContain('feed-card-scanning');
    // Scanning card contains pulse bar activity visualization
    expect(html).toContain('scan-pulse-bar');
    expect(html).toContain('scan-pulse-segment');
    // preview text is intentionally suppressed in ambient reading mode (teleprompter fix)
    expect(html).not.toContain('A pending claim being verified');
    expect(html).toContain('feed-card-compact');
    expect(html).not.toContain('feed-card-hero');
  });

  it('resolved cards appear in both live and history tabs', () => {
    const card2 = { ...baseCard, id: 'card-2', timestampSeconds: 120 };

    // Live tab shows resolved cards as compact — nothing vanishes
    const liveHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard, card2]}
        allCards={[baseCard, card2]}
        recentChecks={[baseCard, card2]}
        status="ready"
        activeTab="live"
      />,
    );
    expect(liveHtml).toContain('feed-card-compact');

    // History tab shows the same cards
    const historyHtml = renderToStaticMarkup(
      <CardFeed
        cards={[baseCard, card2]}
        allCards={[baseCard, card2]}
        status="ready"
        activeTab="history"
      />,
    );
    expect(historyHtml).toContain('feed-card-compact');
  });
});
