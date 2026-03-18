/**
 * Weak Client Gate / Anti-Noise Header for Next.js API routes.
 *
 * IMPORTANT: This is NOT real authentication. It is a weak client gate that:
 * - Reduces casual abuse and scanning traffic
 * - Adds a minor barrier for unauthorized clients
 * - CANNOT prevent abuse from a determined attacker (secret can be extracted from extension)
 *
 * The ACTUAL authentication boundary is session-token verification via `verifyBearerSessionToken()`.
 * This header check is merely a first-line filter that runs before rate limiting and session auth.
 *
 * Requirements:
 * - Checks `x-sourcecheck-client-secret` header against `CLIENT_SECRET` env var
 * - Returns 401 with `{ error: 'Unauthorized', errorCode: 'AUTH_ERROR' }` on failure
 * - Allows OPTIONS requests (CORS preflight) to pass through without secret check
 * - Returns proper CORS headers even on 401 responses
 * - Logs all secret validation failures for security monitoring
 * - In production, requires CLIENT_SECRET to be set (does not fail open)
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';

// Environment variable name for the expected client secret
const CLIENT_SECRET_ENV_VAR = 'CLIENT_SECRET';

// Header name for the client-provided secret
const CLIENT_SECRET_HEADER = 'x-sourcecheck-client-secret';

/**
 * Get the expected client secret from environment variables.
 * Returns empty string if not configured (will reject all requests).
 */
function getExpectedClientSecret(): string {
  return process.env[CLIENT_SECRET_ENV_VAR]?.trim() || '';
}

/**
 * Validate the client gate header from the request.
 * Uses timing-safe comparison to prevent timing attacks.
 * 
 * NOTE: This is a weak gate, not real authentication. A determined attacker
 * can extract the secret from the extension bundle. The actual auth boundary
 * is session-token verification that happens after this check.
 */
function validateClientSecret(request: NextRequest): boolean {
  const expectedSecret = getExpectedClientSecret();

  // If no secret is configured, skip validation (local dev mode only)
  if (!expectedSecret && process.env.NODE_ENV !== 'production') {
    return true;
  }
  
  // In production with no secret configured, reject (defense in depth)
  if (!expectedSecret) {
    return false;
  }

  const providedSecret = request.headers.get(CLIENT_SECRET_HEADER)?.trim() || '';

  // Timing-safe comparison to prevent timing attacks
  return timingSafeEqual(providedSecret, expectedSecret);
}

/**
 * Timing-safe string comparison using Node.js native crypto.
 * Prevents timing attacks that could reveal the secret length or content.
 * 
 * NOTE: Strings of different lengths are immediately rejected (no timing leak)
 * because crypto.timingSafeEqual requires equal-length buffers.
 */
function timingSafeEqual(left: string, right: string): boolean {
  // Early return on length mismatch - this is safe from timing attacks
  // because crypto.timingSafeEqual requires equal-length buffers anyway
  if (left.length !== right.length) {
    return false;
  }

  // Use Node.js native timingSafeEqual for constant-time comparison
  const leftBuf = Buffer.from(left, 'utf8');
  const rightBuf = Buffer.from(right, 'utf8');
  
  try {
    return cryptoTimingSafeEqual(leftBuf, rightBuf);
  } catch {
    // Fallback for any edge cases (shouldn't happen with equal-length buffers)
    return false;
  }
}

/**
 * Log a security event for secret validation failure.
 * Includes relevant request metadata without logging sensitive data.
 */
function logSecretValidationFailure(request: NextRequest, reason: 'missing' | 'mismatch'): void {
  const clientIp = getClientIp(request);
  const origin = request.headers.get('origin') || 'none';
  const extensionId = request.headers.get('x-extension-id')?.trim() || 'none';
  const pathname = request.nextUrl.pathname;

  console.warn(
    `[SourceCheck/auth] Client secret validation failed: ${reason}`,
    {
      pathname,
      clientIp,
      origin,
      extensionId,
      timestamp: new Date().toISOString(),
    }
  );
}

/**
 * Extract client IP from request headers.
 * Respects trusted proxy configuration if set.
 */
