import { afterEach, describe, expect, it } from 'vitest';

import {
  clearEventBuffer,
  getRecentEvents,
  logRouteFailure,
  logVerificationResolution,
} from '../src/lib/observability';

describe('observability', () => {
  afterEach(() => {
    clearEventBuffer();
  });

  it('buffers verification resolution events with match metadata', () => {
    logVerificationResolution({
      resolutionPath: 'claimreview_match',
      resolutionSource: 'claimreview',
      status: 'supported',
      conflictDetected: false,
      matchOrigin: 'claimreview',
      matchType: 'exact_truth_conditions',
      freshnessClass: 'fresh',
      context: 'publisher=Reuters',
    });

    const [event] = getRecentEvents(1);
    expect(event).toMatchObject({
      name: 'verification_resolution',
      route: '/api/verify-claim',
      resolutionPath: 'claimreview_match',
      resolutionSource: 'claimreview',
      status: 'supported',
      conflictDetected: false,
      matchOrigin: 'claimreview',
      matchType: 'exact_truth_conditions',
      freshnessClass: 'fresh',
      context: 'publisher=Reuters',
    });
  });

  it('keeps failure and resolution events together in the same ring buffer', () => {
    logRouteFailure({
      route: '/api/verify-claim',
      category: 'rate_limited',
      statusCode: 429,
      retryable: true,
      context: 'retryAfter=60',
    });
    logVerificationResolution({
      resolutionPath: 'live_grounded',
      resolutionSource: 'live_grounded',
      status: 'partial',
      conflictDetected: true,
      conflictReason: 'fresh_exact_conflict_requires_partial',
      context: 'quality_grounding=true, sources=3',
    });

    const events = getRecentEvents(2);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      name: 'route_failure',
      category: 'rate_limited',
      statusCode: 429,
    });
    expect(events[1]).toMatchObject({
      name: 'verification_resolution',
      conflictDetected: true,
      conflictReason: 'fresh_exact_conflict_requires_partial',
      status: 'partial',
    });
  });
});
