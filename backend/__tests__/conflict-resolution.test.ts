import { describe, expect, it } from 'vitest';
import { resolveVerificationConflict, type ConflictCandidate } from '../src/lib/conflict-resolution';

const makeCandidate = (overrides: Partial<ConflictCandidate> = {}): ConflictCandidate => ({
  origin: 'claimreview',
  status: 'disputed',
  claimText: 'A closely matching claim',
  sourceTitle: 'Reuters fact check',
  sourceLabel: 'Reuters',
  confidence: 0.95,
  matchType: 'exact_truth_conditions',
  freshnessClass: 'fresh',
  ...overrides,
});

describe('conflict resolution', () => {
  it('downgrades to partial when fresh exact prior evidence conflicts with a confident live result', () => {
    const decision = resolveVerificationConflict({
      liveStatus: 'supported',
      liveHasQualityGrounding: true,
      candidates: [makeCandidate()],
    });

    expect(decision.status).toBe('partial');
    expect(decision.conflictDetected).toBe(true);
    expect(decision.reason).toBe('fresh_exact_conflict_requires_partial');
    expect(decision.overrideNuance).toContain('published fact-check');
  });

  it('keeps the live result when the conflict is stale but still surfaces context', () => {
    const decision = resolveVerificationConflict({
      liveStatus: 'disputed',
      liveHasQualityGrounding: true,
      candidates: [
        makeCandidate({
          origin: 'internal_memory',
          status: 'supported',
          sourceLabel: 'Earlier coverage',
          freshnessClass: 'stale',
        }),
      ],
    });

    expect(decision.status).toBe('disputed');
    expect(decision.conflictDetected).toBe(true);
    expect(decision.reason).toBe('conflict_noted_live_result_retained');
    expect(decision.contradictionContext).toContain('Earlier coverage');
  });
});
