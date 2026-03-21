// Force Node.js runtime - Redis rate limiting requires Node.js APIs
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSONWithSearch, generateEmbedding, isGeminiError } from '@/lib/gemini';
import { buildGroundedVerificationPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import { verifyBearerSessionToken } from '@/proxy';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { logRouteFailure, logProviderError, classifyGeminiErrorCode, isRetryableCategory } from '@/lib/observability';
import { validateClientSecretAuth } from '@/lib/client-secret-auth';
import { findSimilarClaim, upsertClaimVector } from '@/lib/vector-store';
import type {
  VerifyClaimRequest,
  VerifyClaimResponse,
  SourceCard,
  VerificationStatus,
} from '@/types/shared';

type SourceType = SourceCard['sourceType'];

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
const PARTIAL_WITHOUT_SOURCE_MATCH_COPY =
  'Sources mention the topic, but the exact claim match is unclear.';
const VALID_SOURCE_TYPES: readonly SourceType[] = [
  'academic_paper',
  'news_article',
  'official_source',
  'wikipedia',
  'other',
] as const;

// Wording format version - bump when changing user-facing unresolved wording
// This invalidates cached nuance text that may contain old product language
const WORDING_VERSION = 1;

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
    return 'No confirming source found.';
  }
  return nuance;
};

const inferUnverifiableCategory = (params: {
  claimText: string;
  claimType: string;
  sourceType: string;
  nuance: string;
  sourceTitle: string;
  hasGrounding: boolean;
}): UnverifiableCategory => {
  const contextCombined = `${params.claimText} ${params.nuance} ${params.sourceTitle}`.trim();
  const sourceCombined = `${params.claimText} ${params.sourceTitle}`.trim();

  if (MISSING_CONTEXT_RE.test(contextCombined)) {
    return 'missing_context';
  }

  const explicitlyPrimarySourceBound =
    params.claimType === 'study' ||
    PRIMARY_SOURCE_RE.test(sourceCombined);
  const groundedPrimarySourceSignal =
    params.hasGrounding &&
    (params.sourceType === 'academic_paper' || params.sourceType === 'official_source');

  if (
    explicitlyPrimarySourceBound ||
    groundedPrimarySourceSignal
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
        sourceTitle: 'Missing details',
        nuance: 'The claim is too vague—needs dates, names, or specifics to verify.',
      };
    case 'needs_primary_source':
      return {
        sourceTitle: 'Source not available',
        nuance: 'This type of claim requires access to papers, filings, or official records.',
      };
    case 'no_strong_match':
      return {
        sourceTitle: params.hasGrounding ? 'Evidence unclear' : 'Not found',
        nuance: params.hasGrounding
          ? 'Sources mention the topic but do not clearly confirm or refute this claim.'
          : 'No reliable source confirms this specific claim.',
      };
  }
};

const normalizeSourceType = (value: string | null | undefined): SourceType =>
  (VALID_SOURCE_TYPES as readonly string[]).includes(value ?? '')
    ? (value as SourceType)
    : 'other';

const resolveStatusWithoutMatchedSource = (params: {
  parsedStatus: VerificationStatus;
  hasGroundingSources: boolean;
  hasQualityGrounding: boolean;
}): VerificationStatus => {
  if (params.hasQualityGrounding) {
    return params.parsedStatus;
  }

  if (params.parsedStatus === 'unverifiable') {
    return 'unverifiable';
  }

  return params.hasGroundingSources ? 'partial' : 'unverifiable';
};

