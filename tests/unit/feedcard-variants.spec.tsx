import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CardFeed } from '../../src/sidepanel/components/CardFeed';
import { FeedCard } from '../../src/sidepanel/components/FeedCard';
import type { SourceCard } from '../../shared/types';
import type { StageEntryDerived } from '../../src/sidepanel/hooks/useLiveStageFlow';

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
  resolutionPath: 'cached_exact',
  matchInfo: {
    origin: 'internal_memory',
    matchType: 'exact_truth_conditions',
    confidence: 0.97,
    canonicalClaimText: 'The Federal Records Act governs the preservation of official government communications.',
    freshnessClass: 'fresh',
  },
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

const supportedCard: SourceCard = {
  ...linkedCard,
  id: 'card-5',
  status: 'supported',
};

const sameVideoCard: SourceCard = {
  ...baseCard,
  id: 'card-6',
  clusterInfo: {
    clusterId: 'cluster-1',
    occurrenceCount: 2,
    sameVideoCount: 2,
    lastSeenTimestampSeconds: 144,
    clusterType: 'same_claim_same_speaker',
  },
};

const claimReviewCard: SourceCard = {
  ...supportedCard,
  id: 'card-7',
  sourceTitle: 'Reuters',
  sourceUrl: 'https://www.reuters.com/fact-check/example',
  resolutionPath: 'claimreview_match',
  matchInfo: {
    origin: 'claimreview',
    matchType: 'exact_truth_conditions',
    confidence: 0.96,
    canonicalClaimText: 'The Federal Records Act governs the preservation of official government communications.',
    reviewPublisher: 'Reuters',
    reviewDate: '2026-03-21T18:00:00.000Z',
    freshnessClass: 'fresh',
  },
};

const relatedClaimCard: SourceCard = {
  ...supportedCard,
  id: 'card-8',
  resolutionPath: 'live_grounded',
  similarClaims: [
    {
      id: 'similar-3',
      claimText: 'The Federal Records Act governs official communications.',
      status: 'supported',
      videoTitle: 'Presidential records explainer',
      videoId: 'abc123',
      timestampSeconds: 88,
      similarity: 0.96,
    },
  ],
  relatedClaimIds: ['similar-3'],
};

const liveVerifiedCard: SourceCard = {
  ...supportedCard,
  id: 'card-9',
  resolutionPath: 'live_grounded',
  similarClaims: [],
};

