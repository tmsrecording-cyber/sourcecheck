// ---------------------------------------------------------------------------
// Upstash Redis Rate Limit Store (Edge-compatible)
// ---------------------------------------------------------------------------
// This implementation uses @upstash/redis which is REST-based and works in
// Edge runtimes (Cloudflare Workers, Vercel Edge, etc.) without Node.js APIs.
// ---------------------------------------------------------------------------

import { RateLimitStore, InMemoryRateLimitStore } from './rate-limit-store';

// Lazily loaded Upstash Redis client type
// We use dynamic imports to avoid bundling issues when the module isn't used
type UpstashRedisClient = {
  eval: (...args: (string | number)[]) => Promise<unknown>;
  hgetall: (key: string) => Promise<Record<string, string> | null>;
  hmset: (key: string, kv: Record<string, string | number>) => Promise<'OK' | string>;
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  pexpire: (key: string, milliseconds: number) => Promise<0 | 1>;
  multi: () => UpstashPipeline;
};

type UpstashPipeline = {
  hmset: (key: string, kv: Record<string, string | number>) => UpstashPipeline;
  pexpire: (key: string, milliseconds: number) => UpstashPipeline;
  exec: () => Promise<unknown[]>;
};

// Module-level cache for the upstash/redis module
let upstashModule: { Redis: new (config: { url: string; token: string }) => UpstashRedisClient } | null = null;

/**
 * Lazily load @upstash/redis module. This handles cases where the module
 * isn't installed or we're in an environment that can't load it.
 */