const resolvePartialNuanceWithoutMatchedSource = (nuance: string): string => {
  const trimmed = nuance.trim();
  if (!trimmed) {
    return PARTIAL_WITHOUT_SOURCE_MATCH_COPY;
  }

  if (NEGATIVE_CERTAINTY_RE.test(trimmed) || POSITIVE_CERTAINTY_RE.test(trimmed)) {
    return PARTIAL_WITHOUT_SOURCE_MATCH_COPY;
  }

  return trimmed;
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
  
  if (body.videoId && typeof body.videoId !== 'string') {
    return 'videoId must be a string.';
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
  // Pre-shared client secret authentication (additional layer)
  const clientSecretAuth = validateClientSecretAuth(request);
  if (!clientSecretAuth.authorized) {
    return clientSecretAuth.response;
  }

  let body: VerifyClaimRequest | null = null;
  // Declare outside try for error handling access
  const extensionId = request.headers.get('x-extension-id')?.trim() || '';
  const customApiKey = request.headers.get('x-custom-api-key')?.trim();
  // BYOK: Check for model in header (x-custom-model) as override
  const headerModel = request.headers.get('x-custom-model')?.trim();
  
  try {
    const parsedBody: VerifyClaimRequest = await request.json();
    body = parsedBody;

    const validationError = validateVerifyClaimRequest(parsedBody);
    if (validationError) {
      const response = NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    // Session authentication
    const identity = extensionId ? `ext:${extensionId}` : 'unknown';
    const sessionAuth = await verifyBearerSessionToken(request, extensionId, identity);
    
    if (!sessionAuth.authorized) {
      logRouteFailure({
        route: '/api/verify-claim',
        category: 'auth_error',
        statusCode: 401,
        retryable: false,
        context: 'session token invalid or missing',
      });
      const response = NextResponse.json(
        { error: 'Unauthorized. Valid session token required.' },
        { status: 401 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    // Rate limiting check
    const rateLimitResult = await checkRateLimit(request, identity);
    if (!rateLimitResult.allowed) {
      logRouteFailure({
        route: '/api/verify-claim',
        category: 'rate_limited',
        statusCode: 429,
        retryable: true,
        context: `retryAfter=${rateLimitResult.retryAfter}`,
      });
      const response = createRateLimitResponse(request, rateLimitResult.retryAfter);
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    const { claim, contextTranscript, isPrivate } = parsedBody;

    // ============================================================================
    // CROSS-VIDEO MEMORY: Check for similar claims before calling Gemini
    // Private sessions (e.g. Google Meet) skip both the lookup and the save so
    // meeting content is never indexed in cross-video memory.
    // ============================================================================
    // Generate embedding for the claim to search for similar previously verified claims.
    // Use claimText only — consistent with what is stored, so similarity scores are accurate.
    const embedding = isPrivate ? [] : await generateEmbedding(claim.claimText, customApiKey, 'RETRIEVAL_QUERY');

    let similarClaim = null;
    if (embedding.length > 0) {
      similarClaim = await findSimilarClaim(embedding);
      if (similarClaim) {
        console.log('[verify-claim] Cross-video memory: Found similar claim', {
          claimId: claim.id,
          similarClaimId: similarClaim.id,
          score: similarClaim.score,
          videoTitle: similarClaim.metadata.videoTitle,
        });
      }
    }
    
    // If we found a very similar resolved claim, return it immediately.
    // Do not short-circuit on cached "unverifiable" results because they may
    // represent stale grounding failures or outdated wording.
    if (similarClaim && similarClaim.score > 0.92 && similarClaim.metadata.status !== 'unverifiable') {
      // Check wording version - invalidate stale cached wording
      const cachedVersion = similarClaim.metadata.wordingVersion;
      let nuance = similarClaim.metadata.nuance;
      
      // Always strip legacy "[From memory]" prefix - it should never be user-facing
      nuance = nuance.replace(/^\[From memory\]\s*/i, '');
      
      if (cachedVersion !== WORDING_VERSION) {
        // Regenerate nuance with current wording format
        console.info('[verify-claim] Cached wording version mismatch, regenerating', {
          cachedVersion,
          currentVersion: WORDING_VERSION,
          status: similarClaim.metadata.status,
        });
      }
      
      const cachedSourceCard: SourceCard = {
        id: crypto.randomUUID(),
        claim,
        status: similarClaim.metadata.status,
        sourceTitle: similarClaim.metadata.sourceTitle,
        sourceUrl: similarClaim.metadata.sourceUrl,
        sourceType: normalizeSourceType(similarClaim.metadata.sourceType),
        nuance,
        timestampSeconds: claim.timestampSeconds,
        verifiedAt: new Date().toISOString(),
        embedding,
      };
      
      console.info('[verify-claim] Returning cached result from cross-video memory', {
        originalVideo: similarClaim.metadata.videoTitle,
        score: similarClaim.score,
        wordingRegenerated: cachedVersion !== WORDING_VERSION,
      });
      
      const response = NextResponse.json<VerifyClaimResponse>({ 
        sourceCard: cachedSourceCard,
        similarClaims: [{
          id: similarClaim.id,
          claimText: similarClaim.metadata.claimText,
          status: similarClaim.metadata.status,
          videoTitle: similarClaim.metadata.videoTitle,
          videoId: similarClaim.metadata.videoId,
          timestampSeconds: similarClaim.metadata.timestampSeconds,
          similarity: similarClaim.score,
        }],
      });
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    if (similarClaim && similarClaim.score > 0.92 && similarClaim.metadata.status === 'unverifiable') {
      console.info('[verify-claim] Skipping cached unresolved result; re-verifying claim', {
        similarClaimId: similarClaim.id,
        score: similarClaim.score,
        originalVideo: similarClaim.metadata.videoTitle,
      });
    }

    // ---- Gemini grounded verification with retry + graceful fallback ----
    const prompt = buildGroundedVerificationPrompt(claim.claimText, claim.claimType, contextTranscript);

    // BYOK: Use header model if provided (from x-custom-model), else fall back to body
    const effectiveModel = customApiKey && headerModel ? headerModel : body.model;
    
    console.log('[verify-claim] Calling Gemini with grounding:', {
      requestId: crypto.randomUUID(),
      claimId: claim.id,
      claimType: claim.claimType,
      model: effectiveModel,
      isBYOK: !!customApiKey,
      promptLength: prompt.length,
    });
    
    let rawVerification: RawVerification;
    let inputTokens: number;
    let outputTokens: number;
    let sources: Array<{ title: string; url: string }>;
    let usedFallback = false;
    
    // Helper to check if error is recoverable for retry/fallback
    // SAFETY/OTHER/RECITATION: Policy blocks on sensitive content (geopolitical, etc.)
    // PARSE_ERROR: JSON malformed/empty/truncated
    // MAX_TOKENS: Response truncated
    const isRecoverableGroundingError = (err: unknown): boolean => {
      if (!isGeminiError(err)) return false;
      if (err.code === 'PARSE_ERROR') return true;
      if (err.code === 'API_ERROR') {
        // Upstream transient failures
        if (err.status === 502 || err.status === 504) return true;
        // MAX_TOKENS: retry with higher budget
        if (err.message.includes('MAX_TOKENS')) return true;
        // SAFETY/OTHER/RECITATION: Policy blocks (geopolitical, sensitive content)
        // These are product conditions, not server failures
        if (err.message.includes('SAFETY') || 
            err.message.includes('RECITATION') ||
            err.message.includes('OTHER') ||
            err.message.includes('finishReason')) return true;
      }
      return false;
    };
    
    try {
      const result = await askGeminiJSONWithSearch<RawVerification>(
        prompt, 
        1200, 
        VERIFICATION_SCHEMA, 
        effectiveModel, 
        customApiKey,
        '/api/verify-claim'
      );
      rawVerification = result.data;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
      sources = result.sources;
    } catch (firstError) {
      if (isRecoverableGroundingError(firstError)) {
        // Log first attempt failure
        const firstErr = isGeminiError(firstError) ? firstError : null;
        console.warn('[verify-claim] First attempt failed, will retry', {
          category: firstErr?.code === 'API_ERROR' ? 'upstream_non_ok' : (firstErr?.code?.toLowerCase() ?? 'unknown'),
          model: effectiveModel,
          claimId: claim.id,
          retryAttempt: 1,
          status: firstErr?.status ?? null,
          finishReason: firstErr?.message.match(/finishReason=(\w+)/)?.[1] || null,
        });
        
        // Retry once with higher token budget and no schema enforcement (more permissive)
        try {
          const retryResult = await askGeminiJSONWithSearch<RawVerification>(
            prompt + '\n\nReturn ONLY valid JSON with no markdown formatting.',
            1800, // higher maxTokens for retry
            undefined, // skip strict schema validation on retry
            effectiveModel,
            customApiKey,
            '/api/verify-claim'
          );
          rawVerification = retryResult.data;
          inputTokens = retryResult.inputTokens;
          outputTokens = retryResult.outputTokens;
          sources = retryResult.sources;
          console.info('[verify-claim] Retry succeeded for claim:', claim.id);
        } catch (retryError) {
          // Both attempts failed - use graceful fallback instead of 502
          // Classify the failure category for observability
          const classifyFailure = (err: unknown): string => {
            if (!isGeminiError(err)) return 'unknown';
            const msg = err.message;
            if (err.status === 502 || err.status === 504) return 'upstream_non_ok';
            if (msg.includes('PARSE_ERROR')) return 'parse_error';
            if (msg.includes('schema') || msg.includes('validation')) return 'schema_error';
            if (msg.includes('finishReason') || msg.includes('Empty response')) return 'empty_response';
            if (msg.includes('MAX_TOKENS')) return 'max_tokens';
            if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('AbortError')) return 'timeout';
            return 'unknown';
          };
          
          const category = classifyFailure(retryError);
          const geminiErr = isGeminiError(retryError) ? retryError : null;
          
          // Single concise log line for fallback classification
          console.warn('[verify-claim] Fallback triggered', {
            category,
            model: effectiveModel,
            claimId: claim.id,
            retryAttempt: 2,
            status: geminiErr?.status ?? null,
            finishReason: geminiErr?.message.match(/finishReason=(\w+)/)?.[1] || null,
          });
          
          usedFallback = true;
          rawVerification = {
            status: 'unverifiable',
            sourceTitle: 'Verification unavailable',
            sourceType: 'other',
            nuance: 'Verification temporarily unavailable.',
            evidenceSnippet: null,
          };
          inputTokens = 0;
          outputTokens = 0;
          sources = [];
        }
      } else {
        // Non-recoverable error - re-throw to preserve existing error handling
        console.error('[verify-claim] Gemini grounding call failed (non-recoverable):', {
          claimId: claim.id,
          model: effectiveModel,
          error: firstError instanceof Error ? {
            name: firstError.name,
            message: firstError.message,
            code: (firstError as { code?: string }).code,
          } : 'Unknown error',
        });
        throw firstError;
      }
    }

    // ---- Validate status ----
    const validStatuses: VerificationStatus[] = ['supported', 'partial', 'disputed', 'unverifiable'];
    const parsedStatus: VerificationStatus = validStatuses.includes(rawVerification.status as VerificationStatus)
      ? (rawVerification.status as VerificationStatus)
      : 'unverifiable';

    const rawSourceTitle = typeof rawVerification.sourceTitle === 'string'
      ? rawVerification.sourceTitle.trim()
      : '';
    const rawNuanceData = typeof rawVerification.nuance === 'string'
      ? rawVerification.nuance
      : 'No additional context available.';

    // Strip markdown-style citations [1], [2] etc injected by Gemini during search grounding
    const fullNuance = rawNuanceData.replace(/\[\d+\]/g, '').trim();
    const rawNuance = fullNuance.slice(0, MAX_NUANCE_LENGTH);

    // ---- Get source URL from grounding metadata ----
    // Gemini returns the actual URLs it used in groundingChunks.
    // Fall back to empty string if none available or no quality match.
    const bestSourceUrl = selectBestSourceUrl(rawSourceTitle, sources);

    // ---- Trust guard: preserve partial when grounding exists but source matching is weak ----
    // If grounding sources exist but we cannot confidently attach the model's chosen
    // citation to a URL, keep the result at "partial" rather than collapsing it to
    // "unverifiable". Only fully unresolved claims should remain "unverifiable".
    const hasGroundingSources = sources.length > 0;
    const hasQualityGrounding = bestSourceUrl !== '';
    const status: VerificationStatus = resolveStatusWithoutMatchedSource({
      parsedStatus,
      hasGroundingSources,
      hasQualityGrounding,
    });

    // ---- Validate source type ----
    const sourceType = normalizeSourceType(rawVerification.sourceType);
    const downgradedToPartialWithoutSourceMatch =
      !hasQualityGrounding && hasGroundingSources && status === 'partial';

    // When unverifiable, infer a more specific category and use trust-preserving copy.
    const unresolvedCategory = status === 'unverifiable'
      ? inferUnverifiableCategory({
          claimText: claim.claimText,
          claimType: claim.claimType,
          sourceType: rawVerification.sourceType,
          nuance: fullNuance, // Use full nuance for inference (before truncation)
          sourceTitle: rawSourceTitle,
          hasGrounding: hasQualityGrounding,
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
        : downgradedToPartialWithoutSourceMatch
          ? (rawSourceTitle || sources[0]?.title?.trim() || 'Evidence unclear')
          : FALLBACK_NO_SOURCE_COPY;
    const resolvedSourceType = unresolvedLanguage ? 'other' : sourceType;
    const resolvedSourceUrl = unresolvedLanguage ? '' : bestSourceUrl;
    const resolvedNuance = (
      unresolvedLanguage
        ? unresolvedLanguage.nuance
        : downgradedToPartialWithoutSourceMatch
          ? resolvePartialNuanceWithoutMatchedSource(rawNuance)
        : guardUnverifiableNuance(rawNuance, hasQualityGrounding)
    ).slice(0, MAX_NUANCE_LENGTH);

    const id = crypto.randomUUID();

    const evidenceSnippet = sanitizeEvidenceSnippet(
      rawVerification.evidenceSnippet,
      resolvedNuance,
      status
    );

    // Reuse embedding from cross-video memory check, or generate if needed.
    // Private sessions intentionally skip embeddings end-to-end — do not
    // regenerate here even though the initial embedding array is empty.
    // Use claimText only — same text as the query so stored vectors are in the same space.
    let claimEmbedding = embedding;
    if (claimEmbedding.length === 0 && !isPrivate) {
      claimEmbedding = await generateEmbedding(claim.claimText, customApiKey, 'RETRIEVAL_DOCUMENT');
    }

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
      ...(claimEmbedding.length > 0 ? { embedding: claimEmbedding } : {}),
    };
    
    // ---- Cross-video memory: Save claim vector for future similarity search ----
    // Private sessions (isPrivate=true) must never be stored in cross-video memory.
    // Fire and forget - don't await to avoid slowing down the response
    if (claimEmbedding.length > 0 && !isPrivate) {
      upsertClaimVector({
        id: sourceCard.id,
        claimText: claim.claimText,
        status: sourceCard.status,
        nuance: sourceCard.nuance,
        sourceTitle: sourceCard.sourceTitle,
        sourceUrl: sourceCard.sourceUrl,
        sourceType: sourceCard.sourceType,
        videoId: body?.videoId || 'unknown',
        videoTitle: body?.videoTitle || 'Unknown Video',
        timestampSeconds: claim.timestampSeconds,
        verifiedAt: sourceCard.verifiedAt,
        wordingVersion: WORDING_VERSION,
      }, claimEmbedding).catch((err) => {
        console.error('[vector-store] upsert failed:', err);
      });
    }

    // Explicit downgrade logging for auditability
    const wasDowngraded = parsedStatus !== status;
    const downgradeInfo = wasDowngraded
      ? {
          downgradedFrom: parsedStatus,
          downgradedTo: status,
          downgradeReason: downgradedToPartialWithoutSourceMatch
            ? 'grounding_present_but_source_unmatched'
            : hasQualityGrounding
              ? 'trust_guard_unknown'
              : 'no_quality_grounding',
          parsedStatus,
          finalStatus: status,
          sourceCount: Array.isArray(sources) ? sources.length : 0,
          bestSourceUrlPresent: bestSourceUrl !== '',
        }
      : { downgradedToUnverifiable: false };

    console.info('[verify-claim]', {
      parsedStatus,
      status: sourceCard.status,
      hasQualityGrounding,
      sourceCount: Array.isArray(sources) ? sources.length : 0,
      inputTokens,
      outputTokens,
      usedFallback,
      ...downgradeInfo,
    });

    const response = NextResponse.json<VerifyClaimResponse>({ sourceCard });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;

  } catch (error: unknown) {
    console.error('[verify-claim] Error:', {
      name: error instanceof Error ? error.name : typeof error,
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
      claimId: body?.claim?.id,
      claimType: body?.claim?.claimType,
      model: body?.model,
      isBYOK: !!customApiKey,
    });

    // Log provider errors via observability layer
    if (isGeminiError(error)) {
      const category = classifyGeminiErrorCode(error.code);
      logProviderError({
        category,
        route: '/api/verify-claim',
        model: body?.model,
        providerType: customApiKey ? 'byok' : 'gemini',
        retryable: isRetryableCategory(category),
        context: `code=${error.code}`,
      });
    } else {
      logRouteFailure({
        route: '/api/verify-claim',
        category: 'internal_error',
        statusCode: 500,
        model: body?.model,
        providerType: customApiKey ? 'byok' : 'gemini',
        retryable: false,
        context: error instanceof Error ? error.name : 'unknown error',
      });
    }

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
          statusCode = customApiKey ? 401 : 500;
          errorResponse = {
            error: customApiKey
              ? 'The supplied Google AI Studio key was rejected. Update it in settings and try again.'
              : 'Server configuration error. Contact support.',
            errorCode: customApiKey ? 'INVALID_API_KEY' : 'AUTH_ERROR',
            retryable: false,
          };
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
