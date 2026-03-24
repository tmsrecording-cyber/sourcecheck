import { describe, expect, it } from 'vitest';

import { INITIAL_RUNTIME_STATE, sanitizeWorkerRuntimeState } from '../../src/sidepanel/utils/state';

describe('worker runtime provider error state', () => {
  it('restores a persisted provider error from runtime state', () => {
    const runtimeState = sanitizeWorkerRuntimeState({
      ...INITIAL_RUNTIME_STATE,
      lastProviderError: {
        code: 'QUOTA_EXHAUSTED',
        message: 'API quota exhausted. Try again later or use your own API key.',
      },
    });

    expect(runtimeState.lastProviderError).toEqual({
      code: 'QUOTA_EXHAUSTED',
      message: 'API quota exhausted. Try again later or use your own API key.',
    });
  });

  it('drops malformed provider error payloads during hydration', () => {
    const runtimeState = sanitizeWorkerRuntimeState({
      ...INITIAL_RUNTIME_STATE,
      lastProviderError: 'bad-payload',
    });

    expect(runtimeState.lastProviderError).toBeNull();
  });

  it('sanitizes debug metrics during hydration', () => {
    const runtimeState = sanitizeWorkerRuntimeState({
      ...INITIAL_RUNTIME_STATE,
      allPendingClaims: [
        {
          id: 'claim-1',
          claimText: 'The Apple I shipped with 4 KB of memory.',
          claimType: 'historical',
          timestampSeconds: 236,
          confidence: 0.82,
          state: 'verifying',
          normalizedClaimText: 'the apple i shipped with 4 kb of memory',
        },
      ],
      debugMetrics: {
        verifyStarted: 4,
        verifySucceeded: 3,
        clusterSuppressions: 1,
        resolutionPathCounts: {
          live_grounded: 2,
          cached_exact: 1,
          invalid: 'bad',
        },
      },
    });

    expect(runtimeState.debugMetrics.verifyStarted).toBe(4);
    expect(runtimeState.debugMetrics.verifySucceeded).toBe(3);
    expect(runtimeState.debugMetrics.clusterSuppressions).toBe(1);
    expect(runtimeState.debugMetrics.resolutionPathCounts).toEqual({
      live_grounded: 2,
      cached_exact: 1,
    });
    expect(runtimeState.allPendingClaims).toHaveLength(1);
    expect(runtimeState.allPendingClaims[0]?.state).toBe('verifying');
  });
});
