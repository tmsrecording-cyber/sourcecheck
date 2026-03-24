import type { ClaimClusterSummary, ClaimFeatureVector, SourceCard } from '../../../shared/types';

const DUPLICATE_WINDOW_SECONDS = 120;

const normalize = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const buildFeatureKey = (features?: ClaimFeatureVector | null) => {
  if (!features) return '';
  return [
    normalize(features.subject),
    normalize(features.predicate),
    normalize(features.object),
    features.polarity,
    features.comparisonOperator || '',
    features.quantityValue ?? '',
    normalize(features.quantityUnit),
    normalize(features.dateOrPeriodNormalized),
    normalize(features.location),
  ].join('|');
};

const buildClusterComparisonKey = (card: SourceCard) => {
  const featureKey = buildFeatureKey(card.claim.claimFeatures);
  const normalizedClaimText = normalize(card.claim.normalizedClaimText || card.claim.claimText);
  return featureKey.replace(/\|+/g, '').trim()
    ? `${card.claim.claimType}|${featureKey}`
    : `${card.claim.claimType}|${normalizedClaimText}`;
};

const mergeStringLists = (left?: string[], right?: string[]) =>
  Array.from(new Set([...(left || []), ...(right || [])]));

const mergeSimilarClaims = (left?: SourceCard['similarClaims'], right?: SourceCard['similarClaims']) => {
  const merged = [...(left || []), ...(right || [])];
  const seen = new Set<string>();
  return merged.filter((claim) => {
    if (seen.has(claim.id)) return false;
    seen.add(claim.id);
    return true;
  });
};

const hasMaterialCardChange = (existing: SourceCard, incoming: SourceCard) =>
  existing.status !== incoming.status ||
  existing.sourceTitle !== incoming.sourceTitle ||
  existing.sourceUrl !== incoming.sourceUrl ||
  existing.nuance !== incoming.nuance ||
  existing.contradictionContext !== incoming.contradictionContext ||
  existing.resolutionPath !== incoming.resolutionPath;

const buildClusterSummary = (
  existing: SourceCard,
  incoming: SourceCard,
): ClaimClusterSummary => {
  const existingNormalizedText = normalize(existing.claim.normalizedClaimText || existing.claim.claimText);
  const incomingNormalizedText = normalize(incoming.claim.normalizedClaimText || incoming.claim.claimText);
  const clusterType = existingNormalizedText === incomingNormalizedText
    ? 'same_claim_same_speaker'
    : 'near_duplicate';

  return {
    clusterId: existing.clusterInfo?.clusterId || existing.id,
    occurrenceCount: (existing.clusterInfo?.occurrenceCount || 1) + 1,
    sameVideoCount: (existing.clusterInfo?.sameVideoCount || 1) + 1,
    lastSeenTimestampSeconds: incoming.claim.timestampSeconds,
    clusterType,
  };
};

export type ClaimClusterUpdate = {
  cards: SourceCard[];
  suppressed: boolean;
};

export const applyClaimClusterUpdate = (
  cards: SourceCard[],
  incoming: SourceCard,
): ClaimClusterUpdate => {
  const incomingKey = buildClusterComparisonKey(incoming);
  const existingIndex = cards.findIndex((card) => {
    if (card.isTransientFailure) return false;
    const timeDiff = Math.abs(card.claim.timestampSeconds - incoming.claim.timestampSeconds);
    if (timeDiff > DUPLICATE_WINDOW_SECONDS) return false;
    return buildClusterComparisonKey(card) === incomingKey;
  });

  if (existingIndex === -1) {
    return { cards, suppressed: false };
  }

  const existing = cards[existingIndex];
  const clusterInfo = buildClusterSummary(existing, incoming);
  const updatedExisting: SourceCard = {
    ...existing,
    clusterInfo,
    relatedClaimIds: mergeStringLists(existing.relatedClaimIds, incoming.relatedClaimIds),
    similarClaims: mergeSimilarClaims(existing.similarClaims, incoming.similarClaims),
  };

  if (!hasMaterialCardChange(existing, incoming)) {
    const nextCards = cards.map((card, index) => index === existingIndex ? updatedExisting : card);
    return {
      cards: nextCards,
      suppressed: true,
    };
  }

  const updatedIncoming: SourceCard = {
    ...incoming,
    clusterInfo,
    relatedClaimIds: mergeStringLists(existing.relatedClaimIds, incoming.relatedClaimIds),
    similarClaims: mergeSimilarClaims(existing.similarClaims, incoming.similarClaims),
  };

  const remaining = cards.map((card, index) => index === existingIndex ? updatedExisting : card);
  return {
    cards: [updatedIncoming, ...remaining],
    suppressed: false,
  };
};
