import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  'chrome-extension://',
  'http://localhost:5173',
  'http://localhost:3000',
];

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed));
}

export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Extension-Id',
    'Access-Control-Max-Age': '86400',
  };
}

export function handleCors(request: NextRequest, response: NextResponse): NextResponse {
  const corsHeaders = getCorsHeaders(request);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export function corsOptionsResponse(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}
