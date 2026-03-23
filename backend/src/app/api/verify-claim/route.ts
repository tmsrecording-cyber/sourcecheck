// Force Node.js runtime - Redis rate limiting requires Node.js APIs
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSONWithSearch, generateEmbedding, isGeminiError } from '@/lib/gemini';
import { buildAdvocatePrompt, buildChallengerPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import { verifyBearerSessionToken } from '@/proxy';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { logRouteFailure, logProviderError, classifyGeminiErrorCode, isRetryableCategory } from '@/lib/observability';
import { validateClientSecretAuth } from '@/lib/client-secret-auth';
import { findSimilarClaim, findRelatedClaims, upsertClaimVector } from '@/lib/vector-store';
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

  // Model returned unverifiable — but if Gemini actually found grounding sources
  // (the search returned relevant pages, just couldn't match a URL to the title),
  // downgrade to partial rather than keeping unverifiable. Something was found.
  if (params.parsedStatus === 'unverifiable') {
    return params.hasGroundingSources ? 'partial' : 'unverifiable';
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

// ============================================================================
// ADVERSARIAL VERIFICATION (Phase D)
// ============================================================================

const ADVERSARIAL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['supported', 'partial', 'disputed', 'unverifiable'] },
    sourceTitle: { type: 'string' },
    sourceType: { type: 'string', enum: ['academic_paper', 'news_article', 'official_source', 'wikipedia', 'other'] },
    nuance: { type: 'string' },
    evidenceSnippet: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    confidence: { type: 'number' },
  },
  required: ['status', 'sourceTitle', 'sourceType', 'nuance', 'confidence'],
  additionalProperties: false,
};

interface AdversarialResult {
  status: VerificationStatus;
  sourceTitle: string;
  sourceType: string;
  nuance: string;
  evidenceSnippet?: string | null;
  confidence: number;
  sources: Array<{ title: string; url: string }>;
}

const STATUS_STRENGTH: Record<VerificationStatus, number> = {
  supported: 3,
  partial: 2,
  disputed: 1,
  unverifiable: 0,
};

/**
 * Synthesize advocate + challenger results into a single verdict.
 * Rules:
 * 1. Both agree → use that status, pick best evidence
 * 2. Advocate stronger than challenger → lean toward advocate but note challenger's concerns
 * 3. Challenger found real problems → use challenger's status, explain tension
 * 4. Both unverifiable → unverifiable
 * 5. Nuance ALWAYS explains what both sides found
 */
