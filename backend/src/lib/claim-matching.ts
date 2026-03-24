import type {
  ClaimFeatureVector,
  ExtractedClaim,
  KnownClaimMatchSummary,
} from '@/types/shared';

type MatchType = KnownClaimMatchSummary['matchType'] | 'reject';
type FreshnessClass = NonNullable<KnownClaimMatchSummary['freshnessClass']>;
type QuantityComparison = { score: number; contradiction: boolean };
type TimeComparison = { score: number; contradiction: boolean };
type ParsedTimeWindow =
  | { kind: 'year'; start: number; end: number; normalized: string }
  | { kind: 'quarter'; start: number; end: number; normalized: string }
  | { kind: 'month'; start: number; end: number; normalized: string }
  | { kind: 'relative'; normalized: string };

export type StoredClaimMatchCandidate = {
  claimText: string;
  normalizedClaimText?: string;
  claimFeatures?: ClaimFeatureVector;
  verifiedAt: string;
};

export type InternalMatchEvaluation = {
  origin: 'internal_memory';
  matchType: MatchType;
  confidence: number;
  canonicalClaimText: string;
  freshnessClass: FreshnessClass;
  hardBlockers: string[];
};

export type ExternalMatchEvaluation = {
  origin: 'claimreview';
  matchType: MatchType;
  confidence: number;
  canonicalClaimText: string;
  freshnessClass: FreshnessClass;
  hardBlockers: string[];
};

const normalize = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const tokenize = (value: string) =>
  normalize(value).split(' ').filter(Boolean);

const jaccard = (left: string | null | undefined, right: string | null | undefined) => {
  const leftTokens = new Set(tokenize(left || ''));
  const rightTokens = new Set(tokenize(right || ''));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });

  const unionTokens = new Set<string>();
  leftTokens.forEach((token) => unionTokens.add(token));
  rightTokens.forEach((token) => unionTokens.add(token));
  const union = unionTokens.size;
  return union === 0 ? 0 : intersection / union;
};

const binaryAgreement = (left: string | null | undefined, right: string | null | undefined) => {
  if (!left || !right) return 0;
  return normalize(left) === normalize(right) ? 1 : 0;
};

const normalizeUnit = (value: string | null | undefined) => {
  const normalized = normalize(value);
  if (!normalized) return null;
  if (normalized === 'percentage point' || normalized === 'percentage points') return 'percentage_points';
  if (normalized === '%' || normalized === 'percent') return 'percent';
  if (normalized === 'dollar' || normalized === 'dollars') return 'dollars';
  if (normalized === 'day' || normalized === 'days') return 'days';
  if (normalized === 'year' || normalized === 'years') return 'years';
  if (normalized === 'vote' || normalized === 'votes') return 'votes';
  if (normalized === 'person' || normalized === 'people') return 'people';
  return normalized;
};

const toRange = (
  value: number,
  operator: ClaimFeatureVector['comparisonOperator'],
): { min: number; max: number; openMin: boolean; openMax: boolean } => {
  switch (operator) {
    case 'approx':
      return {
        min: value * 0.95,
        max: value * 1.05,
        openMin: false,
        openMax: false,
      };
    case 'gt':
      return { min: value, max: Number.POSITIVE_INFINITY, openMin: true, openMax: false };
    case 'gte':
      return { min: value, max: Number.POSITIVE_INFINITY, openMin: false, openMax: false };
    case 'lt':
      return { min: Number.NEGATIVE_INFINITY, max: value, openMin: false, openMax: true };
    case 'lte':
      return { min: Number.NEGATIVE_INFINITY, max: value, openMin: false, openMax: false };
    case 'eq':
    default:
      return { min: value, max: value, openMin: false, openMax: false };
  }
};

const rangesOverlap = (
  left: ReturnType<typeof toRange>,
  right: ReturnType<typeof toRange>,
) => {
  if (left.max < right.min || right.max < left.min) return false;
  if (left.max === right.min && (left.openMax || right.openMin)) return false;
  if (right.max === left.min && (right.openMax || left.openMin)) return false;
  return true;
};

const relativeDelta = (left: number, right: number) =>
  Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1);