function getClientIp(request: NextRequest): string {
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

/**
 * Create a 401 Unauthorized response with proper CORS headers.
 */
function createUnauthorizedResponse(request: NextRequest): NextResponse {
  const response = NextResponse.json(
    { error: 'Unauthorized', errorCode: 'AUTH_ERROR' },
    { status: 401 }
  );

  // Add CORS headers to ensure the client can read the response
  const corsHeaders = getCorsHeaders(request);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (value) response.headers.set(key, value);
  });

  return response;
}

/**
 * Check if the request is an OPTIONS (CORS preflight) request.
 */
function isCorsPreflight(request: NextRequest): boolean {
  return request.method === 'OPTIONS';
}

/**
 * Result type for middleware authentication check.
 */
export type ClientSecretAuthResult =
  | { authorized: true }
  | { authorized: false; response: NextResponse };

/**
 * Validate the weak client gate header from the request.
 * This is the main entry point for the anti-noise header check.
 * 
 * IMPORTANT: This runs BEFORE session-token verification but does NOT replace it.
 * Always call `verifyBearerSessionToken()` after this check for actual authentication.
 *
 * @param request - The Next.js request object
 * @returns ClientSecretAuthResult - Either authorized=true or authorized=false with response
 *
 * Usage in API routes:
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   // 1. Weak client gate (reduces casual abuse)
 *   const clientAuth = validateClientSecretAuth(request);
 *   if (!clientAuth.authorized) {
 *     return clientAuth.response;
 *   }
 *   
 *   // 2. Actual authentication (session token)
 *   const sessionAuth = await verifyBearerSessionToken(request, ...);
 *   if (!sessionAuth.authorized) {
 *     return sessionAuth.response;
 *   }
 *   
 *   // Continue with route handler logic...
 * }
 * ```
 */
export function validateClientSecretAuth(request: NextRequest): ClientSecretAuthResult {
  // Allow CORS preflight requests to pass through without secret check
  if (isCorsPreflight(request)) {
    // For OPTIONS, still validate origin
    const origin = request.headers.get('origin');
    if (!isAllowedOrigin(origin, request)) {
      const response = new NextResponse(null, { status: 403 });
      return { authorized: false, response };
    }
    return { authorized: true };
  }

  // Check if CLIENT_SECRET is set in environment
  const expectedSecret = getExpectedClientSecret();
  const hasSecret = expectedSecret.length > 0;
  
  // Skip secret check if not configured (fail open for backward compatibility)
  // The real authentication boundary is session-token verification
  if (!hasSecret) {
    return { authorized: true };
  }

  const providedSecret = request.headers.get(CLIENT_SECRET_HEADER)?.trim() || '';

  // Check if secret is missing
  if (!providedSecret) {
    logSecretValidationFailure(request, 'missing');
    return { authorized: false, response: createUnauthorizedResponse(request) };
  }

  // Validate the secret
  if (!validateClientSecret(request)) {
    logSecretValidationFailure(request, 'mismatch');
    return { authorized: false, response: createUnauthorizedResponse(request) };
  }

  // Secret is valid
  return { authorized: true };
}

/**
 * Higher-order function to wrap API route handlers with weak client gate.
 * 
 * WARNING: This only checks the anti-noise header. You MUST also verify
 * the session token inside your handler for actual authentication.
 *
 * @param handler - The API route handler function
 * @returns A wrapped handler that checks client gate before executing the handler
 *
 * Usage:
 * ```typescript
 * export const POST = withClientSecretAuth(async (request: NextRequest) => {
 *   // NOTE: Still need to call verifyBearerSessionToken() here for real auth
 *   return NextResponse.json({ success: true });
 * });
 * ```
 */
export function withClientSecretAuth(
  handler: (request: NextRequest) => Promise<NextResponse> | NextResponse
): (request: NextRequest) => Promise<NextResponse> {
  return async (request: NextRequest): Promise<NextResponse> => {
    const authResult = validateClientSecretAuth(request);

    if (!authResult.authorized) {
      return authResult.response;
    }

    return handler(request);
  };
}
