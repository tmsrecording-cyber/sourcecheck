import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
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
  mapClaimReviewRatingToStatus: () => null,
}));

import { POST } from '../src/app/api/verify-claim/route';
import { resetRecentVerificationCacheForTests } from '../src/lib/recent-verification-cache';

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
      videoId: 'verify-live-cache-test',
      videoTitle: 'Shutdown claims',
      channelName: 'Policy Hour',
      ...overrides,
    }),
    headers: new Headers(headers),
    nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
  } as unknown as NextRequest;
}

describe('verify-claim short TTL live verification cache', () => {
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

  it('reuses a recent live-grounded verification result without re-calling Gemini', async () => {
    mockAskGemini
      .mockResolvedValueOnce({
        data: {
          status: 'supported',
          sourceTitle: 'Congressional Research Service',
          sourceType: 'official_source',
          nuance: 'Congressional records document the shutdown period.',
          evidenceSnippet: null,
          confidence: 0.76,
        },
        inputTokens: 10,
        outputTokens: 18,
        sources: [{ title: 'Congressional Research Service', url: 'https://example.com/crs' }],
      })
      .mockResolvedValueOnce({
        data: {
          status: 'supported',
          sourceTitle: 'Congressional Research Service',
          sourceType: 'official_source',
          nuance: 'CRS historical materials align on the duration.',
          evidenceSnippet: null,
          confidence: 0.74,
        },
        inputTokens: 11,
        outputTokens: 19,
        sources: [{ title: 'Congressional Research Service', url: 'https://example.com/crs' }],
      });

    const first = await POST(await makeRequest());
    const firstJson = await first.json();
    expect(first.status).toBe(200);
    expect(mockAskGemini).toHaveBeenCalledTimes(2);
    expect(firstJson.resolutionPath).toBe('live_grounded');

    const second = await POST(await makeRequest());
    const secondJson = await second.json();
    expect(second.status).toBe(200);
    expect(mockAskGemini).toHaveBeenCalledTimes(2);
    expect(secondJson.resolutionPath).toBe('live_grounded');
    expect(secondJson.sourceCard.sourceTitle).toBe(firstJson.sourceCard.sourceTitle);
    expect(secondJson.sourceCard.status).toBe(firstJson.sourceCard.status);
  });

  it('skips the recent verification cache for private requests', async () => {
    mockAskGemini
      .mockResolvedValue({
        data: {
          status: 'partial',
          sourceTitle: 'Congressional Research Service',
          sourceType: 'official_source',
          nuance: 'Historical summaries vary on whether to count weekends.',
          evidenceSnippet: null,
          confidence: 0.71,
        },
        inputTokens: 10,
        outputTokens: 18,
        sources: [{ title: 'Congressional Research Service', url: 'https://example.com/crs' }],
      });

    const first = await POST(await makeRequest({ isPrivate: true }));
    expect(first.status).toBe(200);

    const second = await POST(await makeRequest({ isPrivate: true }));
    expect(second.status).toBe(200);
    expect(mockAskGemini).toHaveBeenCalledTimes(4);
  });
});
