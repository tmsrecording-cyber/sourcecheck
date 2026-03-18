/**
 * Shared rate limiting utilities for API routes.
 * 
 * Mirrors the rate-limit behavior from proxy.ts:
 * - BYOK (x-custom-api-key header present) skips rate limiting
 * - Rate limits are per-extension-ID + IP + path
 * - Uses Redis if configured, otherwise in-memory
 */

import { NextRequest, NextResponse } from 'next/server';
import { InMemoryRateLimitStore, RedisRateLimitStore } from './rate-limit-store';

// Default rate limit config (mirrors proxy.ts defaults)
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_POINTS = 80;

// Route-specific costs (mirrors proxy.ts RATE_LIMIT_COST_BY_PATH)
export const RATE_LIMIT_COSTS: Record<string, number> = {
  '/api/analyze-chunk': 2,
  '/api/verify-claim': 6,
  '/api/ask-video': 4,
};

// Module-level singleton store (mirrors proxy.ts pattern)
let _rateLimitStore: InMemoryRateLimitStore | RedisRateLimitStore | null = null;
let _redisUnavailableLogged = false;

function isLocalApiHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

async function getRateLimitStore(request: NextRequest): Promise<InMemoryRateLimitStore | RedisRateLimitStore> {
  if (_rateLimitStore) return _rateLimitStore;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    _rateLimitStore = new RedisRateLimitStore(redisUrl);
    
    if (!isLocalApiHost(request.headers.get('host')?.split(':')[0] || '') && !_redisUnavailableLogged) {
      console.warn(
        '[SourceCheck/rate-limit] Redis configured. If you see ioredis errors, ' +
        'the deployment environment may not support Node.js-specific modules.'
      );
      _redisUnavailableLogged = true;
    }
  } else {
    _rateLimitStore = new InMemoryRateLimitStore();
  }
  return _rateLimitStore;
}

/**
 * Reset the rate limit store (for testing only).
 */
export function resetRateLimitStore(): void {
  _rateLimitStore = null;
}

function parseClientIp(request: NextRequest): string {
  const trustedProxyCount = Math.min(
    10,
    Math.max(0, parseInt(process.env.TRUSTED_PROXY_COUNT || '0', 10) || 0)
  );
  
  if (trustedProxyCount > 0) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const ips = forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean);
      const ipIndex = Math.max(0, ips.length - trustedProxyCount - 1);
      return ips[ipIndex] || 'unknown';
    }
    return request.headers.get('x-real-ip') || 'unknown';
  }
  
  return 'unknown';
}

function getRateLimitKey(request: NextRequest, identity: string): string {
  const clientIp = parseClientIp(request);
  const path = request.nextUrl.pathname;
  return `${identity}:ip:${clientIp}:${path}`;
}

function getRateLimitCost(path: string): number {
  return RATE_LIMIT_COSTS[path] || 1;
}

function getRateLimitMaxPoints(): number {
  const raw = process.env.RATE_LIMIT_MAX_POINTS?.trim();
  if (!raw) return DEFAULT_MAX_POINTS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_POINTS;
}

function getRateLimitWindowMs(): number {
  const raw = process.env.RATE_LIMIT_WINDOW_MS?.trim();
  if (!raw) return DEFAULT_WINDOW_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WINDOW_MS;
}

/**
 * Check if request should skip rate limiting (BYOK mode).
 * Mirrors proxy.ts behavior: x-custom-api-key header present = skip rate limits.
 */
export function shouldSkipRateLimit(request: NextRequest): boolean {
  const customApiKey = request.headers.get('x-custom-api-key')?.trim();
  return !!customApiKey && customApiKey.length > 0;
}

/**
 * Result of rate limit check.
 */
export type RateLimitResult = 
  | { allowed: true; retryAfter?: never }
  | { allowed: false; retryAfter: number };

/**
 * Check rate limit for the request.
 * Returns { allowed: true } if within limits, { allowed: false, retryAfter } if exceeded.
 */
export async function checkRateLimit(
  request: NextRequest,
  identity: string
): Promise<RateLimitResult> {
  // BYOK: skip rate limiting
  if (shouldSkipRateLimit(request)) {
    return { allowed: true };
  }

  const store = await getRateLimitStore(request);
  const path = request.nextUrl.pathname;
  const cost = getRateLimitCost(path);
  const key = getRateLimitKey(request, identity);
  const maxPoints = getRateLimitMaxPoints();
  const windowMs = getRateLimitWindowMs();

  const allowed = await store.tryConsume(key, cost, maxPoints, windowMs);
  
  if (!allowed) {
    const retryAfter = Math.ceil(windowMs / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Create a rate limit exceeded response with proper CORS headers.
 */
export function createRateLimitResponse(
  request: NextRequest,
  retryAfter: number
): NextResponse {
  const response = NextResponse.json(
    { error: 'Rate limit exceeded. Please retry shortly.' },
    { status: 429 }
  );
  response.headers.set('Retry-After', String(retryAfter));
  return response;
}
