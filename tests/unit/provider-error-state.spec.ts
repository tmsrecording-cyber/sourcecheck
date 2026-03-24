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
  });
});
