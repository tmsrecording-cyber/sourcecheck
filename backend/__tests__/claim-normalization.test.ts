import { describe, expect, it } from 'vitest';
import { normalizeExtractedClaim } from '../src/lib/claim-normalization';

describe('claim normalization', () => {
  it('preserves negation and structures quantity/time fields', () => {
    const normalized = normalizeExtractedClaim({
      claimText: 'The Department of Homeland Security was not in a funding shutdown for 40 days in March 2026.',
      claimType: 'historical',
    });

    expect(normalized.normalizedClaimText).toBe(
      'The Department of Homeland Security was not in a funding shutdown for 40 days in March 2026.'
    );
    expect(normalized.claimFeatures.polarity).toBe('negated');
    expect(normalized.claimFeatures.quantityRaw).toBe('40 days');
    expect(normalized.claimFeatures.quantityValue).toBe(40);
    expect(normalized.claimFeatures.quantityUnit).toBe('days');
    expect(normalized.claimFeatures.dateOrPeriodRaw).toBe('March 2026');
    expect(normalized.claimFeatures.dateOrPeriodNormalized).toBe('2026-march');
    expect(normalized.claimFeatures.timeSensitivity).toBe('time_bound');
  });

  it('marks predictive rhetoric as low checkworthiness', () => {
    const normalized = normalizeExtractedClaim({
      claimText: 'I think the economy will collapse tomorrow.',
      claimType: 'surprising',
    });

    expect(normalized.claimFeatures.polarity).toBe('affirmed');
    expect(normalized.claimFeatures.timeSensitivity).toBe('breaking');
    expect(normalized.checkworthiness).toBeLessThan(0.4);
  });

  it('captures approximate quantity operators', () => {
    const normalized = normalizeExtractedClaim({
      claimText: 'The Department of Homeland Security was in a funding shutdown for nearly 40 days in March 2026.',
      claimType: 'historical',
    });

    expect(normalized.claimFeatures.quantityRaw).toBe('40 days');
    expect(normalized.claimFeatures.quantityValue).toBe(40);
    expect(normalized.claimFeatures.comparisonOperator).toBe('approx');
  });

  it('preserves percentage-point units distinctly from percent', () => {
    const normalized = normalizeExtractedClaim({
      claimText: 'Inflation fell by 5 percentage points in 2026.',
      claimType: 'statistic',
    });

    expect(normalized.claimFeatures.quantityRaw).toBe('5 percentage points');
    expect(normalized.claimFeatures.quantityValue).toBe(5);
    expect(normalized.claimFeatures.quantityUnit).toBe('percentage points');
  });

  it('normalizes quarter-based time windows', () => {
    const normalized = normalizeExtractedClaim({
      claimText: 'Revenue rose by 12 percent in Q1 2026.',
      claimType: 'statistic',
    });

    expect(normalized.claimFeatures.dateOrPeriodRaw).toBe('Q1 2026');
    expect(normalized.claimFeatures.dateOrPeriodNormalized).toBe('2026-q1');
    expect(normalized.claimFeatures.timeSensitivity).toBe('time_bound');
  });

  it('treats relative quarter phrasing as time-bound', () => {
    const normalized = normalizeExtractedClaim({
      claimText: 'Revenue rose last quarter.',
      claimType: 'statistic',
    });

    expect(normalized.claimFeatures.dateOrPeriodRaw).toBe('last quarter');
    expect(normalized.claimFeatures.dateOrPeriodNormalized).toBe('last quarter');
    expect(normalized.claimFeatures.timeSensitivity).toBe('time_bound');
  });
});
