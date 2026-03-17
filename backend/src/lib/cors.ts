import { NextRequest, NextResponse } from 'next/server';

// Allowed HTTP origins for local development
const ALLOWED_HTTP_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

/**
 * Get allowed extension IDs from environment variable.
 * Format: comma-separated list of extension IDs
 */
function getAllowedExtensionIds(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EXTENSION_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

/**
 * Check if running on localhost (dev environment).
 */
function isLocalhost(request: NextRequest): boolean {
  const hostname = request.headers.get('host')?.split(':')[0] || request.nextUrl.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Validate if an origin is allowed.
 * 
 * For chrome-extension:// origins, requires the extension ID to be in the
 * ALLOWED_EXTENSION_IDS allowlist (or allows any on localhost for dev).
 * 
 * For HTTP origins, only allows localhost development servers.
 */
export function isAllowedOrigin(origin: string | null, request: NextRequest): boolean {
  if (!origin) return false;

  // Chrome extension origins
  if (origin.startsWith('chrome-extension://')) {
    const extensionId = origin.slice('chrome-extension://'.length);
    if (!extensionId) return false;

    const allowedIds = getAllowedExtensionIds();
    if (allowedIds.size > 0) {
      return allowedIds.has(extensionId);
    }

    // No allowlist configured - only allow on localhost for dev
    return isLocalhost(request);
  }

  // HTTP origins - only allow localhost for development
  return ALLOWED_HTTP_ORIGINS.some(allowed => origin === allowed);
}

export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin') || '';
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

export function handleCors(request: NextRequest, response: NextResponse): NextResponse {
  const corsHeaders = getCorsHeaders(request);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (value) response.headers.set(key, value);
  });
  return response;
}

export function corsOptionsResponse(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  
  if (!origin || !isAllowedOrigin(origin, request)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}
