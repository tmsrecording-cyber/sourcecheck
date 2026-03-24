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
      videoId: 'verify-match-gate-test',
      videoTitle: 'Shutdown claims',
      channelName: 'Policy Hour',
      ...overrides,
    }),
    headers: new Headers(headers),
    nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
  } as unknown as NextRequest;
}

function makeStoredClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: 'stored-claim-1',
    score: 0.97,
    metadata: {
      claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
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
      status: 'disputed',
      sourceTitle: 'Reuters Fact Check',
      sourceUrl: 'https://example.com/reuters-dhs',
      sourceType: 'news_article',
      nuance: 'The shutdown was 38 days, not 40.',
      verifiedAt: '2026-03-23T18:00:00.000Z',
      wordingVersion: 1,
      videoTitle: 'Earlier coverage',
      videoId: 'prior-video',
      timestampSeconds: 88,
      ...overrides,
    },
  };
}

describe('verify-claim internal reuse gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRecentVerificationCacheForTests();
    setupSessionAuthEnv();
    mockCryptoSubtle();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockFindSimilarClaim.mockResolvedValue(null);
    mockFindRelatedClaims.mockResolvedValue([]);
    mockUpsertClaimVector.mockResolvedValue(undefined);
    mockSearchClaimReviewMatches.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetRecentVerificationCacheForTests();
  });

  it('reuses an exact fresh canonical match without calling Gemini', async () => {
    mockFindSimilarClaim.mockResolvedValue(makeStoredClaim());

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(mockAskGemini).not.toHaveBeenCalled();
    expect(json.resolutionPath).toBe('cached_exact');
    expect(json.matchInfo).toMatchObject({
      origin: 'internal_memory',
      matchType: 'exact_truth_conditions',
      freshnessClass: 'fresh',
    });
    expect(json.sourceCard.status).toBe('disputed');
    expect(json.sourceCard.resolutionPath).toBe('cached_exact');
  });

  it('blocks reuse on a polarity mismatch and falls through to fresh verification', async () => {
    mockFindSimilarClaim.mockResolvedValue(
      makeStoredClaim({
        claimText: 'The Department of Homeland Security was not in a funding shutdown for 40 days in March 2026.',
        normalizedClaimText: 'The Department of Homeland Security was not in a funding shutdown for 40 days in March 2026.',
        claimFeatures: {
          speaker: null,
          attributedEntity: null,
          subject: 'The Department of Homeland Security',
          predicate: 'was in',
          object: 'a funding shutdown',
          polarity: 'negated',
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
      }),
    );

    mockAskGemini
      .mockResolvedValueOnce({
        data: {
          status: 'supported',
          sourceTitle: 'Congressional Research Service',
          sourceType: 'official_source',
          nuance: 'Congressional records describe the shutdown duration.',
          evidenceSnippet: null,
          confidence: 0.71,
        },
        inputTokens: 10,
        outputTokens: 18,
        sources: [{ title: 'CRS', url: 'https://example.com/crs' }],
      })
      .mockResolvedValueOnce({
        data: {
          status: 'disputed',
          sourceTitle: 'Associated Press',
          sourceType: 'news_article',
          nuance: 'Coverage notes the shutdown lasted 38 days.',
          evidenceSnippet: null,
          confidence: 0.78,
        },
        inputTokens: 11,
        outputTokens: 19,
        sources: [{ title: 'AP', url: 'https://example.com/ap' }],
      });

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(mockAskGemini).toHaveBeenCalledTimes(2);
    expect(json.resolutionPath).toBe('live_grounded');
    expect(json.similarClaims).toBeUndefined();
    expect(json.sourceCard.resolutionPath).toBe('live_grounded');
  });

  it('treats a stale time-bound exact match as context only and continues to live verification', async () => {
    vi.setSystemTime(new Date('2026-12-31T12:00:00.000Z'));
    mockFindSimilarClaim.mockResolvedValue(makeStoredClaim());

    mockAskGemini
      .mockResolvedValueOnce({
        data: {
          status: 'partial',
          sourceTitle: 'Government shutdown history',
          sourceType: 'official_source',
          nuance: 'Historical summaries vary on whether to count weekends.',
          evidenceSnippet: null,
          confidence: 0.68,
        },
        inputTokens: 8,
        outputTokens: 12,
        sources: [{ title: 'Shutdown history', url: 'https://example.com/history' }],
      })
      .mockResolvedValueOnce({
        data: {
          status: 'disputed',
          sourceTitle: 'Fact check archive',
          sourceType: 'news_article',
          nuance: 'Archived coverage still lists the shutdown at 38 days.',
          evidenceSnippet: null,
          confidence: 0.74,
        },
        inputTokens: 8,
        outputTokens: 12,
        sources: [{ title: 'Archive', url: 'https://example.com/archive' }],
      });

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(mockAskGemini).toHaveBeenCalledTimes(2);
    expect(json.resolutionPath).toBe('live_grounded');
    expect(json.similarClaims).toHaveLength(1);
    expect(json.similarClaims[0].id).toBe('stored-claim-1');
  });

  it('surfaces contradiction context when a stale prior check conflicts with the live result', async () => {
    vi.setSystemTime(new Date('2026-12-31T12:00:00.000Z'));
    mockFindSimilarClaim.mockResolvedValue(
      makeStoredClaim({
        status: 'supported',
        nuance: 'Older coverage counted the shutdown at 40 days.',
      }),
    );

    mockAskGemini
      .mockResolvedValueOnce({
        data: {
          status: 'disputed',
          sourceTitle: 'Associated Press',
          sourceType: 'news_article',
          nuance: 'Coverage notes the shutdown lasted 38 days.',
          evidenceSnippet: null,
          confidence: 0.78,
        },
        inputTokens: 10,
        outputTokens: 18,
        sources: [{ title: 'Associated Press', url: 'https://example.com/ap' }],
      })
      .mockResolvedValueOnce({
        data: {
          status: 'disputed',
          sourceTitle: 'Reuters',
          sourceType: 'news_article',
          nuance: 'Reuters reports the shutdown lasted 38 days.',
          evidenceSnippet: null,
          confidence: 0.81,
        },
        inputTokens: 11,
        outputTokens: 19,
        sources: [{ title: 'Reuters', url: 'https://example.com/reuters' }],
      });

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.sourceCard.status).toBe('disputed');
    expect(json.sourceCard.contradictionContext).toContain('Earlier coverage');
    expect(json.sourceCard.contradictionContext).toContain('SUPPORTED');
  });
});
