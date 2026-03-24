import { describe, expect, it } from 'vitest';
import type { ClaimFeatureVector, ExtractedClaim } from '../src/types/shared';
import { evaluateInternalClaimMatch } from '../src/lib/claim-matching';

const baseFeatures = (
  overrides: Partial<ClaimFeatureVector> = {},
): ClaimFeatureVector => ({
  speaker: null,
  attributedEntity: null,
  subject: 'The Department of Homeland Security',
  predicate: 'was in',
  object: 'a funding shutdown',
  polarity: 'affirmed',
  quantityRaw: '40 days',
  quantityValue: 40,
  quantityUnit: 'days',
  comparisonOperator: 'eq',
  dateOrPeriodRaw: 'March 2026',
  dateOrPeriodNormalized: '2026-march',
  timeSensitivity: 'time_bound',
  location: null,
  topicTags: ['government'],
  attributionType: 'speaker_assertion',
  ...overrides,
});

const makeClaim = (featureOverrides: Partial<ClaimFeatureVector> = {}): ExtractedClaim => ({
  claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
  claimType: 'historical',
  timestampSeconds: 24,
  normalizedClaimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
  checkworthiness: 0.9,
  normalizationVersion: 1,
  claimFeatures: baseFeatures(featureOverrides),
});

const makeClaimWithText = (
  claimText: string,
  featureOverrides: Partial<ClaimFeatureVector> = {},
): ExtractedClaim => ({
  ...makeClaim(featureOverrides),
  claimText,
  normalizedClaimText: claimText,
});

const makeCandidate = (
  featureOverrides: Partial<ClaimFeatureVector> = {},
  claimText = 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
) => ({
  claimText,
  normalizedClaimText: claimText,
  claimFeatures: baseFeatures(featureOverrides),
  verifiedAt: '2026-03-23T18:00:00.000Z',
});

describe('claim matching', () => {
  it('treats approximate quantities within tolerance as compatible', () => {
    const currentClaim = makeClaim({
      quantityRaw: 'nearly 40 days',
      comparisonOperator: 'approx',
    });

    const evaluation = evaluateInternalClaimMatch({
      currentClaim,
      candidate: makeCandidate({
        quantityRaw: '38 days',
        quantityValue: 38,
        comparisonOperator: 'eq',
      }),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).not.toContain('quantity_mismatch');
    expect(evaluation.matchType).toBe('exact_truth_conditions');
    expect(evaluation.confidence).toBeGreaterThanOrEqual(0.92);
  });

  it('blocks exact quantity contradictions', () => {
    const evaluation = evaluateInternalClaimMatch({
      currentClaim: makeClaim(),
      candidate: makeCandidate({
        quantityRaw: '38 days',
        quantityValue: 38,
        comparisonOperator: 'eq',
      }),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).toContain('quantity_mismatch');
    expect(evaluation.matchType).toBe('reject');
  });

  it('treats aligned year and month windows as compatible', () => {
    const evaluation = evaluateInternalClaimMatch({
      currentClaim: makeClaim({
        dateOrPeriodRaw: '2026',
        dateOrPeriodNormalized: '2026',
      }),
      candidate: makeCandidate(),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).not.toContain('date_mismatch');
    expect(evaluation.matchType).toBe('exact_truth_conditions');
    expect(evaluation.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('blocks contradictory month windows', () => {
    const evaluation = evaluateInternalClaimMatch({
      currentClaim: makeClaim(),
      candidate: makeCandidate({
        dateOrPeriodRaw: 'April 2026',
        dateOrPeriodNormalized: '2026-april',
      }),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).toContain('date_mismatch');
    expect(evaluation.matchType).toBe('reject');
  });

  it('blocks percent and percentage-point mismatches', () => {
    const evaluation = evaluateInternalClaimMatch({
      currentClaim: makeClaim({
        quantityRaw: '5 percent',
        quantityValue: 5,
        quantityUnit: 'percent',
      }),
      candidate: makeCandidate({
        quantityRaw: '5 percentage points',
        quantityValue: 5,
        quantityUnit: 'percentage points',
      }),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).toContain('quantity_mismatch');
    expect(evaluation.matchType).toBe('reject');
  });

  it('treats relative-vs-explicit time as non-blocking context instead of contradiction', () => {
    const evaluation = evaluateInternalClaimMatch({
      currentClaim: makeClaimWithText(
        'The Department of Homeland Security was in a funding shutdown for 40 days during his presidency.',
        {
          dateOrPeriodRaw: 'during his presidency',
          dateOrPeriodNormalized: 'during his presidency',
        },
      ),
      candidate: makeCandidate(),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).not.toContain('date_mismatch');
    expect(evaluation.matchType).toBe('near_duplicate');
  });

  it('treats aligned quarter and month windows as compatible', () => {
    const evaluation = evaluateInternalClaimMatch({
      currentClaim: makeClaim({
        dateOrPeriodRaw: 'Q1 2026',
        dateOrPeriodNormalized: '2026-q1',
      }),
      candidate: makeCandidate(),
      vectorSimilarity: 0.97,
    });

    expect(evaluation.hardBlockers).not.toContain('date_mismatch');
    expect(evaluation.matchType).toBe('exact_truth_conditions');
    expect(evaluation.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