function synthesizeVerification(
  advocate: AdversarialResult,
  challenger: AdversarialResult
): RawVerification & { confidence: number; synthesizedNuance: string } {
  const advStatus = advocate.status;
  const chalStatus = challenger.status;

  // Both agree on status
  if (advStatus === chalStatus) {
    // Pick the higher-confidence result for source/evidence
    const primary = advocate.confidence >= challenger.confidence ? advocate : challenger;
    return {
      status: advStatus,
      sourceTitle: primary.sourceTitle,
      sourceType: primary.sourceType,
      nuance: primary.nuance,
      evidenceSnippet: primary.evidenceSnippet,
      confidence: (advocate.confidence + challenger.confidence) / 2,
      synthesizedNuance: primary.nuance,
    };
  }

  // Both unverifiable
  if (advStatus === 'unverifiable' && chalStatus === 'unverifiable') {
    return {
      status: 'unverifiable',
      sourceTitle: advocate.sourceTitle || challenger.sourceTitle,
      sourceType: 'other',
      nuance: 'No sources found from either supporting or challenging perspective.',
      evidenceSnippet: null,
      confidence: 0,
      synthesizedNuance: 'No sources found from either supporting or challenging perspective.',
    };
  }

  // One found something, one found nothing → trust the one with evidence
  if (advStatus === 'unverifiable' && chalStatus !== 'unverifiable') {
    return {
      status: chalStatus,
      sourceTitle: challenger.sourceTitle,
      sourceType: challenger.sourceType,
      nuance: challenger.nuance,
      evidenceSnippet: challenger.evidenceSnippet,
      confidence: challenger.confidence * 0.8, // Discount — only one perspective
      synthesizedNuance: challenger.nuance,
    };
  }
  if (chalStatus === 'unverifiable' && advStatus !== 'unverifiable') {
    return {
      status: advStatus,
      sourceTitle: advocate.sourceTitle,
      sourceType: advocate.sourceType,
      nuance: advocate.nuance,
      evidenceSnippet: advocate.evidenceSnippet,
      confidence: advocate.confidence * 0.8,
      synthesizedNuance: advocate.nuance,
    };
  }

  // Both found evidence but disagree — the interesting case
  const advStrength = STATUS_STRENGTH[advStatus] * advocate.confidence;
  const chalStrength = STATUS_STRENGTH[chalStatus] * challenger.confidence;

  // Challenger found real counter-evidence (disputed or partial with high confidence)
  if (chalStatus === 'disputed' && challenger.confidence >= 0.6) {
    // Challenger wins if it has strong counter-evidence
    const finalStatus: VerificationStatus = advStatus === 'supported' ? 'partial' : 'disputed';
    // Build synthesized nuance showing both sides
    const synthesizedNuance = advocate.confidence >= 0.5
      ? `${advocate.nuance.replace(/[.;]$/, '')} · ${challenger.nuance}`
      : challenger.nuance;
    return {
      status: finalStatus,
      sourceTitle: challenger.sourceTitle, // Counter-evidence is the more interesting source
      sourceType: challenger.sourceType,
      nuance: synthesizedNuance.slice(0, MAX_NUANCE_LENGTH),
      evidenceSnippet: challenger.evidenceSnippet || advocate.evidenceSnippet,
      confidence: (advocate.confidence + challenger.confidence) / 2,
      synthesizedNuance: synthesizedNuance.slice(0, MAX_NUANCE_LENGTH),
    };
  }

  // Challenger found complications but not outright dispute
  if (chalStatus === 'partial' && challenger.confidence >= 0.5) {
    const finalStatus: VerificationStatus = 'partial';
    const synthesizedNuance = `${advocate.nuance.replace(/[.;]$/, '')} · ${challenger.nuance}`;
    return {
      status: finalStatus,
      sourceTitle: advocate.sourceTitle, // Advocate's source is primary
      sourceType: advocate.sourceType,
      nuance: synthesizedNuance.slice(0, MAX_NUANCE_LENGTH),
      evidenceSnippet: advocate.evidenceSnippet || challenger.evidenceSnippet,
      confidence: (advocate.confidence + challenger.confidence) / 2,
      synthesizedNuance: synthesizedNuance.slice(0, MAX_NUANCE_LENGTH),
    };
  }

  // Default: advocate wins (challenger didn't find strong counter-evidence)
  return {
    status: advStatus,
    sourceTitle: advocate.sourceTitle,
    sourceType: advocate.sourceType,
    nuance: advocate.nuance,
    evidenceSnippet: advocate.evidenceSnippet,
    confidence: advocate.confidence,
    synthesizedNuance: advocate.nuance,
  };
}

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
        usedFallback: false,
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

    // ---- Adversarial verification with related claim intelligence (Phase D) ----

    // D4: Look up related claims for prior intelligence context
    let relatedClaims: Awaited<ReturnType<typeof findRelatedClaims>> = [];
    if (embedding.length > 0) {
      try {
        relatedClaims = await findRelatedClaims(embedding);
        if (relatedClaims.length > 0) {
          console.log('[verify-claim] Related claims found for intelligence:', {
            claimId: claim.id,
            relatedCount: relatedClaims.length,
            scores: relatedClaims.map((r) => r.score.toFixed(3)),
          });
        }
      } catch (err) {
        console.warn('[verify-claim] Related claim lookup failed, continuing without:', err);
      }
    }

    // Map related claims to the format expected by prompt builders
    const relatedClaimContext = relatedClaims.length > 0
      ? relatedClaims.map((rc) => ({
          claimText: rc.metadata.claimText,
          status: rc.metadata.status,
          sourceTitle: rc.metadata.sourceTitle,
          videoTitle: rc.metadata.videoTitle,
        }))
      : undefined;

    // Build adversarial prompts (advocate searches FOR support, challenger searches AGAINST)
    const advocatePrompt = buildAdvocatePrompt(
      claim.claimText, claim.claimType, contextTranscript, relatedClaimContext
    );
    const challengerPrompt = buildChallengerPrompt(
      claim.claimText, claim.claimType, contextTranscript, relatedClaimContext
    );

    // BYOK: Use header model if provided (from x-custom-model), else fall back to body
    const rawModel = customApiKey && headerModel ? headerModel : body.model;
    // Dual mode: 3.1-flash-lite is used for fast extraction (analyze-chunk) but
    // verification always uses 2.5-flash for better FACTS Grounding accuracy (85.3% vs 40.6%).
    const effectiveModel = rawModel === 'gemini-3.1-flash-lite-preview'
      ? 'gemini-2.5-flash'
      : rawModel;

    console.log('[verify-claim] Adversarial verification:', {
      claimId: claim.id,
      claimType: claim.claimType,
      model: effectiveModel,
      isBYOK: !!customApiKey,
      relatedClaimsInjected: relatedClaims.length,
    });

    let rawVerification: RawVerification;
    let inputTokens: number;
    let outputTokens: number;
    let sources: Array<{ title: string; url: string }>;
    let usedFallback = false;
    // E2: Debate view — raw per-pass nuances surfaced in the expanded card
    let advocateNuance: string | undefined;
    let challengerNuance: string | undefined;
    
    // Helper to check if error is recoverable for retry/fallback
    const isRecoverableGroundingError = (err: unknown): boolean => {
      if (!isGeminiError(err)) return false;
      if (err.code === 'PARSE_ERROR') return true;
      if (err.code === 'API_ERROR') {
        if (err.status === 502 || err.status === 504) return true;
        if (err.message.includes('MAX_TOKENS')) return true;
        if (err.message.includes('SAFETY') ||
            err.message.includes('RECITATION') ||
            err.message.includes('OTHER') ||
            err.message.includes('finishReason')) return true;
      }
      return false;
    };

    // Run a single adversarial pass with one retry on recoverable errors
    const validStatuses: VerificationStatus[] = ['supported', 'partial', 'disputed', 'unverifiable'];

    type PassResult = {
      data: AdversarialResult;
      inputTokens: number;
      outputTokens: number;
      sources: Array<{ title: string; url: string }>;
    };

    const runAdversarialPass = async (
      passPrompt: string,
      role: 'advocate' | 'challenger'
    ): Promise<PassResult | null> => {
      const sanitizePassResult = (d: Record<string, unknown>, passSources: Array<{ title: string; url: string }>): AdversarialResult => ({
        status: validStatuses.includes(d.status as VerificationStatus)
          ? (d.status as VerificationStatus) : 'unverifiable',
        sourceTitle: typeof d.sourceTitle === 'string' ? d.sourceTitle : '',
        sourceType: (typeof d.sourceType === 'string' ? d.sourceType : 'other') as string,
        nuance: typeof d.nuance === 'string' ? d.nuance : '',
        evidenceSnippet: typeof d.evidenceSnippet === 'string' ? d.evidenceSnippet : null,
        confidence: typeof d.confidence === 'number'
          ? Math.max(0, Math.min(1, d.confidence)) : 0.5,
        sources: passSources,
      });

      try {
        const result = await askGeminiJSONWithSearch<Record<string, unknown>>(
          passPrompt, 1200, ADVERSARIAL_SCHEMA, effectiveModel, customApiKey, '/api/verify-claim'
        );
        return {
          data: sanitizePassResult(result.data, result.sources),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          sources: result.sources,
        };
      } catch (firstError) {
        if (isRecoverableGroundingError(firstError)) {
          console.warn(`[verify-claim] ${role} first attempt failed, retrying`, {
            claimId: claim.id, model: effectiveModel,
          });
          try {
            const retry = await askGeminiJSONWithSearch<Record<string, unknown>>(
              passPrompt + '\n\nReturn ONLY valid JSON with no markdown formatting.',
              1800, undefined, effectiveModel, customApiKey, '/api/verify-claim'
            );
            return {
              data: sanitizePassResult(retry.data, retry.sources),
              inputTokens: retry.inputTokens,
              outputTokens: retry.outputTokens,
              sources: retry.sources,
            };
          } catch {
            console.warn(`[verify-claim] ${role} retry also failed`, { claimId: claim.id });
            return null;
          }
        }
        throw firstError; // Non-recoverable — rethrow to outer catch
      }
    };

    // Run advocate + challenger in parallel (same wall-clock latency as single call)
    const [advocateResult, challengerResult] = await Promise.all([
      runAdversarialPass(advocatePrompt, 'advocate'),
      runAdversarialPass(challengerPrompt, 'challenger'),
    ]);

    if (advocateResult && challengerResult) {
      // Both succeeded — synthesize verdicts (D3)
      const synthesized = synthesizeVerification(advocateResult.data, challengerResult.data);
      rawVerification = synthesized;
      inputTokens = advocateResult.inputTokens + challengerResult.inputTokens;
      outputTokens = advocateResult.outputTokens + challengerResult.outputTokens;
      // E2: Capture raw per-pass nuances for the debate view (strip Gemini citation markers)
      const advRaw = advocateResult.data.nuance.replace(/\[\d+\]/g, '').trim().slice(0, MAX_NUANCE_LENGTH);
      const chalRaw = challengerResult.data.nuance.replace(/\[\d+\]/g, '').trim().slice(0, MAX_NUANCE_LENGTH);
      // Only store when both passes have meaningful, distinct findings
      if (advRaw && chalRaw && advRaw !== chalRaw) {
        advocateNuance = advRaw;
        challengerNuance = chalRaw;
      }
      // Merge grounding sources from both sides for best URL matching
      const seenUrls = new Set<string>();
      sources = [...advocateResult.sources, ...challengerResult.sources].filter((s) => {
        if (seenUrls.has(s.url)) return false;
        seenUrls.add(s.url);
        return true;
      });
      console.info('[verify-claim] Synthesis complete:', {
        claimId: claim.id,
        advocateStatus: advocateResult.data.status,
        advocateConf: advocateResult.data.confidence.toFixed(2),
        challengerStatus: challengerResult.data.status,
        challengerConf: challengerResult.data.confidence.toFixed(2),
        synthesizedStatus: synthesized.status,
      });
    } else if (advocateResult || challengerResult) {
      // One succeeded — use it as single-pass result
      const winner = (advocateResult || challengerResult)!;
      const role = advocateResult ? 'advocate' : 'challenger';
      console.warn(`[verify-claim] Only ${role} succeeded, using single-pass`, { claimId: claim.id });
      rawVerification = {
        status: winner.data.status,
        sourceTitle: winner.data.sourceTitle,
        sourceType: winner.data.sourceType,
        nuance: winner.data.nuance,
        evidenceSnippet: winner.data.evidenceSnippet,
      };
      inputTokens = winner.inputTokens;
      outputTokens = winner.outputTokens;
      sources = winner.sources;
    } else {
      // Both failed — graceful fallback
      console.warn('[verify-claim] Both adversarial passes failed, using fallback', { claimId: claim.id });
      usedFallback = true;
      rawVerification = {
        status: 'partial',
        sourceTitle: 'Automated check incomplete',
        sourceType: 'other',
        nuance: 'Automated verification could not complete; verify this claim independently.',
        evidenceSnippet: null,
      };
      inputTokens = 0;
      outputTokens = 0;
      sources = [];
    }

    // ---- Validate status ----
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

    // ---- D5: Contradiction detection across related claims ----
    // If a related claim from another video has a different verdict on a similar topic,
    // surface the discrepancy so the user can investigate.
    let contradictionContext: string | undefined;
    if (relatedClaims.length > 0 && status !== 'unverifiable') {
      const contradictions = relatedClaims.filter((rc) => {
        // Skip if same status — no contradiction
        if (rc.metadata.status === status) return false;
        // Only flag meaningful disagreements (supported↔disputed, or supported↔partial)
        const strength = STATUS_STRENGTH[status];
        const relatedStrength = STATUS_STRENGTH[rc.metadata.status];
        return Math.abs(strength - relatedStrength) >= 2;
      });
      if (contradictions.length > 0) {
        const c = contradictions[0];
        contradictionContext = `A previous check from "${c.metadata.videoTitle}" found "${c.metadata.claimText}" was ${c.metadata.status.toUpperCase()}. The discrepancy may reflect different sources, timeframes, or specifics.`;
        if (contradictionContext.length > MAX_NUANCE_LENGTH) {
          contradictionContext = contradictionContext.slice(0, MAX_NUANCE_LENGTH - 3) + '...';
        }
      }
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
      ...(contradictionContext ? { contradictionContext } : {}),
      ...(advocateNuance ? { advocateNuance } : {}),
      ...(challengerNuance ? { challengerNuance } : {}),
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

    const response = NextResponse.json<VerifyClaimResponse>({
      sourceCard,
      usedFallback,
    });
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
