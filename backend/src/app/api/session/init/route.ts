import { NextRequest, NextResponse } from 'next/server';
import { issueSessionToken } from '@/proxy';

// POST /api/session/init
//
// Exchanges a validated extension ID for a backend-signed session token.
// Auth is handled upstream by proxy.ts: the extension ID must be in
// ALLOWED_EXTENSION_IDS and this path is exempt from the bearer token
// requirement (it is the issuance point).
//
// Returns { token: string } — empty string when SESSION_SECRET is not
// configured (local dev without a secret, proxy still allows the call through).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body.extensionId !== 'string' || !body.extensionId.trim()) {
    return NextResponse.json({ error: 'extensionId is required.' }, { status: 400 });
  }

  const extensionId = body.extensionId.trim();

  // Re-validate that the claimed extensionId matches the identity the proxy
  // already verified. The proxy derives identity from Origin / X-Extension-Id
  // before this handler runs; we check consistency here as defence-in-depth.
  const headerExtensionId = request.headers.get('x-extension-id')?.trim() || '';
  if (headerExtensionId && headerExtensionId !== extensionId) {
    return NextResponse.json({ error: 'extensionId mismatch.' }, { status: 403 });
  }

  const token = await issueSessionToken(extensionId);

  return NextResponse.json({ token });
}
