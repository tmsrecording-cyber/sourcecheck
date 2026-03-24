import { normalizeExtractedClaim } from './claim-normalization';
import type { ExtractedClaim, VerificationStatus } from '@/types/shared';

const FACT_CHECK_TOOLS_API_BASE = 'https://factchecktools.googleapis.com/v1alpha1/claims:search';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_PAGE_SIZE = 5;

const getApiKey = () => process.env.FACT_CHECK_TOOLS_API_KEY?.trim() || '';

const getTimeoutMs = () => {
  const configured = Number.parseInt(process.env.FACT_CHECK_TOOLS_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured >= 1000 ? configured : DEFAULT_TIMEOUT_MS;
};

type ClaimReviewPublisher = {
  name?: string;
  site?: string;
};

type ClaimReviewEntry = {
  publisher?: ClaimReviewPublisher;
  url?: string;
  title?: string;
  reviewDate?: string;
  textualRating?: string;
  languageCode?: string;
};

type ClaimSearchEntry = {
  text?: string;
  claimant?: string;
  claimDate?: string;
  claimReview?: ClaimReviewEntry[];
};

type ClaimSearchResponse = {
  claims?: ClaimSearchEntry[];
};

export type ClaimReviewHit = {
  claimText: string;
  claimant?: string;
  claimDate?: string;
  reviewPublisher: string;
  reviewPublisherSite?: string;
  reviewUrl: string;
  reviewTitle: string;
  reviewDate: string;
  textualRating?: string;
  languageCode?: string;
};

export type ClaimReviewCandidate = {
  hit: ClaimReviewHit;
  normalizedClaimText: string;
  claimFeatures: NonNullable<ExtractedClaim['claimFeatures']>;
};

const normalize = (value: string | null | undefined) =>
  (value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const tokenize = (value: string | null | undefined) =>
  normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 2);

const jaccard = (left: string | null | undefined, right: string | null | undefined) => {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

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

const buildClaimReviewQueries = (claim: ExtractedClaim): string[] => {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queries.push((value || '').trim());
  };

  const primary = claim.normalizedClaimText?.trim() || claim.claimText.trim();
  push(primary);

  const subject = claim.claimFeatures?.subject?.trim();
  const predicate = claim.claimFeatures?.predicate?.trim();
  const object = claim.claimFeatures?.object?.trim();
  const secondary = [subject, predicate, object].filter(Boolean).join(' ');
  push(secondary);

  const quantity = claim.claimFeatures?.quantityRaw?.trim();
  const time = claim.claimFeatures?.dateOrPeriodRaw?.trim();
  const structured = [subject, predicate, object, quantity, time].filter(Boolean).join(' ');
  push(structured);

  return queries.slice(0, 3);
};

const deriveMaxAgeDays = (claim: ExtractedClaim) => {
  switch (claim.claimFeatures?.timeSensitivity) {
    case 'breaking':
      return 3;
    case 'time_bound':
      return 180;
    default:
      return undefined;
  }
};

const buildUrl = (query: string, maxAgeDays?: number) => {
  const url = new URL(FACT_CHECK_TOOLS_API_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('languageCode', 'en');
  url.searchParams.set('pageSize', String(DEFAULT_PAGE_SIZE));
  if (typeof maxAgeDays === 'number') {
    url.searchParams.set('maxAgeDays', String(maxAgeDays));
  }
  url.searchParams.set('key', getApiKey());
  return url.toString();
};

const sanitizeHit = (claim: ClaimSearchEntry, review: ClaimReviewEntry): ClaimReviewHit | null => {
  const claimText = typeof claim.text === 'string' ? claim.text.trim() : '';
  const reviewUrl = typeof review.url === 'string' ? review.url.trim() : '';
  const reviewTitle = typeof review.title === 'string' ? review.title.trim() : '';
  const reviewDate = typeof review.reviewDate === 'string' ? review.reviewDate.trim() : '';
  const reviewPublisher = typeof review.publisher?.name === 'string' ? review.publisher.name.trim() : '';

  if (!claimText || !reviewUrl || !reviewTitle || !reviewDate || !reviewPublisher) {
    return null;
  }

  return {
    claimText,
    ...(typeof claim.claimant === 'string' && claim.claimant.trim()
      ? { claimant: claim.claimant.trim() }
      : {}),
    ...(typeof claim.claimDate === 'string' && claim.claimDate.trim()
      ? { claimDate: claim.claimDate.trim() }
      : {}),
    reviewPublisher,
    ...(typeof review.publisher?.site === 'string' && review.publisher.site.trim()
      ? { reviewPublisherSite: review.publisher.site.trim() }
      : {}),
    reviewUrl,
    reviewTitle,
    reviewDate,
    ...(typeof review.textualRating === 'string' && review.textualRating.trim()
      ? { textualRating: review.textualRating.trim() }
      : {}),
    ...(typeof review.languageCode === 'string' && review.languageCode.trim()
      ? { languageCode: review.languageCode.trim() }
      : {}),
  };
};

const rankClaimReviewHit = (claim: ExtractedClaim, hit: ClaimReviewHit) => {
  const claimText = claim.normalizedClaimText || claim.claimText;
  const textOverlap = jaccard(claimText, hit.claimText);
  const titleOverlap = jaccard(claimText, hit.reviewTitle);
  const quantityOverlap = jaccard(claim.claimFeatures?.quantityRaw, hit.claimText);
  const timeOverlap = jaccard(claim.claimFeatures?.dateOrPeriodRaw, hit.claimText);
  const recencyMs = Date.parse(hit.reviewDate);
  const recencyBonus = Number.isFinite(recencyMs)
    ? Math.max(0, 1 - ((Date.now() - recencyMs) / (1000 * 60 * 60 * 24 * 365)))
    : 0;

  return (
    (textOverlap * 0.55) +
    (titleOverlap * 0.2) +
    (quantityOverlap * 0.15) +
    (timeOverlap * 0.05) +
    (recencyBonus * 0.05)
  );
};

export async function searchClaimReviewMatches(claim: ExtractedClaim): Promise<ClaimReviewCandidate[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const queries = buildClaimReviewQueries(claim);
  if (queries.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const hits: ClaimReviewHit[] = [];
    const seen = new Set<string>();
    const maxAgeDays = deriveMaxAgeDays(claim);

    for (const query of queries) {
      const response = await fetch(buildUrl(query, maxAgeDays), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Fact Check Tools responded ${response.status}`);
      }

      const payload = await response.json() as ClaimSearchResponse;
      const claims = Array.isArray(payload.claims) ? payload.claims : [];

      claims.forEach((claimEntry) => {
        const reviews = Array.isArray(claimEntry.claimReview) ? claimEntry.claimReview : [];
        reviews.forEach((review) => {
          const hit = sanitizeHit(claimEntry, review);
          if (!hit) return;
          const key = `${hit.reviewUrl}::${hit.claimText}`;
          if (seen.has(key)) return;
          seen.add(key);
          hits.push(hit);
        });
      });

      if (hits.length >= DEFAULT_PAGE_SIZE) break;
    }

    return hits
      .sort((left, right) => rankClaimReviewHit(claim, right) - rankClaimReviewHit(claim, left))
      .slice(0, DEFAULT_PAGE_SIZE)
      .map((hit) => {
      const normalized = normalizeExtractedClaim({
        claimText: hit.claimText,
        claimType: claim.claimType,
      });
      return {
        hit,
        normalizedClaimText: normalized.normalizedClaimText || hit.claimText,
        claimFeatures: normalized.claimFeatures!,
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function mapClaimReviewRatingToStatus(textualRating?: string): VerificationStatus | null {
  if (!textualRating) return null;
  const normalized = textualRating.toLowerCase();

  if (/\b(false|mostly false|pants on fire|incorrect|fake|debunked|not true)\b/.test(normalized)) {
    return 'disputed';
  }

  if (/\b(true|mostly true|correct|accurate|supported)\b/.test(normalized)) {
    return 'supported';
  }

  if (/\b(half true|partly false|partly true|misleading|mixed|out of context|needs context)\b/.test(normalized)) {
    return 'partial';
  }

  return null;
}
