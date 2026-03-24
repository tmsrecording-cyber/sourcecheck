import { describe, expect, it } from 'vitest';
import type { SourceCard } from '../../shared/types';
import { applyClaimClusterUpdate } from '../../src/background/utils/claimCluster';

const makeCard = (overrides: Partial<SourceCard> = {}): SourceCard => ({
  id: overrides.id || 'card-1',
  claim: {
    claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
    claimType: 'historical',
    timestampSeconds: 24,
    confidence: 0.9,
    normalizedClaimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
    checkworthiness: 0.9,
    normalizationVersion: 1,
    claimFeatures: {
      speaker: null,
      attributedEntity: null,
      subject: 'The Department of Homeland Security',
      predicate: 'was in',
      object: 'a funding shutdown',
      polarity: 'affirmed',
      quantityRaw: '40 days',
      quantityValue: 40,
      quantityUnit: 'days',
      comparisonOperator: 'eq',
      dateOrPeriodRaw: 'March 2026',
      dateOrPeriodNormalized: '2026-march',
      timeSensitivity: 'time_bound',
      location: null,
      topicTags: ['government'],
      attributionType: 'speaker_assertion',
    },
  },
  status: 'disputed',
  sourceTitle: 'Reuters Fact Check',
  sourceUrl: 'https://example.com/reuters',
  sourceType: 'news_article',
  nuance: 'Reuters reports the shutdown lasted 38 days.',
  timestampSeconds: 24,
  verifiedAt: '2026-03-23T18:00:00.000Z',
  ...overrides,
});

describe('claim cluster utility', () => {
  it('suppresses a repeated same-video card when nothing material changed', () => {
    const existing = makeCard();
    const incoming = makeCard({
      id: 'card-2',
      claim: {
        ...existing.claim,
        timestampSeconds: 86,
      },
      timestampSeconds: 86,
      verifiedAt: '2026-03-23T18:02:00.000Z',
    });

    const result = applyClaimClusterUpdate([existing], incoming);

    expect(result.suppressed).toBe(true);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].clusterInfo).toMatchObject({
      sameVideoCount: 2,
      occurrenceCount: 2,
      clusterType: 'same_claim_same_speaker',
    });
  });

  it('keeps a new card when the repeated claim materially changes', () => {
    const existing = makeCard();
    const incoming = makeCard({
      id: 'card-2',
      claim: {
        ...existing.claim,
        timestampSeconds: 86,
      },
      timestampSeconds: 86,
      status: 'supported',
      sourceTitle: 'Congressional Research Service',
      sourceUrl: 'https://example.com/crs',
      nuance: 'Congressional records counted the period differently.',
    });

    const result = applyClaimClusterUpdate([existing], incoming);

    expect(result.suppressed).toBe(false);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].id).toBe('card-2');
    expect(result.cards[0].clusterInfo).toMatchObject({
      sameVideoCount: 2,
      occurrenceCount: 2,
    });
  });
});
