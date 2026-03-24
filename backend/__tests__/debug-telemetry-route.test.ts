import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../src/app/api/debug/telemetry/route';
import {
  clearEventBuffer,
  logRouteFailure,
  logVerificationResolution,
} from '../src/lib/observability';

describe('/api/debug/telemetry route', () => {
  afterEach(() => {
    clearEventBuffer();
    vi.unstubAllEnvs();
  });

  it('returns buffered telemetry in development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    logRouteFailure({
      route: '/api/verify-claim',
      category: 'rate_limited',
      statusCode: 429,
      retryable: true,
      context: 'retryAfter=60',
    });
    logVerificationResolution({
      resolutionPath: 'cached_exact',
      resolutionSource: 'internal_memory',
      status: 'supported',
      conflictDetected: false,
      matchOrigin: 'internal_memory',
      matchType: 'exact_truth_conditions',
      freshnessClass: 'fresh',
    });

    const response = await GET(new Request('http://localhost:3000/api/debug/telemetry?limit=10') as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.counts.total).toBe(2);
    expect(body.counts.byName.route_failure).toBe(1);
    expect(body.counts.byName.verification_resolution).toBe(1);
    expect(body.counts.byResolutionPath.cached_exact).toBe(1);
    expect(body.events).toHaveLength(2);
  });

  it('clears the telemetry buffer when requested', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    logVerificationResolution({
      resolutionPath: 'live_grounded',
      resolutionSource: 'live_grounded',
      status: 'partial',
      conflictDetected: false,
    });

    const clearResponse = await GET(new Request('http://localhost:3000/api/debug/telemetry?action=clear') as never);
    const clearBody = await clearResponse.json();
    expect(clearResponse.status).toBe(200);
    expect(clearBody).toEqual({ cleared: true });

    const response = await GET(new Request('http://localhost:3000/api/debug/telemetry') as never);
    const body = await response.json();
    expect(body.counts.total).toBe(0);
  });

  it('requires DEBUG_TOKEN outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEBUG_TOKEN', 'secret-token');

    const unauthorized = await GET(new Request('https://example.com/api/debug/telemetry') as never);
    expect(unauthorized.status).toBe(401);

    const authorized = await GET(new Request('https://example.com/api/debug/telemetry?token=secret-token') as never);
    expect(authorized.status).toBe(200);
  });
});
