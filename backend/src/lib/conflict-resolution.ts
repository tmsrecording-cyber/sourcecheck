import type { KnownClaimMatchSummary, VerificationStatus } from '@/types/shared';

type MatchType = KnownClaimMatchSummary['matchType'];
type FreshnessClass = NonNullable<KnownClaimMatchSummary['freshnessClass']>;

export type ConflictCandidate = {
  origin: 'internal_memory' | 'claimreview';
  status: VerificationStatus;
  claimText: string;
  sourceTitle: string;
  sourceLabel: string;
  confidence: number;
  matchType: MatchType;
  freshnessClass: FreshnessClass;
};

export type ConflictResolutionDecision = {
  status: VerificationStatus;
  conflictDetected: boolean;
  reason: string;
  contradictionContext?: string;
  overrideNuance?: string;
};

const STATUS_STRENGTH: Record<VerificationStatus, number> = {
  supported: 3,
  partial: 2,
  disputed: 1,
  unverifiable: 0,
};

const isMeaningfulConflict = (left: VerificationStatus, right: VerificationStatus) => {
  if (left === right) return false;
  return Math.abs(STATUS_STRENGTH[left] - STATUS_STRENGTH[right]) >= 2;
};

const candidatePriority = (candidate: ConflictCandidate) => {
  const matchWeight =
    candidate.matchType === 'exact_truth_conditions'
      ? 3
      : candidate.matchType === 'near_duplicate'
        ? 2
        : 1;
  const freshnessWeight =
    candidate.freshnessClass === 'fresh'
      ? 2
      : candidate.freshnessClass === 'evergreen'
        ? 1.5
        : 1;
  const originWeight = candidate.origin === 'claimreview' ? 0.25 : 0;
  return (matchWeight * 10) + (freshnessWeight * 5) + candidate.confidence + originWeight;
};

const buildContradictionContext = (
  candidate: ConflictCandidate,
  liveStatus: VerificationStatus,
) => {
  const priorStatus = candidate.status.toUpperCase();
  if (candidate.origin === 'claimreview') {
    return `A published fact-check from "${candidate.sourceLabel}" rated a closely matching claim as ${priorStatus}, while this live verification landed on ${liveStatus.toUpperCase()}.`;
  }

  return `A previous SourceCheck result from "${candidate.sourceLabel}" rated a closely matching claim as ${priorStatus}, while this live verification landed on ${liveStatus.toUpperCase()}.`;
};

const buildOverrideNuance = (candidate: ConflictCandidate) =>
  candidate.origin === 'claimreview'
    ? 'Fresh evidence and a published fact-check point in different directions on this claim.'
    : 'Fresh evidence and an earlier closely matching SourceCheck result point in different directions.';

export function resolveVerificationConflict(params: {
  liveStatus: VerificationStatus;
  liveHasQualityGrounding: boolean;
  candidates: ConflictCandidate[];
}): ConflictResolutionDecision {
  const conflictingCandidates = params.candidates
    .filter((candidate) => isMeaningfulConflict(params.liveStatus, candidate.status))
    .sort((left, right) => candidatePriority(right) - candidatePriority(left));

  const strongestConflict = conflictingCandidates[0];
  if (!strongestConflict) {
    return {
      status: params.liveStatus,
      conflictDetected: false,
      reason: 'no_material_conflict',
    };
  }

  const contradictionContext = buildContradictionContext(strongestConflict, params.liveStatus);

  if (
    (params.liveStatus === 'supported' || params.liveStatus === 'disputed') &&
    (
      (strongestConflict.matchType === 'exact_truth_conditions' && strongestConflict.freshnessClass === 'fresh') ||
      !params.liveHasQualityGrounding
    )
  ) {
    return {
      status: 'partial',
      conflictDetected: true,
      reason: strongestConflict.freshnessClass === 'fresh'
        ? 'fresh_exact_conflict_requires_partial'
        : 'weak_live_grounding_conflict_requires_partial',
      contradictionContext,
      overrideNuance: buildOverrideNuance(strongestConflict),
    };
  }

  return {
    status: params.liveStatus,
    conflictDetected: true,
    reason: 'conflict_noted_live_result_retained',
    contradictionContext,
  };
}
