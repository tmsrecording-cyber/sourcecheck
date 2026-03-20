import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';

import { getCorsHeaders } from '../src/lib/cors';

function makeRequest(
  url: string,
  headers: Record<string, string> = {}
): NextRequest {
  const parsed = new URL(url);
  return {
    headers: new Headers(headers),
    nextUrl: { hostname: parsed.hostname, pathname: parsed.pathname },
  } as unknown as NextRequest;
}

describe('CORS headers', () => {
  it('allows the client secret header for extension requests', () => {
    const request = makeRequest('http://localhost:3000/api/session/init', {
      origin: 'chrome-extension://test-extension-id',
      host: 'localhost:3000',
    });

    const headers = getCorsHeaders(request);

    expect(headers['Access-Control-Allow-Headers']).toContain('X-SourceCheck-Client-Secret');
  });
});
