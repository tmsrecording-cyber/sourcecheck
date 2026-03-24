import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupSessionAuthEnv, createAuthHeaders, TEST_EXTENSION_ID, mockCryptoSubtle } from './helpers/session';

const mockAskGemini = vi.fn();
const mockGenerateEmbedding = vi.fn();
const mockFindSimilarClaim = vi.fn();
const mockFindRelatedClaims = vi.fn();
const mockUpsertClaimVector = vi.fn();
const mockSearchClaimReviewMatches = vi.fn();

vi.mock('../src/lib/gemini', () => ({
  askGeminiJSONWithSearch: (...args: unknown[]) => mockAskGemini(...args),
  isGeminiError: () => false,
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

vi.mock('../src/lib/vector-store', () => ({
  findSimilarClaim: (...args: unknown[]) => mockFindSimilarClaim(...args),
  findRelatedClaims: (...args: unknown[]) => mockFindRelatedClaims(...args),
  upsertClaimVector: (...args: unknown[]) => mockUpsertClaimVector(...args),
}));

vi.mock('../src/lib/claimreview', () => ({
  searchClaimReviewMatches: (...args: unknown[]) => mockSearchClaimReviewMatches(...args),
  mapClaimReviewRatingToStatus: (rating?: string) => {
    if (!rating) return null;
    if (/false|incorrect|fake/i.test(rating)) return 'disputed';
    if (/true|correct|accurate/i.test(rating)) return 'supported';
    if (/misleading|mixed|half true|partly/i.test(rating)) return 'partial';
    return null;
  },
}));

import { POST } from '../src/app/api/verify-claim/route';
import { resetRecentVerificationCacheForTests } from '../src/lib/recent-verification-cache';
import type { NextRequest } from 'next/server';

async function makeRequest(overrides: Record<string, unknown> = {}) {
  const headers = await createAuthHeaders(TEST_EXTENSION_ID);
  return {
    json: () => Promise.resolve({
      claim: {
        claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
        claimType: 'historical',
        timestampSeconds: 24,
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
      videoId: 'verify-claimreview-test',
      videoTitle: 'Shutdown claims',
      channelName: 'Policy Hour',
      ...overrides,
    }),
    headers: new Headers(headers),
    nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
  } as unknown as NextRequest;
}

describe('verify-claim ClaimReview lane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRecentVerificationCacheForTests();
    setupSessionAuthEnv();
    mockCryptoSubtle();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockFindSimilarClaim.mockResolvedValue(null);
    mockFindRelatedClaims.mockResolvedValue([]);
    mockUpsertClaimVector.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetRecentVerificationCacheForTests();
  });

  it('reuses an exact fresh ClaimReview hit without calling Gemini', async () => {
    mockSearchClaimReviewMatches.mockResolvedValue([
      {
        hit: {
          claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
          reviewPublisher: 'Reuters',
          reviewUrl: 'https://example.com/reuters-fact-check',
          reviewTitle: 'Reuters fact check: DHS shutdown lasted 38 days, not 40',
          reviewDate: '2026-03-23T18:00:00.000Z',
          textualRating: 'False',
        },
        normalizedClaimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
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
    ]);

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(mockAskGemini).not.toHaveBeenCalled();
    expect(json.resolutionPath).toBe('claimreview_match');
    expect(json.matchInfo).toMatchObject({
      origin: 'claimreview',
      matchType: 'exact_truth_conditions',
      reviewPublisher: 'Reuters',
    });
    expect(json.sourceCard.status).toBe('disputed');
    expect(json.sourceCard.sourceTitle).toContain('Reuters fact check');
  });

  it('uses stale ClaimReview results as context only and continues to live verification', async () => {
    vi.setSystemTime(new Date('2026-12-31T12:00:00.000Z'));
    mockSearchClaimReviewMatches.mockResolvedValue([
      {
        hit: {
          claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
          reviewPublisher: 'Reuters',
          reviewUrl: 'https://example.com/reuters-fact-check',
          reviewTitle: 'Reuters fact check: DHS shutdown lasted 38 days, not 40',
          reviewDate: '2026-03-23T18:00:00.000Z',
          textualRating: 'False',
        },
        normalizedClaimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
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
    ]);

    mockAskGemini
      .mockResolvedValueOnce({
        data: {
          status: 'partial',
          sourceTitle: 'Government shutdown archive',
          sourceType: 'official_source',
          nuance: 'Archived summaries vary in how they count the shutdown period.',
          evidenceSnippet: null,
          confidence: 0.66,
        },
        inputTokens: 8,
        outputTokens: 11,
        sources: [{ title: 'Archive', url: 'https://example.com/archive' }],
      })
      .mockResolvedValueOnce({
        data: {
          status: 'disputed',
          sourceTitle: 'Associated Press',
          sourceType: 'news_article',
          nuance: 'Contemporaneous coverage reported 38 days.',
          evidenceSnippet: null,
          confidence: 0.74,
        },
        inputTokens: 8,
        outputTokens: 11,
        sources: [{ title: 'AP', url: 'https://example.com/ap' }],
      });

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(mockAskGemini).toHaveBeenCalledTimes(2);
    expect(json.resolutionPath).toBe('live_grounded');
    expect(json.sourceCard.resolutionPath).toBe('live_grounded');
  });
});
