import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSONWithSearch, isGeminiError } from '@/lib/gemini';
import { buildGroundedVerificationPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import type {
  VerifyClaimRequest,
  VerifyClaimResponse,
  SourceCard,
  VerificationStatus,
} from '@/types/shared';

interface RawVerification {
  status: string;
  sourceTitle: string;
  sourceType: string;
  nuance: string;
  evidenceSnippet?: string | null;
}

const MAX_CLAIM_TEXT_LENGTH = 700;
const MAX_METADATA_FIELD_LENGTH = 300;
const MAX_NUANCE_LENGTH = 600;
const FALLBACK_NO_SOURCE_COPY = 'No grounded source attached.';

type UnverifiableCategory =
  | 'no_strong_match'
  | 'missing_context'
  | 'needs_primary_source';

// Phrases that assert definite verdicts — inappropriate when no grounded
// sources exist to back them up. Covers both negative AND positive certainty.
const NEGATIVE_CERTAINTY_RE =
  /\b(this is false|fabricat(ed|ion)|no credible record|clearly false|proven false|definitively (false|wrong|incorrect)|debunked|never happened|completely false|entirely false)\b/i;
const POSITIVE_CERTAINTY_RE =
  /\b(confirmed|verified|well[-\s]?documented|widely reported|established fact|proven true|definitively (true|correct|accurate)|backed by|supported by)\b/i;
const MISSING_CONTEXT_RE =
  /\b(missing context|needs context|more context|depends on|unclear|not specific|missing details|timeframe|population|definition)\b/i;
const PRIMARY_SOURCE_RE =
  /\b(study|paper|journal|trial|dataset|registry|archive|official|record|filing|report|guideline|census|publication|meta-analysis|original source)\b/i;

// When the card ends up unverifiable with no grounding, scrub any training-data
// nuance that sounds stronger than the evidence warrants — whether positive or negative.
const guardUnverifiableNuance = (nuance: string, hasGrounding: boolean): string => {
  if (!hasGrounding && (NEGATIVE_CERTAINTY_RE.test(nuance) || POSITIVE_CERTAINTY_RE.test(nuance))) {
    return 'We could not verify this claim with a reliable web source.';
  }
  return nuance;
};

const inferUnverifiableCategory = (params: {
  claimText: string;
  claimType: string;
  sourceType: string;
  nuance: string;
  sourceTitle: string;
}): UnverifiableCategory => {
  const contextCombined = `${params.claimText} ${params.nuance} ${params.sourceTitle}`.trim();
  const sourceCombined = `${params.claimText} ${params.sourceTitle}`.trim();

  if (MISSING_CONTEXT_RE.test(contextCombined)) {
    return 'missing_context';
  }

  if (
    params.claimType === 'study' ||
    params.claimType === 'canonical' ||
    params.sourceType === 'academic_paper' ||
    params.sourceType === 'official_source' ||
    PRIMARY_SOURCE_RE.test(sourceCombined)
  ) {
    return 'needs_primary_source';
  }

  return 'no_strong_match';
};

const resolveUnverifiableLanguage = (params: {
  category: UnverifiableCategory;
  hasGrounding: boolean;
}) => {
  switch (params.category) {
    case 'missing_context':
      return {
        sourceTitle: 'More context needed',
        nuance: 'The claim needs specifics like timeframe, population, or definition.',
      };
    case 'needs_primary_source':
      return {
        sourceTitle: 'Needs primary source',
        nuance: 'This likely needs a paper, dataset, or official record.',
      };
    case 'no_strong_match':
      return {
        sourceTitle: 'No strong web match',
        nuance: params.hasGrounding
          ? 'Search results mention the topic, but do not resolve this exact claim.'
          : 'We could not verify this claim with a reliable web source.',
      };
  }
};

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['supported', 'partial', 'disputed', 'unverifiable'] },
    sourceTitle: { type: 'string' },
    sourceType: { type: 'string', enum: ['academic_paper', 'news_article', 'official_source', 'wikipedia', 'other'] },
    nuance: { type: 'string' },
    evidenceSnippet: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['status', 'sourceTitle', 'sourceType', 'nuance'],
  additionalProperties: false,
};

const MAX_SNIPPET_LENGTH = 200;

/**
 * Sanitize the raw evidenceSnippet from the model.
 * Returns a clean string only when it is genuinely useful, or undefined otherwise.
 */
