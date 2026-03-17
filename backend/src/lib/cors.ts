import { NextRequest, NextResponse } from 'next/server';

// Added YouTube to the allowed origins
const ALLOWED_HTTP_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://www.youtube.com',
  'https://youtube.com'
];

function getAllowedExtensionIds(): Set<string> {
  return new Set(
    (process.env.ALLOWED_EXTENSION_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function isLocalhost(request: NextRequest): boolean {
  const hostname = request.headers.get('host')?.split(':')[0] || request.nextUrl.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function isAllowedOrigin(origin: string | null, request: NextRequest): boolean {
  // 1. Allow Postman/curl requests without an origin during dev
  if (!origin && isLocalhost(request)) return true;
  if (!origin) return false;

  // 2. Chrome extension origins
  if (origin.startsWith('chrome-extension://')) {
    // If we are developing locally, let ANY chrome extension talk to the API.
    // Unpacked extension IDs change frequently, this stops the headache.
    if (isLocalhost(request)) return true;

    const extensionId = origin.slice('chrome-extension://'.length);
    const allowedIds = getAllowedExtensionIds();
    return allowedIds.has(extensionId);
  }

  // 3. HTTP origins (now includes YouTube)
  return ALLOWED_HTTP_ORIGINS.some(allowed => origin === allowed);
}

export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin') || '*'; // Fallback to * for dev
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

  if (origin === '*' || isAllowedOrigin(origin, request)) {
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
  
  if (!isAllowedOrigin(origin, request)) {
    return new NextResponse(null, { status: 403 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}
