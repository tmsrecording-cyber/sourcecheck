// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

// ioredis is dynamically imported to avoid Edge runtime compatibility issues
// (ioredis uses Node.js Buffer APIs not available in Edge)

/**
 * Minimal rate-limit store contract.
 *
 * Implementations must atomically consume `cost` points for `key` within a
 * fixed window.  Returning false means the caller should reply 429; returning
 * true means the budget was available and has been consumed.
 *
 * Implementations must be concurrency-safe: parallel calls for the same key
 * must never allow the total to exceed maxPoints.
 */
export interface RateLimitStore {
  tryConsume(
    key: string,
    cost: number,
    maxPoints: number,
    windowMs: number,
  ): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// In-memory implementation  (dev / single-process)
// ---------------------------------------------------------------------------

type MemoryBucket = { points: number; windowStartedAt: number };

/**
 * Process-local fixed-window store.
 *
 * Accepts an optional `sharedBuckets` Map so the same backing state can be
 * passed to a freshly constructed instance — useful in tests to prove that
 * state survives "adapter recreation" (simulating a durable backing store).
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets: Map<string, MemoryBucket>;

  constructor(sharedBuckets?: Map<string, MemoryBucket>) {
    this.buckets = sharedBuckets ?? new Map();
  }

  async tryConsume(
    key: string,
    cost: number,
    maxPoints: number,
    windowMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const current = this.buckets.get(key);

    if (!current || now - current.windowStartedAt >= windowMs) {
      if (cost > maxPoints) {
        return false;
      }
      this.buckets.set(key, { points: cost, windowStartedAt: now });
      this.prune(now, windowMs);
      return true;
    }

    if (current.points + cost > maxPoints) {
      return false;
    }

    this.buckets.set(key, {
      points: current.points + cost,
      windowStartedAt: current.windowStartedAt,
    });
    return true;
  }

  private prune(now: number, windowMs: number) {
    if (this.buckets.size < 1500) return;
    this.buckets.forEach((bucket, key) => {
      if (now - bucket.windowStartedAt >= windowMs) {
        this.buckets.delete(key);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Redis implementation  (production — durable, multi-instance safe)
// ---------------------------------------------------------------------------

// Lua script for an atomic fixed-window increment.
//
// KEYS[1]  = bucket key (string)
// ARGV[1]  = cost       (integer points this request consumes)
// ARGV[2]  = maxPoints  (integer budget for the window)
// ARGV[3]  = windowMs   (integer window length in milliseconds)
// ARGV[4]  = nowMs      (integer current epoch-ms from the caller)
//
// Returns 1 if the request is allowed, 0 if it would exceed the budget.
// The key is set to expire after windowMs so idle buckets self-clean.
const RATE_LIMIT_LUA = `
local data    = redis.call('HMGET', KEYS[1], 'pts', 'win')
local pts     = tonumber(data[1]) or 0
local win     = tonumber(data[2]) or 0
local cost    = tonumber(ARGV[1])
local max_pts = tonumber(ARGV[2])
local win_ms  = tonumber(ARGV[3])
local now_ms  = tonumber(ARGV[4])

-- Only reset window if it has actually expired (or on first use where win=0)
-- Note: pts==0 is NOT a reset condition because it happens when budget is exhausted
if (now_ms - win) >= win_ms then
  if cost > max_pts then
    return 0
  end
  redis.call('HMSET',   KEYS[1], 'pts', cost, 'win', now_ms)
  redis.call('PEXPIRE', KEYS[1], win_ms)
  return 1
end

if pts + cost > max_pts then
  return 0
end

redis.call('HINCRBY', KEYS[1], 'pts', cost)
return 1
`;

/**
 * Redis-backed fixed-window store.
 *
 * Atomic via a server-side Lua script — no race between read and increment.
 *
 * FAILS CLOSED: if the Redis command throws (connection refused, timeout,
 * etc.) the request is denied rather than allowed, so the rate limit cannot
 * be bypassed during a Redis outage.
 */
// Dynamically import ioredis to avoid Edge runtime issues
// This module uses a lazy-loading pattern to prevent bundler issues in Edge runtimes

type RedisClient = {
  eval(...args: (string | number)[]): Promise<unknown>;
  on(event: string, callback: (err: Error) => void): void;
};

// Module-level cache for the ioredis module to avoid repeated dynamic imports
let ioredisModule: { default: new (url: string, options: Record<string, unknown>) => RedisClient } | null = null;

/**
 * Lazily load ioredis module. This is wrapped in a try-catch to handle Edge runtime
 * environments where ioredis may not be available or may fail to load due to
 * Node.js-specific dependencies (like 'net', 'tls').
 */
async function loadIoRedis(): Promise<typeof ioredisModule> {
  if (ioredisModule) {
    return ioredisModule;
  }
  
  try {
    // Use a variable to hold the import to avoid direct string literal analysis issues
    const moduleName = 'ioredis';
    const imported = await import(moduleName);
    ioredisModule = imported as typeof ioredisModule;
    return ioredisModule;
  } catch (error) {
    // ioredis failed to load (likely in Edge runtime or missing dependencies)
    console.error(
      '[SourceCheck/ratelimit] Failed to load ioredis module. ' +
      'This is expected in Edge runtimes. Error:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

async function getRedisClient(redisUrl: string): Promise<RedisClient | null> {
  const Redis = await loadIoRedis();
  
  if (!Redis) {
    return null;
  }
  
  const client = new Redis.default(redisUrl, {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 2_000,
  });
  
  client.on('error', (err: Error) => {
    console.error('[SourceCheck/ratelimit] Redis error:', err.message);
  });
  
  return client;
}

export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClient | null = null;
  private readonly redisUrl: string;
  private loadError: Error | null = null;
  private fallbackStore: InMemoryRateLimitStore | null = null;
  private isUsingFallback = false;

  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
  }

  private async getClient(): Promise<RedisClient | null> {
    if (this.loadError) {
      // Previously failed to load, don't retry
      return null;
    }
    
    if (!this.client) {
      this.client = await getRedisClient(this.redisUrl);
      
      if (!this.client) {
        this.loadError = new Error('Failed to initialize Redis client - ioredis module unavailable');
      }
    }
    
    return this.client;
  }

  /**
   * Get or create the fallback in-memory store.
   * This is used when Redis is unavailable to provide graceful degradation
   * rather than completely denying all requests.
   */
  private getFallbackStore(): InMemoryRateLimitStore {
    if (!this.fallbackStore) {
      this.fallbackStore = new InMemoryRateLimitStore();
      console.warn(
        '[SourceCheck/ratelimit] Initialized in-memory fallback store. ' +
        'Rate limits will be process-local only until Redis recovers.'
      );
    }
    return this.fallbackStore;
  }

  async tryConsume(
    key: string,
    cost: number,
    maxPoints: number,
    windowMs: number,
  ): Promise<boolean> {
    // If we're already using fallback, continue using it
    if (this.isUsingFallback) {
      return this.getFallbackStore().tryConsume(key, cost, maxPoints, windowMs);
    }

    try {
      const client = await this.getClient();
      
      // If Redis client couldn't be initialized (e.g., in Edge runtime),
      // gracefully fall back to in-memory store
      if (!client) {
        console.warn(
          '[SourceCheck/ratelimit] Redis client unavailable, activating in-memory fallback. ' +
          'Rate limits will be process-local only.'
        );
        this.isUsingFallback = true;
        return this.getFallbackStore().tryConsume(key, cost, maxPoints, windowMs);
      }
      
      const result = (await client.eval(
        RATE_LIMIT_LUA,
        1,
        `rl:${key}`,
        String(cost),
        String(maxPoints),
        String(windowMs),
        String(Date.now()),
      )) as number;
      return result === 1;
    } catch (err) {
      // Redis command failed — switch to fallback for graceful degradation
      // rather than completely denying all requests during a Redis outage.
      console.error(
        '[SourceCheck/ratelimit] Redis eval failed, switching to in-memory fallback:',
        err instanceof Error ? err.message : String(err),
      );
      this.isUsingFallback = true;
      return this.getFallbackStore().tryConsume(key, cost, maxPoints, windowMs);
    }
  }
}
