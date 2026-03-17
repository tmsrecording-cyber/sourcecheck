/**
 * Unit tests for backend/src/lib/rate-limit-store.ts
 *
 * InMemoryRateLimitStore:
 *   - Allows requests within budget
 *   - Denies when cost would exceed maxPoints
 *   - Resets window after windowMs elapses
 *   - Separate keys do not share quota
 *   - Quota persists when adapter is recreated over a shared backing Map
 *     (simulates Redis durability: same external state, new adapter instance)
 *
 * RedisRateLimitStore:
 *   - Allows when Lua script returns 1
 *   - Denies when Lua script returns 0
 *   - Gracefully degrades to in-memory store when Redis throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared Redis mock — must be defined before vi.mock() factory references it
// ---------------------------------------------------------------------------

const mockRedisInstance = {
  eval: vi.fn(),
  on: vi.fn(),
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => mockRedisInstance),
}));

// ---------------------------------------------------------------------------
// InMemoryRateLimitStore
// ---------------------------------------------------------------------------

import { InMemoryRateLimitStore } from '../src/lib/rate-limit-store';

describe('InMemoryRateLimitStore', () => {
  it('allows a fresh request', async () => {
    const store = new InMemoryRateLimitStore();
    expect(await store.tryConsume('k', 1, 10, 60_000)).toBe(true);
  });

  it('allows subsequent requests while budget remains', async () => {
    const store = new InMemoryRateLimitStore();
    // Each consume costs 3; maxPoints=9 → three calls fit exactly.
    expect(await store.tryConsume('k', 3, 9, 60_000)).toBe(true);
    expect(await store.tryConsume('k', 3, 9, 60_000)).toBe(true);
    expect(await store.tryConsume('k', 3, 9, 60_000)).toBe(true);
  });

  it('denies when cost would exceed maxPoints', async () => {
    const store = new InMemoryRateLimitStore();
    await store.tryConsume('k', 9, 10, 60_000); // 9 of 10 consumed
    expect(await store.tryConsume('k', 2, 10, 60_000)).toBe(false); // 9+2 > 10
  });

  it('resets budget after window expires', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryRateLimitStore();
      await store.tryConsume('k', 10, 10, 60_000); // exhaust
      expect(await store.tryConsume('k', 1, 10, 60_000)).toBe(false);

      vi.advanceTimersByTime(60_001); // past the window

      expect(await store.tryConsume('k', 1, 10, 60_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('separate keys do not share quota', async () => {
    const store = new InMemoryRateLimitStore();
    await store.tryConsume('key-a', 10, 10, 60_000); // exhaust key-a
    expect(await store.tryConsume('key-b', 10, 10, 60_000)).toBe(true); // key-b unaffected
  });

  it('quota persists when adapter is recreated over a shared backing Map', async () => {
    const sharedBuckets = new Map();

    const store1 = new InMemoryRateLimitStore(sharedBuckets);
    await store1.tryConsume('k', 8, 10, 60_000); // 8/10 consumed

    // Simulate adapter recreation (e.g. process restart backed by the same Redis).
    const store2 = new InMemoryRateLimitStore(sharedBuckets);
    // 8 already spent + 3 = 11 > 10 → deny
    expect(await store2.tryConsume('k', 3, 10, 60_000)).toBe(false);
  });

  it('shared backing Map allows a request that fits remaining budget', async () => {
    const sharedBuckets = new Map();

    const store1 = new InMemoryRateLimitStore(sharedBuckets);
    await store1.tryConsume('k', 8, 10, 60_000); // 8/10 consumed

    const store2 = new InMemoryRateLimitStore(sharedBuckets);
    // 8 already spent + 2 = 10 = maxPoints → allow (exactly at limit)
    expect(await store2.tryConsume('k', 2, 10, 60_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RedisRateLimitStore
// ---------------------------------------------------------------------------

import { RedisRateLimitStore } from '../src/lib/rate-limit-store';

describe('RedisRateLimitStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows request when Lua script returns 1', async () => {
    mockRedisInstance.eval.mockResolvedValueOnce(1);
    const store = new RedisRateLimitStore('redis://localhost:6379');
    expect(await store.tryConsume('k', 2, 10, 60_000)).toBe(true);
  });

  it('denies request when Lua script returns 0', async () => {
    mockRedisInstance.eval.mockResolvedValueOnce(0);
    const store = new RedisRateLimitStore('redis://localhost:6379');
    expect(await store.tryConsume('k', 2, 10, 60_000)).toBe(false);
  });

  it('gracefully degrades to in-memory store when Redis throws', async () => {
    mockRedisInstance.eval.mockRejectedValueOnce(new Error('Connection refused'));
    const store = new RedisRateLimitStore('redis://localhost:6379');
    // First call fails over to in-memory fallback and allows the request
    expect(await store.tryConsume('k', 2, 10, 60_000)).toBe(true);
    // Subsequent calls use the in-memory store (same quota tracking)
    expect(await store.tryConsume('k', 5, 10, 60_000)).toBe(true);
    expect(await store.tryConsume('k', 4, 10, 60_000)).toBe(false); // 2+5+4=11 > 10
  });

  it('prefixes the bucket key with "rl:" when calling eval', async () => {
    mockRedisInstance.eval.mockResolvedValueOnce(1);
    const store = new RedisRateLimitStore('redis://localhost:6379');
    await store.tryConsume('ext:abc123:/api/analyze-chunk', 2, 10, 60_000);
    expect(mockRedisInstance.eval).toHaveBeenCalledWith(
      expect.any(String),    // Lua script
      1,                     // numkeys
      'rl:ext:abc123:/api/analyze-chunk', // prefixed key
      '2',                   // cost
      '10',                  // maxPoints
      '60000',               // windowMs
      expect.any(String),    // nowMs (epoch)
    );
  });
});
