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
      videoId: 'verify-terminal-test',
      videoTitle: 'Oregon geography',
      channelName: 'Geography by Geoff',
      ...overrides,
    }),
    headers: new Headers(headers),
    nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
  } as unknown as NextRequest;
}

const makeRecoverableParseError = () =>
  Object.assign(
    new Error('Failed to parse Gemini response as JSON (gemini-2.5-flash).'),
    { code: 'PARSE_ERROR', status: 502 },
  );

describe('verify-claim terminal fallback path', () => {
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

  it('returns an explicit terminal unverifiable fallback when both grounded passes fail recoverably', async () => {
    mockAskGemini
      .mockRejectedValueOnce(makeRecoverableParseError())
      .mockRejectedValueOnce(makeRecoverableParseError())
      .mockRejectedValueOnce(makeRecoverableParseError())
      .mockRejectedValueOnce(makeRecoverableParseError());

    const res = await POST(await makeRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.usedFallback).toBe(true);
    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('Automated check incomplete');
    expect(json.sourceCard.sourceType).toBe('other');
    expect(json.sourceCard.sourceUrl).toBe('');
    expect(json.sourceCard.nuance).toBe(
      'Automated verification could not complete; verify this claim independently.'
    );
  });
});
