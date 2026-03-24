import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

const mockUpsert = vi.fn();
const mockQuery = vi.fn();

vi.mock('@upstash/vector', () => ({
  Index: vi.fn().mockImplementation(() => ({
    upsert: mockUpsert,
    query: mockQuery,
  })),
}));

const CLAIM_VECTOR = {
  id: 'claim-1',
  claimText: 'Fixture claim',
  status: 'supported' as const,
  nuance: 'Fixture nuance',
  sourceTitle: 'Fixture source',
  sourceUrl: 'https://example.com/source',
  sourceType: 'official_source',
  videoId: 'video-1',
  videoTitle: 'Fixture video',
  timestampSeconds: 42,
  verifiedAt: '2026-03-23T00:00:00.000Z',
  wordingVersion: 1,
};

describe('vector-store hardening', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.UPSTASH_VECTOR_REST_URL = 'https://vector.example.com';
    process.env.UPSTASH_VECTOR_REST_TOKEN = 'token';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.UPSTASH_VECTOR_REST_URL;
    delete process.env.UPSTASH_VECTOR_REST_TOKEN;
    vi.restoreAllMocks();
  });

  it('passes through valid 768-dim vectors without introducing non-finite values', async () => {
    const { upsertClaimVector } = await import('../src/lib/vector-store');
    const embedding = Array.from({ length: 768 }, (_, index) => index / 1000);

    await upsertClaimVector(CLAIM_VECTOR, embedding);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const vector = mockUpsert.mock.calls[0]?.[0]?.vector as number[];
    expect(vector).toHaveLength(768);
    expect(vector.every(Number.isFinite)).toBe(true);
  });

  it('skips upsert when the embedding is shorter than the target dimension', async () => {
    const { upsertClaimVector } = await import('../src/lib/vector-store');

    await upsertClaimVector(CLAIM_VECTOR, [1, 2, 3]);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it('skips query lookups when the embedding contains non-finite values', async () => {
    const { findSimilarClaim, findRelatedClaims } = await import('../src/lib/vector-store');

    await expect(findSimilarClaim([1, Number.NaN, 3])).resolves.toBeNull();
    await expect(findRelatedClaims([1, Number.POSITIVE_INFINITY, 3])).resolves.toEqual([]);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
