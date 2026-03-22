import { NextRequest, NextResponse } from 'next/server';
import { issueSessionToken } from '@/proxy';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import { logSessionInitFailure } from '@/lib/observability';
import { validateClientSecretAuth } from '@/lib/client-secret-auth';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';

// POST /api/session/init
//
// Exchanges a validated extension ID for a backend-signed session token.
// Auth is handled upstream by proxy.ts: the extension ID must be in
// ALLOWED_EXTENSION_IDS and this path is exempt from the bearer token
// requirement (it is the issuance point).
//
// Returns { token: string } — empty string when SESSION_SECRET is not
// configured (local dev without a secret, proxy still allows the call through).

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin, request)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  // Pre-shared client secret authentication (additional layer)
  const clientSecretAuth = validateClientSecretAuth(request);
  if (!clientSecretAuth.authorized) {
    return clientSecretAuth.response;
  }

  // Rate limit: 20 requests per minute per IP for session init
  // This prevents token issuance flooding attacks
  const rateLimitResult = await checkRateLimit(request, 'session-init');
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(request, rateLimitResult.retryAfter);
  }

  const body = await request.json().catch(() => null);

  if (!body || typeof body.extensionId !== 'string' || !body.extensionId.trim()) {
    logSessionInitFailure({
      category: 'validation_error',
      statusCode: 400,
      context: 'missing or invalid extensionId',
    });
    const response = NextResponse.json({ error: 'extensionId is required.' }, { status: 400 });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }

  const extensionId = body.extensionId.trim();

  // Re-validate that the claimed extensionId matches the identity the proxy
  // already verified. The proxy derives identity from Origin / X-Extension-Id
  // before this handler runs; we check consistency here as defence-in-depth.
  const headerExtensionId = request.headers.get('x-extension-id')?.trim() || '';
  if (headerExtensionId && headerExtensionId !== extensionId) {
    logSessionInitFailure({
      category: 'auth_error',
      statusCode: 403,
      context: 'extensionId header/body mismatch',
    });
    const response = NextResponse.json({ error: 'extensionId mismatch.' }, { status: 403 });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }

  const token = await issueSessionToken(extensionId);

  // Log if token issuance failed (e.g., missing SESSION_SECRET on non-localhost)
  if (!token && process.env.SESSION_SECRET) {
    logSessionInitFailure({
      category: 'internal_error',
      context: 'token issuance failed despite SESSION_SECRET present',
    });
  }

  const response = NextResponse.json({ token });
  Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