const sanitizeEvidenceSnippet = (
  raw: unknown,
  nuance: string,
  status: string
): string | undefined => {
  if (status === 'unverifiable') return undefined;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length < 15) return undefined;
  const sliced = trimmed.slice(0, MAX_SNIPPET_LENGTH);
  const normalizeForCompare = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (normalizeForCompare(sliced) === normalizeForCompare(nuance)) return undefined;
  return sliced;
};

const normalizeValue = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const sanitizeHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
};

const validateVerifyClaimRequest = (body: VerifyClaimRequest) => {
  if (!body.claim || typeof body.claim.claimText !== 'string' || !body.claim.claimText.trim()) {
    return 'claim with claimText is required.';
  }

  if (body.claim.claimText.length > MAX_CLAIM_TEXT_LENGTH) {
    return `claimText exceeds ${MAX_CLAIM_TEXT_LENGTH} characters.`;
  }

  if ((body.videoTitle || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'videoTitle is too long.';
  }

  if ((body.channelName || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'channelName is too long.';
  }

  if (!Number.isFinite(body.claim.timestampSeconds) || body.claim.timestampSeconds < 0) {
    return 'claim.timestampSeconds must be a non-negative number.';
  }

  const VALID_CLAIM_TYPES = ['study', 'statistic', 'historical', 'surprising', 'canonical'];
  if (!VALID_CLAIM_TYPES.includes(body.claim.claimType)) {
    return 'Invalid claimType.';
  }

  return null;
};

const scoreGroundingSource = (
  source: { title: string; url: string },
  desiredTitle: string
) => {
  const normalizedDesired = normalizeValue(desiredTitle);
  if (!normalizedDesired) {
    return 0;
  }

  const normalizedSourceTitle = normalizeValue(source.title);
  let score = 0;

  if (normalizedSourceTitle === normalizedDesired) {
    score += 100;
  }

  if (normalizedSourceTitle.includes(normalizedDesired) || normalizedDesired.includes(normalizedSourceTitle)) {
    score += 40;
  }

  normalizedDesired.split(' ').forEach((token) => {
    if (token.length >= 4 && normalizedSourceTitle.includes(token)) {
      score += 5;
    }
  });

  return score;
};

const selectBestSourceUrl = (
  desiredTitle: string,
  sources: Array<{ title: string; url: string }>
) => {
  const sanitizedSources = sources
    .map((source) => ({
      title: source.title,
      url: sanitizeHttpUrl(source.url || ''),
    }))
    .filter((source) => source.url);

  if (!sanitizedSources.length) {
    return '';
  }

  if (!desiredTitle.trim()) {
    return sanitizedSources[0].url;
  }

  let bestSource = sanitizedSources[0];
  let bestScore = scoreGroundingSource(bestSource, desiredTitle);

  for (const source of sanitizedSources.slice(1)) {
    const score = scoreGroundingSource(source, desiredTitle);
    if (score > bestScore) {
      bestSource = source;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestSource.url : '';
};

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin, request)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: VerifyClaimRequest = await request.json();

    const validationError = validateVerifyClaimRequest(body);
    if (validationError) {
      const response = NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    const { claim, contextTranscript } = body;

    // Extract BYOK header - user can provide their own API key
    const customApiKey = request.headers.get('x-custom-api-key')?.trim();

    // ---- Single Gemini call with Google Search grounding ----
    // Gemini searches the web automatically and returns both
    // the verification JSON and the grounding source URLs.
    const prompt = buildGroundedVerificationPrompt(claim.claimText, claim.claimType, contextTranscript);

    const { data: rawVerification, inputTokens, outputTokens, sources } =
      await askGeminiJSONWithSearch<RawVerification>(prompt, 500, VERIFICATION_SCHEMA, body.model, customApiKey);

    // ---- Validate status ----
    const validStatuses: VerificationStatus[] = ['supported', 'partial', 'disputed', 'unverifiable'];
    const parsedStatus: VerificationStatus = validStatuses.includes(rawVerification.status as VerificationStatus)
      ? (rawVerification.status as VerificationStatus)
      : 'unverifiable';

    // ---- Get source URL from grounding metadata ----
    // Gemini returns the actual URLs it used in groundingChunks.
    // Fall back to empty string if none available or no quality match.
    const bestSourceUrl = selectBestSourceUrl(rawVerification.sourceTitle || '', sources);

    // ---- Trust guard: no quality grounding source = no evidence-backed verdict ----
    // If Gemini returned no grounding chunks or we couldn't match its cited
    // source to a URL, the card must show as unverifiable.
    const hasQualityGrounding = bestSourceUrl !== '';
    const status: VerificationStatus = hasQualityGrounding ? parsedStatus : 'unverifiable';

    // ---- Validate source type ----
    const validSourceTypes = ['academic_paper', 'news_article', 'official_source', 'wikipedia', 'other'] as const;
    const sourceType = (validSourceTypes as readonly string[]).includes(rawVerification.sourceType)
      ? (rawVerification.sourceType as typeof validSourceTypes[number])
      : 'other';

    // ---- Resolve source title, type, URL, and nuance ----
    const rawSourceTitle = typeof rawVerification.sourceTitle === 'string'
      ? rawVerification.sourceTitle.trim()
      : '';
    const rawNuanceData = typeof rawVerification.nuance === 'string'
      ? rawVerification.nuance
      : 'No additional context available.';
    
    // Strip markdown-style citations [1], [2] etc injected by Gemini during search grounding
    const fullNuance = rawNuanceData.replace(/\[\d+\]/g, '').trim();
    const rawNuance = fullNuance.slice(0, MAX_NUANCE_LENGTH);

    // When unverifiable, infer a more specific category and use trust-preserving copy.
    const unresolvedCategory = status === 'unverifiable'
      ? inferUnverifiableCategory({
          claimText: claim.claimText,
          claimType: claim.claimType,
          sourceType: rawVerification.sourceType,
          nuance: fullNuance, // Use full nuance for inference (before truncation)
          sourceTitle: rawSourceTitle,
        })
      : null;
    const unresolvedLanguage = unresolvedCategory
      ? resolveUnverifiableLanguage({
          category: unresolvedCategory,
          hasGrounding: hasQualityGrounding,
        })
      : null;

    const sourceTitle = unresolvedLanguage
      ? unresolvedLanguage.sourceTitle
      : hasQualityGrounding
        ? (rawSourceTitle || 'Unknown source')
        : FALLBACK_NO_SOURCE_COPY;
    const resolvedSourceType = unresolvedLanguage ? 'other' : hasQualityGrounding ? sourceType : 'other';
    const resolvedSourceUrl = unresolvedLanguage ? '' : bestSourceUrl;
    const resolvedNuance = (
      unresolvedLanguage
        ? unresolvedLanguage.nuance
        : guardUnverifiableNuance(rawNuance, hasQualityGrounding)
    ).slice(0, MAX_NUANCE_LENGTH);

    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });

    const evidenceSnippet = sanitizeEvidenceSnippet(
      rawVerification.evidenceSnippet,
      resolvedNuance,
      status
    );

    const sourceCard: SourceCard = {
      id,
      claim,
      status,
      sourceTitle: sourceTitle.slice(0, MAX_METADATA_FIELD_LENGTH),
      sourceUrl: resolvedSourceUrl,
      sourceType: resolvedSourceType,
      nuance: resolvedNuance,
      ...(evidenceSnippet ? { evidenceSnippet } : {}),
      timestampSeconds: claim.timestampSeconds,
      verifiedAt: new Date().toISOString(),
    };

    console.info('[verify-claim]', {
      parsedStatus,
      status: sourceCard.status,
      hasQualityGrounding,
      sourceCount: Array.isArray(sources) ? sources.length : 0,
      inputTokens,
      outputTokens,
    });

    const response = NextResponse.json<VerifyClaimResponse>({ sourceCard });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;

  } catch (error: unknown) {
    console.error('[verify-claim] Error:', {
      name: error instanceof Error ? error.name : typeof error,
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
    });

    // Pass error classification to frontend for better UX
    if (isGeminiError(error)) {
      let statusCode = 500;
      let errorResponse: { error: string; errorCode?: string; retryable: boolean } = {
        error: error.message,
        errorCode: error.code,
        retryable: false,
      };

      switch (error.code) {
        case 'RATE_LIMITED':
          statusCode = 429;
          errorResponse.retryable = true;
          break;
        case 'QUOTA_EXHAUSTED':
          statusCode = 429;
          errorResponse.retryable = false;
          break;
        case 'OVERLOADED':
          statusCode = 503;
          errorResponse.retryable = true;
          break;
        case 'AUTH_ERROR':
          statusCode = 401;
          errorResponse.retryable = false;
          break;
        default:
          statusCode = 502;
          errorResponse.retryable = true;
      }

      const response = NextResponse.json(errorResponse, { status: statusCode });
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    const response = NextResponse.json(
      { error: 'Failed to verify claim.', retryable: true },
      { status: 500 }
    );
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
