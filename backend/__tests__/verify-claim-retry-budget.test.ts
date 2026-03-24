import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupSessionAuthEnv, createAuthHeaders, TEST_EXTENSION_ID, mockCryptoSubtle } from './helpers/session';

const mockAskGemini = vi.fn();
const mockIsGeminiError = vi.fn();
const mockGenerateEmbedding = vi.fn();
const mockFindSimilarClaim = vi.fn();
const mockFindRelatedClaims = vi.fn();
const mockUpsertClaimVector = vi.fn();
const mockSearchClaimReviewMatches = vi.fn();

vi.mock('../src/lib/gemini', () => ({
  askGeminiJSONWithSearch: (...args: unknown[]) => mockAskGemini(...args),
  isGeminiError: (...args: unknown[]) => mockIsGeminiError(...args),
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
        claimText: 'The Oregon Dunes National Recreation Area is the largest coastal dune system in North America.',
        claimType: 'historical',
        timestampSeconds: 241,
      },
      videoId: 'verify-retry-budget-test',
      videoTitle: 'Oregon geography',
      channelName: 'Geography by Geoff',
      ...overrides,
    }),
    headers: new Headers(headers),
    nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
  } as unknown as NextRequest;
}

const makeRecoverableMaxTokensError = () =>
  Object.assign(
    new Error('Gemini stopped at MAX_TOKENS before returning a complete response (gemini-2.5-flash).'),
    { code: 'API_ERROR', status: 502 },
  );

describe('verify-claim retry output budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRecentVerificationCacheForTests();
    setupSessionAuthEnv();
    mockCryptoSubtle();
    mockGenerateEmbedding.mockResolvedValue([]);
    mockFindSimilarClaim.mockResolvedValue(null);
    mockFindRelatedClaims.mockResolvedValue([]);
    mockUpsertClaimVector.mockResolvedValue(undefined);
    mockSearchClaimReviewMatches.mockResolvedValue([]);
    mockIsGeminiError.mockImplementation((error: unknown) => {
      return Boolean(error && typeof error === 'object' && 'code' in error && 'status' in error);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRecentVerificationCacheForTests();
  });

  it('retries MAX_TOKENS with a smaller compact prompt and preserved schema', async () => {
    mockAskGemini
      .mockResolvedValueOnce({
        data: {
          status: 'supported',
          sourceTitle: 'Harvard Health',
          sourceType: 'official_source',
          nuance: 'Harvard data supports this claim.',
          evidenceSnippet: null,
          confidence: 0.82,
        },
        inputTokens: 10,
        outputTokens: 20,
        sources: [{ title: 'Harvard Health', url: 'https://example.com/harvard' }],
      })
      .mockRejectedValueOnce(makeRecoverableMaxTokensError())
      .mockResolvedValueOnce({
        data: {
          status: 'partial',
          sourceTitle: 'Oregon Encyclopedia',
          sourceType: 'official_source',
          nuance: 'Largest is debated by source.',
          evidenceSnippet: null,
          confidence: 0.74,
        },
        inputTokens: 12,
        outputTokens: 18,
        sources: [{ title: 'Oregon Encyclopedia', url: 'https://example.com/oregon' }],
      });

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    expect(mockAskGemini).toHaveBeenCalledTimes(3);

    const firstAdvocateCall = mockAskGemini.mock.calls[0];
    const firstChallengerCall = mockAskGemini.mock.calls[1];
    const retryChallengerCall = mockAskGemini.mock.calls[2];

    expect(firstAdvocateCall[1]).toBe(900);
    expect(firstChallengerCall[1]).toBe(900);
    expect(retryChallengerCall[1]).toBe(700);
    expect(retryChallengerCall[2]).toBeTruthy();
    expect(retryChallengerCall[0]).toContain('Return ONLY compact valid JSON.');
    expect(retryChallengerCall[0]).toContain('evidenceSnippet: null unless a quote under 24 words is strictly necessary');

    const json = await res.json();
    expect(json.usedFallback).toBe(false);
  });
});