const compareQuantityFeatures = (
  left: ClaimFeatureVector | undefined,
  right: ClaimFeatureVector | undefined,
): QuantityComparison => {
  if (!left || !right) return { score: 0, contradiction: false };
  if (left.quantityValue == null || right.quantityValue == null) {
    return {
      score: binaryAgreement(left.quantityRaw, right.quantityRaw),
      contradiction: false,
    };
  }

  const leftUnit = normalizeUnit(left.quantityUnit);
  const rightUnit = normalizeUnit(right.quantityUnit);
  if (leftUnit && rightUnit && leftUnit !== rightUnit) {
    return { score: 0, contradiction: true };
  }

  const leftRange = toRange(left.quantityValue, left.comparisonOperator);
  const rightRange = toRange(right.quantityValue, right.comparisonOperator);
  if (!rangesOverlap(leftRange, rightRange)) {
    return { score: 0, contradiction: true };
  }

  const delta = relativeDelta(left.quantityValue, right.quantityValue);
  const leftOp = left.comparisonOperator;
  const rightOp = right.comparisonOperator;

  if (leftOp === 'eq' && rightOp === 'eq') {
    return { score: delta <= 0.01 ? 1 : 0, contradiction: delta > 0.01 };
  }

  if ((leftOp === 'approx' && rightOp === 'eq') || (leftOp === 'eq' && rightOp === 'approx')) {
    if (delta <= 0.01) return { score: 1, contradiction: false };
    if (delta <= 0.05) return { score: 0.85, contradiction: false };
    return { score: 0.65, contradiction: false };
  }

  if (leftOp === 'approx' && rightOp === 'approx') {
    if (delta <= 0.02) return { score: 0.95, contradiction: false };
    if (delta <= 0.05) return { score: 0.8, contradiction: false };
    return { score: 0.65, contradiction: false };
  }

  if (leftOp === rightOp) {
    if (delta <= 0.01) return { score: 0.95, contradiction: false };
    if (delta <= 0.05) return { score: 0.8, contradiction: false };
    return { score: 0.65, contradiction: false };
  }

  if (
    (leftOp === 'gt' || leftOp === 'gte') &&
    (rightOp === 'gt' || rightOp === 'gte')
  ) {
    return { score: delta <= 0.05 ? 0.8 : 0.65, contradiction: false };
  }

  if (
    (leftOp === 'lt' || leftOp === 'lte') &&
    (rightOp === 'lt' || rightOp === 'lte')
  ) {
    return { score: delta <= 0.05 ? 0.8 : 0.65, contradiction: false };
  }

  return { score: 0.6, contradiction: false };
};

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const parseTimeWindow = (value: string | null | undefined): ParsedTimeWindow | null => {
  const normalized = normalize(value);
  if (!normalized) return null;

  if (/^\d{4}$/.test(normalized)) {
    const year = Number.parseInt(normalized, 10);
    return {
      kind: 'year',
      start: Date.UTC(year, 0, 1),
      end: Date.UTC(year + 1, 0, 1) - 1,
      normalized,
    };
  }

  const quarterMatch = normalized.match(/^(\d{4})-q([1-4])$/);
  if (quarterMatch) {
    const year = Number.parseInt(quarterMatch[1], 10);
    const quarter = Number.parseInt(quarterMatch[2], 10);
    const monthStart = (quarter - 1) * 3;
    return {
      kind: 'quarter',
      start: Date.UTC(year, monthStart, 1),
      end: Date.UTC(year, monthStart + 3, 1) - 1,
      normalized,
    };
  }

  const monthMatch = normalized.match(
    /^(\d{4})-(january|february|march|april|may|june|july|august|september|october|november|december)$/,
  );
  if (monthMatch) {
    const year = Number.parseInt(monthMatch[1], 10);
    const month = MONTH_INDEX[monthMatch[2]];
    return {
      kind: 'month',
      start: Date.UTC(year, month, 1),
      end: Date.UTC(year, month + 1, 1) - 1,
      normalized,
    };
  }

  return { kind: 'relative', normalized };
};

const compareTimeValues = (
  left: ClaimFeatureVector | undefined,
  right: ClaimFeatureVector | undefined,
): TimeComparison => {
  const leftValue = left?.dateOrPeriodNormalized;
  const rightValue = right?.dateOrPeriodNormalized;
  if (!leftValue || !rightValue) return { score: 0, contradiction: false };

  const leftNormalized = normalize(leftValue);
  const rightNormalized = normalize(rightValue);
  if (leftNormalized === rightNormalized) return { score: 1, contradiction: false };

  const leftWindow = parseTimeWindow(leftNormalized);
  const rightWindow = parseTimeWindow(rightNormalized);
  if (!leftWindow || !rightWindow) return { score: 0, contradiction: false };

  if (leftWindow.kind === 'relative' && rightWindow.kind === 'relative') {
    return { score: 0, contradiction: true };
  }

  if (leftWindow.kind === 'relative' || rightWindow.kind === 'relative') {
    return { score: 0.35, contradiction: false };
  }

  const overlaps = !(leftWindow.end < rightWindow.start || rightWindow.end < leftWindow.start);
  if (!overlaps) return { score: 0, contradiction: true };

  if (
    (leftWindow.kind === 'year' && rightWindow.kind === 'month') ||
    (leftWindow.kind === 'month' && rightWindow.kind === 'year') ||
    (leftWindow.kind === 'year' && rightWindow.kind === 'quarter') ||
    (leftWindow.kind === 'quarter' && rightWindow.kind === 'year')
  ) {
    return { score: 0.75, contradiction: false };
  }

  if (
    (leftWindow.kind === 'quarter' && rightWindow.kind === 'month') ||
    (leftWindow.kind === 'month' && rightWindow.kind === 'quarter')
  ) {
    return { score: 0.8, contradiction: false };
  }

  return { score: 0.6, contradiction: false };
};

