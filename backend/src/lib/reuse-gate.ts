import type { VerificationStatus } from '@/types/shared';
import type { ExternalMatchEvaluation, InternalMatchEvaluation } from './claim-matching';

export type ReuseDecision = {
  decision: 'reuse' | 'context_only' | 'fresh_verify';
  reason: string;
  confidence: number;
  freshnessClass: InternalMatchEvaluation['freshnessClass'];
  hardBlockers: string[];
};

export function decideInternalReuse(params: {
  match: InternalMatchEvaluation;
  priorStatus: VerificationStatus;
}): ReuseDecision {
  const { match, priorStatus } = params;

  if (priorStatus === 'unverifiable') {
    return {
      decision: 'fresh_verify',
      reason: 'prior_status_unverifiable',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: [...match.hardBlockers, 'prior_status_unverifiable'],
    };
  }

  if (match.hardBlockers.length > 0) {
    return {
      decision: 'fresh_verify',
      reason: `hard_blockers:${match.hardBlockers.join(',')}`,
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (match.freshnessClass === 'stale') {
    return {
      decision: match.matchType === 'reject' ? 'fresh_verify' : 'context_only',
      reason: match.matchType === 'reject'
        ? 'stale_match_below_context_threshold'
        : 'stale_match_context_only',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (match.matchType === 'exact_truth_conditions' && match.confidence >= 0.9) {
    return {
      decision: 'reuse',
      reason: 'exact_truth_condition_match',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (
    (match.matchType === 'near_duplicate' && match.confidence >= 0.75) ||
    match.matchType === 'related_context'
  ) {
    return {
      decision: 'context_only',
      reason: 'related_but_not_safe_to_reuse',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  return {
    decision: 'fresh_verify',
    reason: 'match_below_reuse_threshold',
    confidence: match.confidence,
    freshnessClass: match.freshnessClass,
    hardBlockers: match.hardBlockers,
  };
}

export function decideClaimReviewReuse(params: {
  match: ExternalMatchEvaluation;
  hasMappedVerdict: boolean;
}): ReuseDecision {
  const { match, hasMappedVerdict } = params;

  if (match.hardBlockers.length > 0) {
    return {
      decision: 'fresh_verify',
      reason: `hard_blockers:${match.hardBlockers.join(',')}`,
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (!hasMappedVerdict) {
    return {
      decision: match.matchType === 'reject' ? 'fresh_verify' : 'context_only',
      reason: match.matchType === 'reject' ? 'claimreview_missing_verdict' : 'claimreview_context_only_missing_verdict',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (match.freshnessClass === 'stale') {
    return {
      decision: match.matchType === 'reject' ? 'fresh_verify' : 'context_only',
      reason: match.matchType === 'reject'
        ? 'stale_claimreview_match_below_context_threshold'
        : 'stale_claimreview_context_only',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (match.matchType === 'exact_truth_conditions' && match.confidence >= 0.92) {
    return {
      decision: 'reuse',
      reason: 'claimreview_exact_truth_condition_match',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  if (
    (match.matchType === 'near_duplicate' && match.confidence >= 0.8) ||
    match.matchType === 'related_context'
  ) {
    return {
      decision: 'context_only',
      reason: 'claimreview_related_but_not_safe_to_reuse',
      confidence: match.confidence,
      freshnessClass: match.freshnessClass,
      hardBlockers: match.hardBlockers,
    };
  }

  return {
    decision: 'fresh_verify',
    reason: 'claimreview_match_below_reuse_threshold',
    confidence: match.confidence,
    freshnessClass: match.freshnessClass,
    hardBlockers: match.hardBlockers,
  };
}
