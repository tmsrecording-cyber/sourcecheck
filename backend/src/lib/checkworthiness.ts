import type { ClaimFeatureVector, ClaimType } from '@/types/shared';

const OPINION_OR_PREDICTION_RE =
  /\b(i think|i believe|probably|maybe|might|could|will|going to|expect|predict|feels like|seems like)\b/i;

const POLICY_OR_EVENT_RE =
  /\b(bill|law|policy|order|proposal|vote|funding|shutdown|budget|election|war|strike|tariff|tax|immigration|border|inflation|unemployment)\b/i;

const NAMED_ENTITY_RE =
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z]{2,})\b/;

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const hasSpecificTimeSignal = (features: ClaimFeatureVector) =>
  Boolean(features.dateOrPeriodRaw || features.dateOrPeriodNormalized);

const hasSpecificQuantitySignal = (features: ClaimFeatureVector) =>
  features.quantityValue !== null || Boolean(features.quantityRaw);

const hasNamedEntitySignal = (claimText: string, features: ClaimFeatureVector) =>
  Boolean(
    features.subject ||
    features.object ||
    features.attributedEntity ||
    NAMED_ENTITY_RE.test(claimText),
  );

export function computeCheckworthiness(params: {
  claimText: string;
  claimType: ClaimType;
  claimFeatures: ClaimFeatureVector;
}): number {
  const { claimText, claimType, claimFeatures } = params;

  let score = 0.2;

  if (hasSpecificQuantitySignal(claimFeatures) || hasSpecificTimeSignal(claimFeatures)) {
    score += 0.25;
  }

  if (hasNamedEntitySignal(claimText, claimFeatures)) {
    score += 0.2;
  }

  if (claimType === 'statistic' || claimType === 'study' || claimType === 'historical' || claimType === 'canonical') {
    score += 0.2;
  }

  if (POLICY_OR_EVENT_RE.test(claimText)) {
    score += 0.15;
  }

  if (OPINION_OR_PREDICTION_RE.test(claimText)) {
    score -= 0.3;
  }

  return clamp(Number(score.toFixed(3)));
}