const buildStageEntry = (overrides: Partial<StageEntryDerived>): StageEntryDerived => ({
  claimKey: 'stage-1',
  checkingClaim: null,
  resolvedCard: null,
  isDocking: false,
  ...overrides,
});

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
    // For unverifiable cards, the nuance IS the useful context — shown as-is, no boilerplate filter
    expect(html).toContain('This likely needs a paper');
    expect(html).toContain('Cannot verify');
  });

  it('renders a cleaner verifying row without internal phase copy or claim-type duplication', () => {
    const html = renderToStaticMarkup(
      <FeedCard
        size="verifying"
        timestampSeconds={45}
        claimText="The Department of Homeland Security has been in a funding shutdown for 40 days."
      />,
    );

    expect(html).toContain('Verifying');
    expect(html).toContain('for');
    expect(html).toContain('against');
    expect(html).not.toContain('merging');
    expect(html).not.toContain('checking');
    expect(html).not.toContain('Historical claim');
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

  it('labels same-video memory as earlier in this video instead of seen before', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={sameVideoCard.timestampSeconds}
        card={sameVideoCard}
        currentVideoId="current-video"
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={sameVideoCard.timestampSeconds}
        card={sameVideoCard}
        currentVideoId="current-video"
      />,
    );

    expect(compactHtml).toContain('Earlier in this video');
    expect(compactHtml).toContain('2:24');
    expect(compactHtml).toContain('2 occurrences');
    expect(compactHtml).not.toContain('Seen before');
    expect(heroHtml).toContain('Earlier in this video');
    expect(heroHtml).not.toContain('Seen before');
  });

  it('surfaces previously fact-checked provenance for ClaimReview-backed cards', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={claimReviewCard.timestampSeconds}
        card={claimReviewCard}
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={claimReviewCard.timestampSeconds}
        card={claimReviewCard}
      />,
    );

    expect(compactHtml).toContain('Previously fact-checked');
    expect(compactHtml).toContain('Reuters');
    expect(compactHtml).toContain('Mar 21, 2026');
    expect(heroHtml).toContain('Previously fact-checked');
    expect(heroHtml).toContain('Reuters');
    expect(heroHtml).toContain('Mar 21, 2026');
  });

  it('shows related-claim context for fresh live verification without implying direct reuse', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={relatedClaimCard.timestampSeconds}
        card={relatedClaimCard}
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={relatedClaimCard.timestampSeconds}
        card={relatedClaimCard}
      />,
    );

    expect(compactHtml).toContain('Related claim');
    expect(compactHtml).toContain('Presidential records explainer');
    expect(compactHtml).not.toContain('Seen before');
    expect(heroHtml).toContain('Related claim');
    expect(heroHtml).toContain('Presidential records explainer');
    expect(heroHtml).not.toContain('Seen before');
  });

  it('shows verified-live provenance when no prior match informed the card', () => {
    const compactHtml = renderToStaticMarkup(
      <FeedCard
        size="compact"
        timestampSeconds={liveVerifiedCard.timestampSeconds}
        card={liveVerifiedCard}
        isExpanded
      />,
    );
    const heroHtml = renderToStaticMarkup(
      <FeedCard
        size="hero"
        timestampSeconds={liveVerifiedCard.timestampSeconds}
        card={liveVerifiedCard}
      />,
    );

    expect(compactHtml).toContain('Verified live: Grounded against live web sources.');
    expect(compactHtml).not.toContain('compact-memory-chip');
    expect(heroHtml).toContain('Verified live');
    expect(heroHtml).toContain('Grounded against live web sources.');
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

    // Compact card shows source as chip pill (B1 redesign)
    expect(compactHtml).toContain('compact-source-chip-link');
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
    // preview text shown in scanning card so user sees what's being read
    expect(html).toContain('A pending claim being verified');
    expect(html).toContain('Recent checks');
    expect(html).toContain('feed-card-compact');
    expect(html).not.toContain('feed-card-hero');
  });

  it('keeps recent checks visible across live phases and leaves history unchanged', () => {
    const listeningHtml = renderToStaticMarkup(
      <CardFeed
        cards={[supportedCard]}
        allCards={[supportedCard]}
        recentChecks={[supportedCard]}
        status="monitoring"
        livePhase="reading"
        readingVariant="quiet"
        activeTab="live"
      />,
    );
    expect(listeningHtml).toContain('Recent checks');
    expect(listeningHtml).toContain('feed-card-compact');

    const checkingHtml = renderToStaticMarkup(
      <CardFeed
        cards={[supportedCard]}
        allCards={[supportedCard]}
        recentChecks={[supportedCard]}
        status="monitoring"
        livePhase="checking"
        stageEntries={[
          buildStageEntry({
            claimKey: 'pending-1',
            checkingClaim: {
              id: 'pending-1',
              claimText: 'President Trump rejected a plan to fund DHS except ICE.',
              claimType: 'historical_event',
              timestampSeconds: 45,
              sourceExcerpt: null,
            },
          }),
        ]}
        activeTab="live"
      />,
    );
    expect(checkingHtml).toContain('Recent checks');
    expect(checkingHtml).toContain('feed-card-compact');
    expect(checkingHtml).toContain('data-emphasis="secondary"');

    const previousCheck = { ...supportedCard, id: 'card-6', claim: { ...supportedCard.claim, id: 'claim-6', claimText: 'Existing recent check', timestampSeconds: 12 }, timestampSeconds: 12 };
    const resolvedHtml = renderToStaticMarkup(
      <CardFeed
        cards={[supportedCard, previousCheck]}
        allCards={[supportedCard, previousCheck]}
        recentChecks={[previousCheck]}
        status="ready"
        livePhase="resolved"
        stageEntries={[
          buildStageEntry({
            claimKey: 'resolved-1',
            resolvedCard: supportedCard,
          }),
        ]}
        activeTab="live"
      />,
    );
    expect(resolvedHtml).toContain('Recent checks');
    expect(resolvedHtml).toContain('Existing recent check');
    expect(resolvedHtml).toContain('data-emphasis="secondary"');

    const dockingHtml = renderToStaticMarkup(
      <CardFeed
        cards={[supportedCard, previousCheck]}
        allCards={[supportedCard, previousCheck]}
        recentChecks={[previousCheck]}
        status="ready"
        livePhase="idle"
        stageEntries={[buildStageEntry({ claimKey: 'dock-1', isDocking: true })]}
        dockedKeys={new Set(['dock-1'])}
        activeTab="live"
      />,
    );
    expect(dockingHtml).toContain('Recent checks');
    expect(dockingHtml).toContain('Existing recent check');
    expect(dockingHtml).toContain('data-emphasis="secondary"');

    const historyHtml = renderToStaticMarkup(
      <CardFeed
        cards={[supportedCard]}
        allCards={[supportedCard]}
        status="ready"
        activeTab="history"
      />,
    );
    expect(historyHtml).toContain('Fact checks');
    expect(historyHtml).not.toContain('Recent checks');
  });

  it('keeps the recent stack mounted and marks the receiving card during filing', () => {
    const html = renderToStaticMarkup(
      <CardFeed
        cards={[supportedCard]}
        allCards={[supportedCard]}
        recentChecks={[supportedCard]}
        status="ready"
        livePhase="reading"
        heroVisualState="filing"
        filingClaimKey="233:the federal records act governs the preservation of official government communications."
        filingCard={supportedCard}
        isFiling
        activeTab="live"
      />,
    );

    expect(html).toContain('Recent checks');
    expect(html).toContain('data-visual-mode="receiving"');
    expect(html).toContain('data-surface-mode="receiving"');
  });

  it('renders a landing shelf when filing without an existing recent target', () => {
    const html = renderToStaticMarkup(
      <CardFeed
        cards={[]}
        allCards={[]}
        recentChecks={[]}
        status="ready"
        livePhase="idle"
        heroVisualState="filing"
        filingClaimKey="missing-target"
        filingCard={supportedCard}
        isFiling
        activeTab="live"
      />,
    );

    expect(html).toContain('Recent checks');
    expect(html).toContain('recent-landing-shelf');
  });

  it('resolved cards appear in both live and history tabs', () => {
    // card2 is supported — unverifiable are filtered from History
    const card2 = { ...baseCard, id: 'card-2', status: 'supported' as const, timestampSeconds: 120 };

    // Live tab shows resolved cards as compact (including unverifiable)
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

    // History tab filters out unverifiable, but still shows supported/partial/disputed
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
