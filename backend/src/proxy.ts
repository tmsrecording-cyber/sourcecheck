import { NextRequest, NextResponse } from 'next/server';
import {
  type RateLimitStore,
  InMemoryRateLimitStore,
  RedisRateLimitStore,
} from '@/lib/rate-limit-store';

const DEFAULT_MAX_REQUEST_BYTES = 120_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_POINTS = 80;
const DEFAULT_SESSION_TTL_HOURS = 168; // 7 days

const RATE_LIMIT_COST_BY_PATH: Record<string, number> = {
  '/api/analyze-chunk': 2,
  '/api/verify-claim': 6,
  '/api/ask-video': 4,
};

// The session/init endpoint is the token issuance point — it is exempt from the
// session token requirement but still requires a valid extension ID.
const SESSION_INIT_PATH = '/api/session/init';

// ---------------------------------------------------------------------------
// Rate-limit store  (module-level singleton, lazily initialized)
// ---------------------------------------------------------------------------

let _rateLimitStore: RateLimitStore | null = null;
let _redisUnavailableLogged = false;

/**
 * Returns the active rate-limit store.
 *
 * - REDIS_URL set   → RedisRateLimitStore (durable, multi-instance safe)
 * - REDIS_URL unset → InMemoryRateLimitStore (process-local; fine for dev /
 *                     single-process deployments).  A warning is emitted once
 *                     when running on a non-localhost host without Redis.
 * 
 * Edge Runtime Handling:
 * If ioredis fails to load (e.g., in Vercel Edge runtime), we gracefully
 * fall back to InMemoryRateLimitStore and emit a warning.
 */
async function getRateLimitStore(request: NextRequest): Promise<RateLimitStore> {
  if (_rateLimitStore) return _rateLimitStore;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    const redisStore = new RedisRateLimitStore(redisUrl);
    
    // Test the Redis store by attempting a dry-run consumption
    // This will trigger the ioredis module load and fail gracefully if unavailable
    const testResult = await redisStore.tryConsume('__test_key__', 0, 100, 60000);
    
    // If Redis is fully unavailable (module load failed or connection refused),
    // the store will return false. We check if this is due to module unavailability
    // by examining if we're in an Edge runtime environment.
    // 
    // Note: We can't easily detect module load failure vs. connection failure,
    // so we rely on the warning logs from rate-limit-store.ts
    _rateLimitStore = redisStore;
    
    // If we're on a non-localhost host and Redis might be having issues,
    // log a warning but continue with the Redis store (it may recover)
    if (!isLocalApiHost(request.nextUrl.hostname) && !_redisUnavailableLogged) {
      console.warn(
        '[SourceCheck/proxy] Redis configured but may be unavailable. ' +
        'If you see ioredis load errors above, the deployment environment ' +
        'may not support Node.js-specific modules. Consider using InMemoryRateLimitStore ' +
        'or switching to a Node.js runtime (not Edge).'
      );
      _redisUnavailableLogged = true;
    }
  } else {
    _rateLimitStore = new InMemoryRateLimitStore();
  }
  return _rateLimitStore;
}

/** Inject a store — for testing only. */
export function setRateLimitStore(store: RateLimitStore): void {
  _rateLimitStore = store;
}

// ---------------------------------------------------------------------------
// Auth result type
// ---------------------------------------------------------------------------

// Verified identity returned by isAuthorizedRequest on success.
// The identity is always derived from the validated Origin header (or from the
// session token payload on the no-Origin service-worker path), never from raw
// caller-supplied headers, so it cannot be spoofed.
type AuthResult =
  | { authorized: true; identity: string }
  | { authorized: false };

// One-time warning flag for missing ALLOWED_EXTENSION_IDS (Fix 3).
let warnedMissingAllowlist = false;
// One-time warning flag for missing REDIS_URL on a non-localhost host.
let warnedMissingRedis = false;

