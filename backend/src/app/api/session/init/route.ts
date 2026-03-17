import { NextRequest, NextResponse } from 'next/server';
import { issueSessionToken } from '@/proxy';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';

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
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.extensionId !== 'string' || !body.extensionId.trim()) {
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
    const response = NextResponse.json({ error: 'extensionId mismatch.' }, { status: 403 });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }

  const token = await issueSessionToken(extensionId);

  const response = NextResponse.json({ token });
  Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
