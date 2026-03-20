import { describe, expect, it } from 'vitest';

import { resolveDisplayAnalysisStatus } from '../../src/sidepanel/utils/displayAnalysisStatus';

describe('display analysis status resolver', () => {
  it('holds no-transcript when the worker briefly returns to loading with no recovered data', () => {
    expect(
      resolveDisplayAnalysisStatus({
        previousStatus: 'no-transcript',
        nextStatus: 'loading',
        sourceCardCount: 0,
        pendingClaimCount: 0,
        transcriptChunkCount: 0,
      })
    ).toBe('no-transcript');
  });

  it('allows loading to show when the UI has already moved off no-transcript for a retry', () => {
    expect(
      resolveDisplayAnalysisStatus({
        previousStatus: 'loading',
        nextStatus: 'loading',
        sourceCardCount: 0,
        pendingClaimCount: 0,
        transcriptChunkCount: 0,
      })
    ).toBe('loading');
  });

  it('releases the hold once transcript or claim data exists again', () => {
    expect(
      resolveDisplayAnalysisStatus({
        previousStatus: 'no-transcript',
        nextStatus: 'loading',
        sourceCardCount: 1,
        pendingClaimCount: 0,
        transcriptChunkCount: 0,
      })
    ).toBe('loading');
  });
});