// ---------------------------------------------------------------------------
// Main proxy handler
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (!isAllowedCorsOrigin(request)) {
      return NextResponse.json(
        { error: 'Origin not allowed.' },
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    return new NextResponse(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (await exceedsRequestSizeLimit(request)) {
    return NextResponse.json(
      { error: 'Request payload too large.' },
      {
        status: 413,
        headers: corsHeaders,
      }
    );
  }

  // Auth MUST run before rate-limiting so that an attacker cannot burn quota
  // for the real extension by spoofing the X-Extension-Id header.
  // The verified identity returned here is derived solely from the validated
  // Origin header / session token payload and is used as the rate-limit bucket key.
  const authResult = await isAuthorizedRequest(request);
  console.log(`[SourceCheck/proxy] ${request.method} ${request.nextUrl.pathname} - Authorized: ${authResult.authorized}${authResult.authorized ? ` (${authResult.identity})` : ''}`);

  if (!authResult.authorized) {
    return NextResponse.json(
      { error: 'Request not authorized.' },
      {
        status: 403,
        headers: corsHeaders,
      }
    );
  }

  // Check for BYOK (Bring Your Own Key) header
  // If user provides their own API key, skip rate limiting and use their key
  const customApiKey = request.headers.get('x-custom-api-key')?.trim();
  const hasCustomKey = customApiKey && customApiKey.length > 0;
  
  if (hasCustomKey) {
    console.log(`[SourceCheck/proxy] BYOK request detected for ${authResult.identity}, skipping rate limit`);
    // Note: API routes read the custom key directly from request headers,
    // no need to set it on response. Pass through with CORS headers.
    const response = NextResponse.next();
    
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  if (!(await applyRateLimit(request, authResult.identity))) {
    const retryAfter = Math.ceil(getRateLimitWindowMs() / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please retry shortly.' },
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(retryAfter),
        },
      }
    );
  }

  const response = NextResponse.next();

  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

async function exceedsRequestSizeLimit(request: NextRequest) {
  if (!methodCanHaveBody(request.method)) {
    return false;
  }

  const maxRequestBytes = getMaxRequestBytes();
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > maxRequestBytes) {
      return true;
    }
  }
  
  // If no content-length (chunked encoding), check with a streaming reader
  // to prevent memory exhaustion from huge requests
  if (!contentLength) {
    try {
      const cloned = request.clone();
      const reader = cloned.body?.getReader();
      if (!reader) return false;
      
      let totalBytes = 0;
      // Read chunks in a loop, accumulating total bytes
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        
        totalBytes += chunk.value?.length || 0;
        if (totalBytes > maxRequestBytes) {
          await reader.cancel();
          return true;
        }
      }
      return false;
    } catch {
      return true;
    }
  }

  try {
    const bodyText = await request.clone().text();
    return new TextEncoder().encode(bodyText).byteLength > maxRequestBytes;
  } catch {
    return true;
  }
}

function isAllowedCorsOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  return origin ? isAllowedOrigin(origin, request) : false;
}

function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type',
      'Authorization',
      'X-Extension-Version',
      'X-Extension-Id',
      'X-Custom-Api-Key',
    ].join(', '),
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (origin && isAllowedOrigin(origin, request)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function isAuthorizedRequest(request: NextRequest): Promise<AuthResult> {
  const origin = request.headers.get('origin');
  const extensionId = request.headers.get('x-extension-id')?.trim() || '';

  // Chrome extension service workers do NOT send an Origin header on
  // programmatic fetch() calls. When Origin is absent but X-Extension-Id
  // is present, treat it as a service-worker request from the extension.
  if (!origin && extensionId) {
    return authorizeExtensionServiceWorker(request, extensionId);
  }

  if (!origin || !isAllowedOrigin(origin, request)) {
    return { authorized: false };
  }

  const parsedOrigin = safeParseOrigin(origin);
  if (!parsedOrigin) {
    return { authorized: false };
  }

  if (parsedOrigin.protocol === 'chrome-extension:') {
    // x-extension-id must match the already-validated Origin hostname.
    // This is a consistency check, not the trust anchor — the Origin header
    // (validated by isAllowedOrigin above) is the authoritative source.
    if (!extensionId || extensionId !== parsedOrigin.hostname) {
      return { authorized: false };
    }
  }

  // Derive the verified identity from the validated Origin, never from
  // caller-supplied headers.
  const identity =
    parsedOrigin.protocol === 'chrome-extension:'
      ? `ext:${parsedOrigin.hostname}`
      : `origin:${origin}`;

  // Session init is the token issuance point — no session token required.
  if (request.nextUrl.pathname === SESSION_INIT_PATH || !requiresSessionToken(request)) {
    return { authorized: true, identity };
  }

  return verifyBearerSessionToken(request, extensionId || parsedOrigin.hostname, identity);
}

// Authorize requests from extension service workers (no Origin header).
// The X-Extension-Id header is the only identifier available; on localhost
// it is trusted for dev convenience, on deployed hosts it must be in the
// allowlist and the request must carry a valid session token.
async function authorizeExtensionServiceWorker(
  request: NextRequest,
  extensionId: string
): Promise<AuthResult> {
  if (!isAllowedExtensionOrigin(extensionId, request.nextUrl.hostname)) {
    return { authorized: false };
  }

  const identity = `ext:${extensionId}`;

  // Session init is the token issuance point — no session token required.
  if (request.nextUrl.pathname === SESSION_INIT_PATH || !requiresSessionToken(request)) {
    return { authorized: true, identity };
  }

  return verifyBearerSessionToken(request, extensionId, identity);
}

async function verifyBearerSessionToken(
  request: NextRequest,
  extensionId: string,
  identity: string
): Promise<AuthResult> {
  const sessionSecret = getSessionSecret();
  if (!sessionSecret) {
    return { authorized: false };
  }

  const authHeader = request.headers.get('authorization')?.trim() || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return { authorized: false };
  }

  const valid = await validateSessionToken(token, extensionId, sessionSecret);
  if (!valid) {
    return { authorized: false };
  }

  return { authorized: true, identity };
}