async function loadUpstashRedis(): Promise<typeof upstashModule> {
  if (upstashModule) {
    return upstashModule;
  }

  try {
    const moduleName = '@upstash/redis';
    const imported = await import(moduleName);
    upstashModule = imported as typeof upstashModule;
    return upstashModule;
  } catch (error) {
    console.warn(
      '[SourceCheck/upstash-ratelimit] Failed to load @upstash/redis module. ' +
      'Ensure it is installed: npm install @upstash/redis. Error:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/**
 * Configuration for Upstash Redis connection.
 * Reads from environment variables:
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 */
export interface UpstashConfig {
  url: string;
  token: string;
}

/**
 * Get Upstash Redis configuration from environment variables.
 * Returns null if configuration is missing.
 */
function getUpstashConfig(): UpstashConfig | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return { url, token };
}

/**
 * Create an Upstash Redis client from configuration.
 * Returns null if the module can't be loaded.
 */
async function createUpstashClient(config: UpstashConfig): Promise<UpstashRedisClient | null> {
  const Redis = await loadUpstashRedis();

  if (!Redis) {
    return null;
  }

  try {
    const client = new Redis.Redis({
      url: config.url,
      token: config.token,
    });
    return client;
  } catch (error) {
    console.error(
      '[SourceCheck/upstash-ratelimit] Failed to create Upstash Redis client:',
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lua Script for Atomic Operations
// ---------------------------------------------------------------------------
// Upstash supports Lua scripts via the EVAL command (REST endpoint: /eval)
// This is the same script pattern as the ioredis implementation for consistency.
//
// KEYS[1]  = bucket key (string)
// ARGV[1]  = cost       (integer points this request consumes)
// ARGV[2]  = maxPoints  (integer budget for the window)
// ARGV[3]  = windowMs   (integer window length in milliseconds)
// ARGV[4]  = nowMs      (integer current epoch-ms from the caller)
//
// Returns 1 if the request is allowed, 0 if it would exceed the budget.
// The key is set to expire after windowMs so idle buckets self-clean.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Upstash Redis Rate Limit Store Implementation
// ---------------------------------------------------------------------------

/**
 * Upstash Redis-backed fixed-window rate limit store.
 *
 * Features:
 * - Edge runtime compatible (uses REST API, no Node.js-specific APIs)
 * - Atomic operations via Lua script (same logic as ioredis implementation)
 * - Graceful fallback to in-memory store if Upstash is unavailable
 * - Fails open (allows requests) with warning logs if Redis is down
 *
 * Environment variables required:
 * - UPSTASH_REDIS_REST_URL
 * - UPSTASH_REDIS_REST_TOKEN
 */
export class UpstashRateLimitStore implements RateLimitStore {
  private client: UpstashRedisClient | null = null;
  private config: UpstashConfig | null = null;
  private loadError: Error | null = null;
  private fallbackStore: InMemoryRateLimitStore | null = null;
  private isUsingFallback = false;
  private hasLoggedFallback = false;

  constructor(config?: UpstashConfig) {
    this.config = config ?? getUpstashConfig();
  }

  /**
   * Get or create the Upstash Redis client.
   * Returns null if the client can't be initialized.
   */
  private async getClient(): Promise<UpstashRedisClient | null> {
    if (this.loadError) {
      // Previously failed to load, don't retry
      return null;
    }

    if (!this.client) {
      // Check if we have configuration
      if (!this.config) {
        this.loadError = new Error(
          'Upstash Redis configuration missing. ' +
          'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN environment variables.'
        );
        return null;
      }

      this.client = await createUpstashClient(this.config);

      if (!this.client) {
        this.loadError = new Error('Failed to initialize Upstash Redis client');
      }
    }

    return this.client;
  }

  /**
   * Get or create the fallback in-memory store.
   * This is used when Upstash is unavailable to provide graceful degradation.
   */
  private getFallbackStore(): InMemoryRateLimitStore {
    if (!this.fallbackStore) {
      this.fallbackStore = new InMemoryRateLimitStore();
    }
    return this.fallbackStore;
  }

  /**
   * Attempt to consume `cost` points for `key` within the rate limit window.
   *
   * This method is atomic and concurrency-safe. It will:
   * 1. Try to use Upstash Redis via Lua script for atomic operations
   * 2. Fall back to in-memory store if Upstash is unavailable
   * 3. Log warnings but allow requests (fail open) during Redis outages
   *
   * @param key - The rate limit key (will be prefixed with 'rl:')
   * @param cost - Number of points to consume
   * @param maxPoints - Maximum points allowed in the window
   * @param windowMs - Window duration in milliseconds
   * @returns true if the request is allowed, false if rate limited
   */
  async tryConsume(
    key: string,
    cost: number,
    maxPoints: number,
    windowMs: number,
  ): Promise<boolean> {
    // If we're already using fallback, continue using it
    if (this.isUsingFallback) {
      if (!this.hasLoggedFallback) {
        console.warn(
          '[SourceCheck/upstash-ratelimit] Using in-memory fallback store. ' +
          'Rate limits are process-local only.'
        );
        this.hasLoggedFallback = true;
      }
      return this.getFallbackStore().tryConsume(key, cost, maxPoints, windowMs);
    }

    try {
      const client = await this.getClient();

      // If Upstash client couldn't be initialized, gracefully fall back
      if (!client) {
        console.warn(
          '[SourceCheck/upstash-ratelimit] Upstash Redis unavailable, ' +
          'activating in-memory fallback. Rate limits will be process-local only.'
        );
        this.isUsingFallback = true;
        return this.getFallbackStore().tryConsume(key, cost, maxPoints, windowMs);
      }

      // Execute the Lua script atomically
      const result = (await client.eval(
        RATE_LIMIT_LUA,
        1,
        `rl:${key}`,
        cost,
        maxPoints,
        windowMs,
        Date.now(),
      )) as number;

      return result === 1;
    } catch (err) {
      // Upstash command failed — switch to fallback for graceful degradation
      // We fail open (allow the request) but log a warning
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check if this is a connection/auth error vs a logic error
      const isConnectionError =
        errorMessage.includes('connect') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('UNAUTHORIZED') ||
        errorMessage.includes('authentication');

      if (isConnectionError) {
        console.error(
          '[SourceCheck/upstash-ratelimit] Upstash Redis connection failed, ' +
          'switching to in-memory fallback:',
          errorMessage
        );
        this.isUsingFallback = true;
        return this.getFallbackStore().tryConsume(key, cost, maxPoints, windowMs);
      }

      // For other errors, log and allow (fail open)
      console.warn(
        '[SourceCheck/upstash-ratelimit] Upstash Redis error (failing open):',
        errorMessage
      );
      return true;
    }
  }

  /**
   * Reset the store to its initial state.
   * Clears any fallback store and resets the fallback flag.
   * This is useful for testing or when you want to force a reconnect.
   */
  reset(): void {
    this.isUsingFallback = false;
    this.hasLoggedFallback = false;
    this.fallbackStore = null;
    this.loadError = null;
    // Note: we don't reset this.client to avoid connection churn
  }

  /**
   * Check if the store is currently using the fallback in-memory implementation.
   */
  isFallbackActive(): boolean {
    return this.isUsingFallback;
  }
}

// ---------------------------------------------------------------------------
// Factory function for easy instantiation
// ---------------------------------------------------------------------------

/**
 * Create a RateLimitStore using Upstash Redis if configured,
 * otherwise fall back to in-memory store.
 *
 * This is the recommended way to create a rate limit store in Edge runtimes.
 */
export async function createUpstashRateLimitStore(): Promise<RateLimitStore> {
  const config = getUpstashConfig();

  if (!config) {
    console.warn(
      '[SourceCheck/upstash-ratelimit] Upstash Redis not configured ' +
      '(UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN missing). ' +
      'Using in-memory rate limit store.'
    );
    return new InMemoryRateLimitStore();
  }

  const store = new UpstashRateLimitStore(config);

  // Test the connection by doing a no-op eval
  try {
    const client = await (store as UpstashRateLimitStore)['getClient']();
    if (!client) {
      throw new Error('Failed to initialize Upstash client');
    }
    // Simple ping - evaluate a Lua script that returns 1
    await client.eval('return 1', 0);
    console.log('[SourceCheck/upstash-ratelimit] Upstash Redis connected successfully');
    return store;
  } catch (err) {
    console.warn(
      '[SourceCheck/upstash-ratelimit] Failed to connect to Upstash Redis, ' +
      'falling back to in-memory store:',
      err instanceof Error ? err.message : String(err)
    );
    return new InMemoryRateLimitStore();
  }
}