const classifyFreshness = (
  currentFeatures: ClaimFeatureVector | undefined,
  candidateFeatures: ClaimFeatureVector | undefined,
  verifiedAt: string,
): FreshnessClass => {
  const sensitivity = currentFeatures?.timeSensitivity || candidateFeatures?.timeSensitivity || 'evergreen';
  if (sensitivity === 'evergreen') return 'evergreen';

  const verifiedAtMs = Date.parse(verifiedAt);
  if (!Number.isFinite(verifiedAtMs)) return 'stale';

  const ageDays = (Date.now() - verifiedAtMs) / (1000 * 60 * 60 * 24);

  if (sensitivity === 'breaking') {
    return ageDays <= 3 ? 'fresh' : 'stale';
  }

  const timeComparison = compareTimeValues(currentFeatures, candidateFeatures);
  if (timeComparison.score >= 0.75 && ageDays <= 180) {
    return 'fresh';
  }

  return ageDays <= 180 ? 'fresh' : 'stale';
};

export function evaluateInternalClaimMatch(params: {
  currentClaim: ExtractedClaim;
  candidate: StoredClaimMatchCandidate;
  vectorSimilarity: number;
}): InternalMatchEvaluation {
  const { currentClaim, candidate, vectorSimilarity } = params;
  const currentFeatures = currentClaim.claimFeatures;
  const candidateFeatures = candidate.claimFeatures;
  const hardBlockers: string[] = [];
  const quantityComparison = compareQuantityFeatures(currentFeatures, candidateFeatures);
  const timeComparison = compareTimeValues(currentFeatures, candidateFeatures);

  if (!currentFeatures || !candidateFeatures) {
    hardBlockers.push('missing_canonical_features');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.polarity !== 'uncertain' &&
    candidateFeatures.polarity !== 'uncertain' &&
    currentFeatures.polarity !== candidateFeatures.polarity
  ) {
    hardBlockers.push('polarity_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.quantityValue != null &&
    candidateFeatures.quantityValue != null &&
    quantityComparison.contradiction
  ) {
    hardBlockers.push('quantity_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.dateOrPeriodNormalized &&
    candidateFeatures.dateOrPeriodNormalized &&
    timeComparison.contradiction
  ) {
    hardBlockers.push('date_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.subject &&
    candidateFeatures.subject &&
    normalize(currentFeatures.subject) !== normalize(candidateFeatures.subject)
  ) {
    hardBlockers.push('subject_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.object &&
    candidateFeatures.object &&
    normalize(currentFeatures.object) !== normalize(candidateFeatures.object)
  ) {
    hardBlockers.push('object_mismatch');
  }

  const normalizedTextSimilarity = jaccard(
    currentClaim.normalizedClaimText || currentClaim.claimText,
    candidate.normalizedClaimText || candidate.claimText,
  );

  const subjectMatch = binaryAgreement(currentFeatures?.subject, candidateFeatures?.subject);
  const predicateMatch = binaryAgreement(currentFeatures?.predicate, candidateFeatures?.predicate);
  const objectMatch = binaryAgreement(currentFeatures?.object, candidateFeatures?.object);
  const polarityMatch =
    currentFeatures && candidateFeatures
      ? currentFeatures.polarity === candidateFeatures.polarity
        ? 1
        : 0
      : 0;
  const quantityMatch = quantityComparison.score;
  const timeMatch = timeComparison.score;
  const locationMatch = binaryAgreement(currentFeatures?.location, candidateFeatures?.location);

  const weightedScore =
    (vectorSimilarity * 0.2) +
    (normalizedTextSimilarity * 0.15) +
    (subjectMatch * 0.15) +
    (predicateMatch * 0.15) +
    (objectMatch * 0.1) +
    (polarityMatch * 0.1) +
    (quantityMatch * 0.1) +
    (timeMatch * 0.1) +
    (locationMatch * 0.05);

  const confidence = Number((weightedScore / 1.1).toFixed(3));

  let matchType: MatchType = 'reject';
  if (hardBlockers.length === 0 && confidence >= 0.9) {
    matchType = 'exact_truth_conditions';
  } else if (hardBlockers.length === 0 && confidence >= 0.75) {
    matchType = 'near_duplicate';
  } else if (hardBlockers.length === 0 && confidence >= 0.6) {
    matchType = 'related_context';
  }

  return {
    origin: 'internal_memory',
    matchType,
    confidence,
    canonicalClaimText: candidate.normalizedClaimText || candidate.claimText,
    freshnessClass: classifyFreshness(currentFeatures, candidateFeatures, candidate.verifiedAt),
    hardBlockers,
  };
}

export function evaluateClaimReviewMatch(params: {
  currentClaim: ExtractedClaim;
  candidate: StoredClaimMatchCandidate;
}): ExternalMatchEvaluation {
  const { currentClaim, candidate } = params;
  const currentFeatures = currentClaim.claimFeatures;
  const candidateFeatures = candidate.claimFeatures;
  const hardBlockers: string[] = [];
  const quantityComparison = compareQuantityFeatures(currentFeatures, candidateFeatures);
  const timeComparison = compareTimeValues(currentFeatures, candidateFeatures);

  if (!currentFeatures || !candidateFeatures) {
    hardBlockers.push('missing_canonical_features');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.polarity !== 'uncertain' &&
    candidateFeatures.polarity !== 'uncertain' &&
    currentFeatures.polarity !== candidateFeatures.polarity
  ) {
    hardBlockers.push('polarity_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.quantityValue != null &&
    candidateFeatures.quantityValue != null &&
    quantityComparison.contradiction
  ) {
    hardBlockers.push('quantity_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.dateOrPeriodNormalized &&
    candidateFeatures.dateOrPeriodNormalized &&
    timeComparison.contradiction
  ) {
    hardBlockers.push('date_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.subject &&
    candidateFeatures.subject &&
    normalize(currentFeatures.subject) !== normalize(candidateFeatures.subject)
  ) {
    hardBlockers.push('subject_mismatch');
  }

  if (
    currentFeatures &&
    candidateFeatures &&
    currentFeatures.object &&
    candidateFeatures.object &&
    normalize(currentFeatures.object) !== normalize(candidateFeatures.object)
  ) {
    hardBlockers.push('object_mismatch');
  }

  const normalizedTextSimilarity = jaccard(
    currentClaim.normalizedClaimText || currentClaim.claimText,
    candidate.normalizedClaimText || candidate.claimText,
  );

  const subjectMatch = binaryAgreement(currentFeatures?.subject, candidateFeatures?.subject);
  const predicateMatch = binaryAgreement(currentFeatures?.predicate, candidateFeatures?.predicate);
  const objectMatch = binaryAgreement(currentFeatures?.object, candidateFeatures?.object);
  const polarityMatch =
    currentFeatures && candidateFeatures
      ? currentFeatures.polarity === candidateFeatures.polarity
        ? 1
        : 0
      : 0;
  const quantityMatch = quantityComparison.score;
  const timeMatch = timeComparison.score;
  const locationMatch = binaryAgreement(currentFeatures?.location, candidateFeatures?.location);

  const nonVectorScore =
    (normalizedTextSimilarity * 0.15) +
    (subjectMatch * 0.15) +
    (predicateMatch * 0.15) +
    (objectMatch * 0.1) +
    (polarityMatch * 0.1) +
    (quantityMatch * 0.1) +
    (timeMatch * 0.1) +
    (locationMatch * 0.05);

  const confidence = Number((nonVectorScore / 0.9).toFixed(3));

  let matchType: MatchType = 'reject';
  if (hardBlockers.length === 0 && confidence >= 0.92) {
    matchType = 'exact_truth_conditions';
  } else if (hardBlockers.length === 0 && confidence >= 0.8) {
    matchType = 'near_duplicate';
  } else if (hardBlockers.length === 0 && confidence >= 0.65) {
    matchType = 'related_context';
  }

  return {
    origin: 'claimreview',
    matchType,
    confidence,
    canonicalClaimText: candidate.normalizedClaimText || candidate.claimText,
    freshnessClass: classifyFreshness(currentFeatures, candidateFeatures, candidate.verifiedAt),
    hardBlockers,
  };
}