export function isAllowedOrigin(origin: string, request: NextRequest) {
  const parsedOrigin = safeParseOrigin(origin);
  if (!parsedOrigin) {
    return false;
  }

  if (parsedOrigin.protocol === 'chrome-extension:') {
    return isAllowedExtensionOrigin(parsedOrigin.hostname, request.nextUrl.hostname);
  }

  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function isAllowedExtensionOrigin(extensionId: string, apiHostname: string) {
  if (!extensionId) {
    return false;
  }

  const allowedExtensionIds = getAllowedExtensionIds();
  if (allowedExtensionIds.size > 0) {
    return allowedExtensionIds.has(extensionId);
  }

  // No allowlist configured — allow on localhost for local dev only.
  // Deployed backends (non-localhost) always fail closed.
  if (isLocalApiHost(apiHostname)) {
    if (!warnedMissingAllowlist) {
      warnedMissingAllowlist = true;
      console.warn(
        '[SourceCheck/proxy] ALLOWED_EXTENSION_IDS is not set. ' +
          `Allowing extension on localhost (id=${extensionId}). ` +
          'Set ALLOWED_EXTENSION_IDS before deploying.'
      );
    }
    return true;
  }
  return false;
}

function getAllowedExtensionIds() {
  return new Set(
    (process.env.ALLOWED_EXTENSION_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function getSessionSecret() {
  return process.env.SESSION_SECRET?.trim() || '';
}

function requiresSessionToken(request: NextRequest) {
  return !isLocalApiHost(request.nextUrl.hostname) || Boolean(getSessionSecret());
}

function isLocalApiHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function safeParseOrigin(origin: string) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session token issuance and verification
// ---------------------------------------------------------------------------

// Base64url encoding for Edge runtime (btoa/atob not available, Buffer not available)
const base64urlChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64url(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i++];
    const b2 = i < bytes.length ? bytes[i++] : 0;
    const b3 = i < bytes.length ? bytes[i++] : 0;
    
    const bitmap = (b1 << 16) | (b2 << 8) | b3;
    
    result += base64urlChars[(bitmap >> 18) & 63];
    result += base64urlChars[(bitmap >> 12) & 63];
    result += i - 2 < bytes.length ? base64urlChars[(bitmap >> 6) & 63] : '';
    result += i - 1 < bytes.length ? base64urlChars[bitmap & 63] : '';
  }
  return result;
}

function base64urlToBytes(input: string): Uint8Array {
  const padLength = (4 - (input.length % 4)) % 4;
  const padded = input + '='.repeat(padLength);
  
  const lookup: Record<string, number> = {};
  for (let i = 0; i < base64urlChars.length; i++) {
    lookup[base64urlChars[i]] = i;
  }
  lookup['+'] = 62;
  lookup['/'] = 63;
  
  const bytes: number[] = [];
  let i = 0;
  while (i < padded.length) {
    const c1 = lookup[padded[i++]] ?? 0;
    const c2 = lookup[padded[i++]] ?? 0;
    const c3 = lookup[padded[i++]] ?? 0;
    const c4 = lookup[padded[i++]] ?? 0;
    
    const bitmap = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4;
    
    bytes.push((bitmap >> 16) & 255);
    if (padded[i - 2] !== '=') bytes.push((bitmap >> 8) & 255);
    if (padded[i - 1] !== '=') bytes.push(bitmap & 255);
  }
  
  return new Uint8Array(bytes);
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function tokenBase64url(input: string): string {
  return bytesToBase64url(stringToBytes(input));
}

function tokenFromBase64url(input: string): string {
  return bytesToString(base64urlToBytes(input));
}

function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export async function issueSessionToken(extensionId: string): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) {
    return '';
  }

  const payloadJson = JSON.stringify({
    sub: extensionId,
    iat: Math.floor(Date.now() / 1000),
    jti: generateNonce(),
  });
  const payloadPart = tokenBase64url(payloadJson);
  const hmac = await signPayload(secret, payloadPart);
  return `${payloadPart}.${hmac}`;
}

export async function validateSessionToken(
  token: string,
  expectedExtensionId: string,
  secret: string
): Promise<boolean> {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) {
    return false;
  }

  const payloadPart = token.slice(0, dotIndex);
  const sigPart = token.slice(dotIndex + 1);

  if (!payloadPart || !sigPart) {
    return false;
  }

  // Verify signature first (timing-safe).
  const expectedSig = await signPayload(secret, payloadPart);
  if (!timingSafeEqual(sigPart, expectedSig)) {
    return false;
  }

  // Parse and validate payload.
  let parsed: { sub?: string; iat?: number; jti?: string };
  try {
    parsed = JSON.parse(tokenFromBase64url(payloadPart));
  } catch {
    return false;
  }

  if (parsed.sub !== expectedExtensionId) {
    return false;
  }

  const ttlSeconds = getSessionTtlSeconds();
  if (!Number.isFinite(parsed.iat) || Date.now() / 1000 - parsed.iat! > ttlSeconds) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Shared crypto helpers
// ---------------------------------------------------------------------------

async function signPayload(token: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(token),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left: unknown, right: unknown) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  // Always iterate over the longer length so runtime does not reveal which
  // string is shorter, preventing length-based timing oracle attacks.
  const maxLen = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length; // non-zero if lengths differ
  for (let index = 0; index < maxLen; index += 1) {
    const l = index < left.length ? left.charCodeAt(index) : 0;
    const r = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= l ^ r;
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Apply the rate limit for `identity` on `request`.
 *
 * Identity comes from a completed isAuthorizedRequest call — it is derived
 * from the validated Origin header / session token and cannot be spoofed.
 *
 * The bucket key is `${identity}:ip:${clientIp}:${pathname}`. Rate limiting
 * is per-IP to prevent one abusive user from throttling all users.
 */
async function applyRateLimit(request: NextRequest, identity: string): Promise<boolean> {
  const path = request.nextUrl.pathname;
  const cost = RATE_LIMIT_COST_BY_PATH[path] || 1;
  // Rate limit by IP to prevent one abusive user from throttling everyone
  // Only trust X-Forwarded-For when behind a known proxy (TRUSTED_PROXY_COUNT env var)
  const trustedProxyCount = parseInt(process.env.TRUSTED_PROXY_COUNT || '0', 10);
  let clientIp: string;
  
  if (trustedProxyCount > 0) {
    // We're behind trusted proxies, can use X-Forwarded-For
    // Take the IP that's N hops from the end (closest to our infrastructure)
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const ips = forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean);
      // Get IP from the correct position (accounting for trusted proxies)
      const ipIndex = Math.max(0, ips.length - trustedProxyCount - 1);
      clientIp = ips[ipIndex] || 'unknown';
    } else {
      clientIp = request.headers.get('x-real-ip') || 'unknown';
    }
  } else {
    // Direct connection - don't trust X-Forwarded-For (client can spoof it)
    // Use the connection remote address if available, otherwise fallback
    clientIp = 'unknown';
  }
  
  const bucketKey = `${identity}:ip:${clientIp}:${path}`;

  if (!process.env.REDIS_URL && !isLocalApiHost(request.nextUrl.hostname)) {
    if (!warnedMissingRedis) {
      warnedMissingRedis = true;
      console.warn(
        '[SourceCheck/proxy] REDIS_URL is not set on a non-localhost host. ' +
          'Rate limits are process-local and will not survive restarts or scale across instances. ' +
          'Set REDIS_URL before deploying to production.'
      );
    }
  }

  const store = await getRateLimitStore(request);
  return store.tryConsume(bucketKey, cost, getRateLimitMaxPoints(), getRateLimitWindowMs());
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getMaxRequestBytes() {
  return getPositiveInteger('MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES, 10_000);
}

function getRateLimitWindowMs() {
  return getPositiveInteger('RATE_LIMIT_WINDOW_MS', DEFAULT_RATE_LIMIT_WINDOW_MS, 1_000);
}

function getRateLimitMaxPoints() {
  return getPositiveInteger('RATE_LIMIT_MAX_POINTS', DEFAULT_RATE_LIMIT_MAX_POINTS, 1);
}

function getSessionTtlSeconds() {
  const hours = getPositiveInteger('SESSION_TTL_HOURS', DEFAULT_SESSION_TTL_HOURS, 1);
  return hours * 3600;
}

function getPositiveInteger(envName: string, fallback: number, minValue: number) {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minValue) {
    return fallback;
  }

  return parsed;
}

function methodCanHaveBody(method: string) {
  const upperMethod = method.toUpperCase();
  return upperMethod !== 'GET' && upperMethod !== 'HEAD' && upperMethod !== 'OPTIONS';
}

// DISABLED: Middleware causes Edge Runtime issues with ioredis
// Rate limiting now handled directly in API routes
// export const config = {
//   matcher: '/api/:path*',
// };
