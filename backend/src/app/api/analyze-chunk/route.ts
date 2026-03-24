import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSON, generateEmbedding, isGeminiError } from '@/lib/gemini';
import { buildClaimExtractionPrompt, buildMeetingClaimExtractionPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { verifyBearerSessionToken } from '@/proxy';
import { logRouteFailure, logProviderError, classifyGeminiErrorCode, isRetryableCategory } from '@/lib/observability';
import { validateClientSecretAuth } from '@/lib/client-secret-auth';
import { normalizeExtractedClaim } from '@/lib/claim-normalization';
import type {
  AnalyzeChunkRequest,
  AnalyzeChunkResponse,
  ClaimType,
  ExtractionActionState,
  ExtractedClaim,
  TranscriptChunk,
} from '@/types/shared';

// Force Node.js runtime - Edge runtime doesn't support ioredis
export const runtime = 'nodejs';

// ============================================================================
// CONSTANTS
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_POINTS = 80;
const RATE_LIMIT_COST = 2;

const VALID_MODEL_ACTION_STATES = new Set<Exclude<ExtractionActionState, 'PARSE_ERROR'>>([
  'VERIFYING',
  'REJECTED',
  'BUFFERING',
]);

const MAX_CHUNKS_PER_REQUEST = 20;
const MAX_CHUNK_TEXT_LENGTH = 1200;
const MAX_COMBINED_TRANSCRIPT_LENGTH = 16_000;
const MAX_METADATA_FIELD_LENGTH = 300;
const EXTRACTION_OVERLOAD_RETRY_COUNT = 1;
const EXTRACTION_OVERLOAD_RETRY_DELAY_MS = 250;
const EXTRACTION_OVERLOAD_BUFFERING_REASON =
  'Claim extraction is delayed due to provider load. Retrying shortly.';

const CLAIM_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: { type: 'string' },
    },
    has_claim: { type: 'boolean' },
    action_state: {
      type: 'string',
      enum: ['VERIFYING', 'REJECTED', 'BUFFERING', 'PARSE_ERROR'],
    },
    reason: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim_text: { type: 'string' },
          exact_quote: { type: 'string' },
          claim_type: {
            type: 'string',
            enum: ['canonical', 'study', 'statistic', 'historical', 'surprising'],
          },
          verifiability: { type: 'number' },
          value: { type: 'number' },
          speaker_confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: [
          'claim_text',
          'exact_quote',
          'claim_type',
          'verifiability',
          'value',
          'speaker_confidence',
          'reason',
        ],
      },
    },
  },
  required: ['entities', 'has_claim', 'action_state', 'reason'],
  additionalProperties: false,
} as const;

// ============================================================================
// TYPES
// ============================================================================

type RawCandidate = {
  claim_text: string;
  exact_quote: string;
  claim_type: ClaimType;
  verifiability: number;
  value: number;
  speaker_confidence: number;
  reason: string;
};

type RawExtraction = {
  entities?: unknown;
  has_claim?: unknown;
  action_state?: unknown;
  reason?: unknown;
  candidates?: RawCandidate[] | null;
};

type NormalizedClaimResult = {
  claimText: string | null;
  exactQuote: string | null;
  claimType: ClaimType | null;
  hasClaim: boolean;
  malformedClaimPayload: boolean;
  allCandidatesRejected: boolean;
  actionState: ExtractionActionState;
  reason: string;
  claims: ExtractedClaim[];
  metrics: {
    rawCandidates: number;
    anchorFiltered: number;
    qualityFiltered: number;
    verifiabilityFiltered: number;
    finalCandidates: number;
  };
};

// ============================================================================
// RATE LIMITING (uses shared checkRateLimit from @/lib/rate-limit)
// ============================================================================

// ============================================================================
// PURE HELPERS
// ============================================================================

function setCorsHeaders(response: NextResponse, request: NextRequest): void {
  Object.entries(getCorsHeaders(request)).forEach(([key, value]) => {
    if (value) response.headers.set(key, value);
  });
}

function jsonWithCors<T>(
  request: NextRequest,
  body: T,
  init?: ResponseInit
): NextResponse<T> {
  const response = NextResponse.json(body, init);
  setCorsHeaders(response, request);
  return response;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildChunkRange(chunks: TranscriptChunk[]): { startIndex: number; endIndex: number } {
  return {
    startIndex: chunks[0].index,
    endIndex: chunks[chunks.length - 1].index,
  };
}

function summarizeTranscriptWindow(chunks: TranscriptChunk[]) {
  return chunks.map((chunk) => ({
    index: chunk.index,
    startTime: chunk.startTime,
    duration: chunk.duration,
    text: chunk.text.slice(0, 140),
  }));
}

const normalizeText = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();

function resolveClaimTimestamp(
  chunks: TranscriptChunk[],
  exactQuote: string,
  fallback: number
): number {
  const normalizedQuote = normalizeText(exactQuote);
  if (!normalizedQuote) {
    return fallback;
  }

  // Combine all chunks into one continuous string for robust matching.
  const combinedTranscript = normalizeText(chunks.map((c) => c.text).join(' '));
  const quoteIndex = combinedTranscript.indexOf(normalizedQuote);

  if (quoteIndex === -1) {
    return fallback;
  }

  // Find the chunk that contains the start of the quote.
  let currentPos = 0;
  for (const chunk of chunks) {
    const chunkLen = normalizeText(chunk.text).length + 1; // +1 for the space used in join
    if (quoteIndex >= currentPos && quoteIndex < currentPos + chunkLen) {
      return chunk.startTime;
    }
    currentPos += chunkLen;
  }

  return chunks[0].startTime;
}

// Anchor validation: returns true only if the exact_quote can be found within
// the transcript window. Rejects hallucinated quotes that aren't in the text.
function findAnchorInWindow(chunks: TranscriptChunk[], exactQuote: string): boolean {
  const normalizedQuote = normalizeText(exactQuote);
  if (!normalizedQuote) return false;
  const combinedTranscript = normalizeText(chunks.map((c) => c.text).join(' '));
  return combinedTranscript.includes(normalizedQuote);
}

const inferConfidence = (claimType: ClaimType): number => {
  // Base confidence by claim type - canonical and study claims are most reliable
  switch (claimType) {
    case 'canonical':
      return 0.92;
    case 'study':
      return 0.89;
    case 'statistic':
      return 0.86;
    case 'historical':
      return 0.82;
    case 'surprising':
      return 0.75;
  }
};

const inferClaimType = (claimText: string): ClaimType => {
  if (
    /\b(law|theorem|principle|axiom|postulate)\b/i.test(claimText) &&
    /\b(states?|says?|holds?|shows?|proves?)\b/i.test(claimText)
  ) {
    return 'canonical';
  }

  if (/\b(study|research|paper|journal|trial|experiment|data)\b/i.test(claimText)) {
    return 'study';
  }

  if (/\b(\d+(?:\.\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b/i.test(claimText)) {
    return 'statistic';
  }

  if (/\b(was|were|built|developed|released|launched|created|founded|completed|canceled|cancelled|won|lost|died)\b/i.test(claimText)) {
    return 'historical';
  }

  return 'surprising';
};

// ============================================================================
// CLAIM QUALITY FILTER (Backend Safety Net)
// ============================================================================

/**
 * Strict quality filter to catch garbage claims that slip through the prompt.
 * This is the backstop for the extraction pipeline — if the AI hallucinates
 * fragments or low-quality claims, we reject them here.
 */
function passesQualityFilter(candidate: RawCandidate): { passes: boolean; reason: string } {
  const claimText = typeof candidate.claim_text === 'string' ? candidate.claim_text.trim() : '';
  const exactQuote = typeof candidate.exact_quote === 'string' ? candidate.exact_quote.trim() : '';
  
  // 1. Minimum length check (6 words - allowing concise factual claims)
  const wordCount = claimText.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 6) {
    return { passes: false, reason: `Claim too short (${wordCount} words, min 6)` };
  }
  
  // 2. Must contain substance: proper noun, date, year, OR number
  // RELAXED: Also allows clear factual statements with causal/mechanistic language
  const hasProperNoun = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(claimText) || // Full names
                       /\b(Google|Microsoft|Apple|Amazon|Tesla|Biden|Trump|China|Russia|Europe|NASA|WHO|FDA|CDC|UN|EU|MIT|Stanford|Harvard)\b/.test(claimText);
  const hasDate = /\b(19|20)\d{2}\b/.test(claimText) || // Years 1900-2099
                 /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/.test(claimText);
  const hasNumber = /\d+(?:\.\d+)?%?|\$\d+(?:\.\d+)?\s*(?:million|billion|trillion)?|\b\d+\s*(?:million|billion|trillion|percent|%)\b/i.test(claimText) ||
                    /\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\s+(percent|people|years|dollars|times)\b/i.test(claimText);
  // Factual indicators: causal claims, scientific mechanisms, definitive statements
  const hasFactualIndicator = /\b(causes?|caused|increases?|decreases?|reduces?|prevents?|triggers?|leads?\s+to|results?\s+in|linked\s+to|associated\s+with)\b/i.test(claimText) ||
                              /\b(is|are|was|were)\s+(a|an|the)?\s*(known|proven|shown|established|documented|scientific)\b/i.test(claimText);
  
  if (!hasProperNoun && !hasDate && !hasNumber && !hasFactualIndicator) {
    return { passes: false, reason: 'Claim lacks substance (no proper noun, date, number, or clear factual indicator)' };
  }
  
  // 3. Reject questions
  if (/^(what|why|how|when|where|who|is|are|does|did|will|would|could|should)\s/i.test(claimText.toLowerCase()) ||
      claimText.endsWith('?')) {
    return { passes: false, reason: 'Claim is a question' };
  }
  
  // 4. Reject obvious fragments (ellipsis at start or end, mid-sentence truncation)
  if (exactQuote.startsWith('...') || exactQuote.endsWith('...') ||
      /^\[?\.\.\./.test(exactQuote) || // Starts with [From... or ...
      exactQuote.endsWith('...]') ||
      /^(from|we|they|he|she|it|but|and|or|so|if|then|when|where|what|why|how)\s+\w{0,5}\.\.\./i.test(exactQuote) || // [From..., We could...
      /\b(from|we|they|he|she|it|but|and|or|so|if|then)\s+\w{0,5}$/i.test(exactQuote)) { // Ends mid-thought
    return { passes: false, reason: 'Claim is a sentence fragment' };
  }
  
  // 5. Verifiability check
  const verifiability = typeof candidate.verifiability === 'number' ? candidate.verifiability : 0;
  if (verifiability < 0.65) {
    return { passes: false, reason: `Verifiability too low (${verifiability.toFixed(2)} < 0.65)` };
  }
  
  return { passes: true, reason: 'Quality checks passed' };
}

// ============================================================================
// CLAIM NORMALIZATION
// ============================================================================

async function normalizeClaimResult(
  rawExtraction: RawExtraction,
  chunks: TranscriptChunk[],
  approximateTimestamp: number,
  customApiKey?: string
): Promise<NormalizedClaimResult> {
  // ---- Candidate extraction with anchor validation ----
  // If the model returns a `candidates` array, validate each one's exact_quote
  // against the transcript window. Reject any candidate whose quote can't be
  // found in the text — this catches hallucinated quotes.
  let claimText: string | null = null;
  let exactQuote: string | null = null;
  let claimType: ClaimType | null = null;
  let allCandidatesRejected = false;

  const rawCandidates = Array.isArray(rawExtraction?.candidates)
    ? rawExtraction.candidates
    : null;

  // METRICS: Track candidate filtering
  let candidatesFilteredByAnchor = 0;
  let candidatesFilteredByQuality = 0;
  let candidatesFilteredByVerifiability = 0;
  let finalCandidateCount = 0;
  
  console.log('[analyze-chunk:candidates] Raw candidates from LLM:', rawCandidates?.length || 0, 
    rawCandidates?.map(c => ({ text: c.claim_text?.slice(0, 50), verifiability: c.verifiability })));
  
  if (rawCandidates && rawCandidates.length > 0) {
    // Filter candidates with valid quotes found in transcript
    const validCandidates = rawCandidates.filter((candidate) => {
      const quote = typeof candidate.exact_quote === 'string' ? candidate.exact_quote.trim() : '';
      const isValid = quote && findAnchorInWindow(chunks, quote);
      if (!isValid) candidatesFilteredByAnchor++;
      return isValid;
    });

    // Score and rank candidates by quality (verifiability × value × speaker_confidence)
    // Apply strict quality filter as backend safety net
    // Note: Uses outer candidatesFilteredByQuality declared at line 325
    
    const scoredBeforeVerifiability = validCandidates.map((candidate) => {
      const verifiability = typeof candidate.verifiability === 'number' 
        ? Math.max(0, Math.min(1, candidate.verifiability)) 
        : 0.5;
      const value = typeof candidate.value === 'number' 
        ? Math.max(0, Math.min(1, candidate.value)) 
        : 0.5;
      const speakerConfidence = typeof candidate.speaker_confidence === 'number' 
        ? Math.max(0, Math.min(1, candidate.speaker_confidence)) 
        : 0.5;
      // Composite score weighted toward verifiability and value
      const compositeScore = (verifiability * 0.4) + (value * 0.35) + (speakerConfidence * 0.25);
      return { candidate, compositeScore, verifiability };
    });
    
    const scoredCandidates = scoredBeforeVerifiability
      // Apply quality filter (backend safety net for garbage claims)
      .filter((scored) => {
        const qualityCheck = passesQualityFilter(scored.candidate);
        if (!qualityCheck.passes) {
          candidatesFilteredByQuality++;
          console.log('[analyze-chunk:quality-filter] Rejected:', qualityCheck.reason, 
            '| Claim:', scored.candidate.claim_text?.slice(0, 50));
          return false;
        }
        return true;
      })
      // Filter out low-verifiability candidates (< 0.65) - not concrete enough to check
      .filter((scored) => {
        const passes = scored.verifiability >= 0.65;
        if (!passes) candidatesFilteredByVerifiability++;
        return passes;
      })
      // Sort by composite score descending
      .sort((a, b) => b.compositeScore - a.compositeScore);
    
    finalCandidateCount = scoredCandidates.length;

    // Log detailed metrics
    console.log('[analyze-chunk:metrics]', {
      rawCandidates: rawCandidates.length,
      anchorFiltered: candidatesFilteredByAnchor,
      qualityFiltered: candidatesFilteredByQuality,
      verifiabilityFiltered: candidatesFilteredByVerifiability,
      finalCandidates: scoredCandidates.length,
      selected: scoredCandidates.length > 0 ? scoredCandidates[0].candidate.claim_text?.slice(0, 60) : null,
    });

    if (scoredCandidates.length === 0) {
      allCandidatesRejected = true;
    } else {
      // Take the highest-scoring candidate
      const best = scoredCandidates[0].candidate;
      claimText = typeof best.claim_text === 'string' && best.claim_text.trim()
        ? best.claim_text.trim()
        : null;
      exactQuote = typeof best.exact_quote === 'string' && best.exact_quote.trim()
        ? best.exact_quote.trim()
        : null;
      claimType = best.claim_type;
    }
  }

  const requestedHasClaim =
    rawExtraction?.has_claim === true ||
    (rawCandidates !== null && !allCandidatesRejected && claimText !== null);

  const hasClaim = !allCandidatesRejected && claimText !== null;
  const malformedClaimPayload = !allCandidatesRejected && requestedHasClaim && claimText === null;

  const rawActionState = VALID_MODEL_ACTION_STATES.has(
    rawExtraction?.action_state as Exclude<ExtractionActionState, 'PARSE_ERROR'>
  )
    ? (rawExtraction.action_state as Exclude<ExtractionActionState, 'PARSE_ERROR'>)
    : null;

  const actionState = allCandidatesRejected
    ? 'REJECTED'
    : hasClaim
      ? 'VERIFYING'
      : rawActionState && rawActionState !== 'VERIFYING'
        ? rawActionState
        : 'BUFFERING';

  const reason = allCandidatesRejected
    ? 'All candidate quotes were not found in the transcript window.'
    : malformedClaimPayload
      ? 'Model marked a claim but returned no usable claim text.'
      : typeof rawExtraction?.reason === 'string' && rawExtraction.reason.trim().length > 0
        ? rawExtraction.reason.trim()
        : hasClaim
          ? 'Claim detected.'
          : 'Awaiting end of statement...';

  const finalClaimType = claimType ?? (claimText ? inferClaimType(claimText) : null);

  // Generate embedding for semantic deduplication
  let claimEmbedding: number[] | undefined;
  if (hasClaim && claimText) {
    claimEmbedding = await generateEmbedding(claimText, customApiKey, 'SEMANTIC_SIMILARITY');
  }

  const claims: ExtractedClaim[] =
    hasClaim && claimText && finalClaimType
      ? [
          {
            id: crypto.randomUUID(),
            claimText,
            claimType: finalClaimType,
            exactQuote: exactQuote || claimText,
            timestampSeconds: resolveClaimTimestamp(
              chunks,
              exactQuote || claimText,
              approximateTimestamp
            ),
            confidence: inferConfidence(finalClaimType),
            ...(claimEmbedding && claimEmbedding.length > 0 ? { embedding: claimEmbedding } : {}),
          },
        ]
      : [];

  if (claims.length > 0) {
    try {
      claims[0] = {
        ...claims[0],
        ...normalizeExtractedClaim({
          claimText: claims[0].claimText,
          claimType: claims[0].claimType,
        }),
      };
    } catch (error) {
      console.warn(
        '[analyze-chunk] Claim normalization failed; continuing with raw extracted claim.',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return {
    claimText,
    exactQuote,
    claimType,
    hasClaim,
    malformedClaimPayload,
    allCandidatesRejected,
    actionState,
    reason,
    claims,
    metrics: {
      rawCandidates: rawCandidates?.length || 0,
      anchorFiltered: candidatesFilteredByAnchor,
      qualityFiltered: candidatesFilteredByQuality,
      verifiabilityFiltered: candidatesFilteredByVerifiability,
      finalCandidates: finalCandidateCount,
    },
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateAnalyzeChunkRequest(body: AnalyzeChunkRequest): string | null {
  if (!body.videoId?.trim()) {
    return 'videoId is required.';
  }

  if (body.videoId.length > 128) {
    return 'videoId is too long.';
  }

  if ((body.videoTitle || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'videoTitle is too long.';
  }

  if ((body.channelName || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'channelName is too long.';
  }

  if (!Number.isFinite(body.currentTimestamp) || body.currentTimestamp < 0) {
    return 'currentTimestamp must be a non-negative number.';
  }

  if (!Array.isArray(body.chunks) || body.chunks.length === 0) {
    return 'No transcript chunks provided.';
  }

  if (body.chunks.length > MAX_CHUNKS_PER_REQUEST) {
    return `Too many chunks. Maximum is ${MAX_CHUNKS_PER_REQUEST}.`;
  }

  let combinedLength = 0;
  for (const chunk of body.chunks) {
    if (typeof chunk.text !== 'string' || !chunk.text.trim()) {
      return 'Each chunk must include non-empty text.';
    }

    if (chunk.text.length > MAX_CHUNK_TEXT_LENGTH) {
      return `Chunk text exceeds ${MAX_CHUNK_TEXT_LENGTH} characters.`;
    }

    if (!Number.isFinite(chunk.startTime) || chunk.startTime < 0) {
      return 'Chunk startTime must be a non-negative number.';
    }

    if (!Number.isFinite(chunk.duration) || chunk.duration < 0) {
      return 'Chunk duration must be a non-negative number.';
    }

    if (!Number.isInteger(chunk.index) || chunk.index < 0) {
      return 'Chunk index must be a non-negative integer.';
    }

    combinedLength += chunk.text.length;
  }

  if (combinedLength > MAX_COMBINED_TRANSCRIPT_LENGTH) {
    return `Combined transcript text is too long (max ${MAX_COMBINED_TRANSCRIPT_LENGTH} chars).`;
  }

  return null;
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

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
  // -------------------------------------------------------------------------
  // PHASE 0: Pre-shared client secret authentication (additional layer)
  // -------------------------------------------------------------------------
  const clientSecretAuth = validateClientSecretAuth(request);
  if (!clientSecretAuth.authorized) {
    return clientSecretAuth.response;
  }

  let body: AnalyzeChunkRequest | null = null;
  // Declare outside try for error handling access
  const extensionId = request.headers.get('x-extension-id')?.trim() || '';
  const customApiKey = request.headers.get('x-custom-api-key')?.trim();
  const hasCustomKey = !!customApiKey && customApiKey.length > 0;

  try {
    // -------------------------------------------------------------------------
    // PHASE 1: Parse and validate request body
    // -------------------------------------------------------------------------
    const parsedBody = (await request.json()) as AnalyzeChunkRequest;
    body = parsedBody;

    const validationError = validateAnalyzeChunkRequest(parsedBody);
    if (validationError) {
      return jsonWithCors(request, { error: validationError }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // PHASE 2: Session authentication
    // -------------------------------------------------------------------------
    const identity = extensionId ? `ext:${extensionId}` : 'unknown';
    const sessionAuth = await verifyBearerSessionToken(request, extensionId, identity);
    
    if (!sessionAuth.authorized) {
      logRouteFailure({
        route: '/api/analyze-chunk',
        category: 'auth_error',
        statusCode: 401,
        retryable: false,
        context: 'session token invalid or missing',
      });
      return jsonWithCors(
        request,
        { error: 'Unauthorized. Valid session token required.' },
        { status: 401 }
      );
    }

    // -------------------------------------------------------------------------
    // PHASE 3: Rate limiting check (BYOK status already captured above)
    // -------------------------------------------------------------------------

    // -------------------------------------------------------------------------
    // PHASE 4: Rate limiting check (skipped for BYOK via shared rate limiter)
    // -------------------------------------------------------------------------
    const rateLimitResult = await checkRateLimit(request, identity);
    if (!rateLimitResult.allowed) {
      logRouteFailure({
        route: '/api/analyze-chunk',
        category: 'rate_limited',
        statusCode: 429,
        retryable: true,
        providerType: hasCustomKey ? 'byok' : 'unknown',
        context: `retryAfter=${rateLimitResult.retryAfter}`,
      });
      return jsonWithCors(
        request,
        { error: 'Rate limit exceeded. Please retry shortly.' },
        { status: 429, headers: { 'Retry-After': String(rateLimitResult.retryAfter) } }
      );
    }

    console.log('[analyze-chunk] Request:', {
      videoId: parsedBody.videoId,
      model: parsedBody.model,
      hasCustomKey: !!customApiKey,
      chunkCount: parsedBody.chunks.length,
    });
    console.log('[analyze-chunk:window]', {
      videoId: parsedBody.videoId,
      currentTimestamp: parsedBody.currentTimestamp,
      chunkRange: buildChunkRange(parsedBody.chunks),
      chunks: summarizeTranscriptWindow(parsedBody.chunks),
    });

    // -------------------------------------------------------------------------
    // PHASE 5: Build prompt
    // -------------------------------------------------------------------------
    const combinedText = parsedBody.chunks.map((chunk) => chunk.text).join('\n\n');
    const approximateTimestamp = parsedBody.chunks[0].startTime;

    const prompt = parsedBody.sourceType === 'meet'
      ? buildMeetingClaimExtractionPrompt(
          combinedText,
          parsedBody.videoTitle || 'Meeting',
          parsedBody.channelName || 'Google Meet',
          approximateTimestamp
        )
      : buildClaimExtractionPrompt(
          combinedText,
          parsedBody.videoTitle || 'Unknown Video',
          parsedBody.channelName || 'Unknown Channel',
          approximateTimestamp
        );

    // -------------------------------------------------------------------------
    // PHASE 6: Call Gemini
    // -------------------------------------------------------------------------
    // Extraction always uses flash-lite — structured output, no grounding needed
    const effectiveModel = 'gemini-3.1-flash-lite-preview';
    let rawExtraction: RawExtraction | null = null;
    let inputTokens = 0;
    let outputTokens = 0;

    for (let attempt = 0; attempt <= EXTRACTION_OVERLOAD_RETRY_COUNT; attempt += 1) {
      try {
        const extraction = await askGeminiJSON<RawExtraction>(
          prompt,
          2000,
          CLAIM_EXTRACTION_SCHEMA,
          effectiveModel,
          customApiKey,
          '/api/analyze-chunk'
        );
        rawExtraction = extraction.data;
        inputTokens = extraction.inputTokens;
        outputTokens = extraction.outputTokens;
        break;
      } catch (error: unknown) {
        const isOverloaded = isGeminiError(error) && error.code === 'OVERLOADED';

        if (!isOverloaded) {
          throw error;
        }

        if (attempt < EXTRACTION_OVERLOAD_RETRY_COUNT) {
          console.warn('[analyze-chunk] Extraction model overloaded, retrying once.', {
            model: effectiveModel,
            delayMs: EXTRACTION_OVERLOAD_RETRY_DELAY_MS,
          });
          await sleep(EXTRACTION_OVERLOAD_RETRY_DELAY_MS);
          continue;
        }

        logProviderError({
          category: classifyGeminiErrorCode(error.code),
          route: '/api/analyze-chunk',
          model: effectiveModel,
          providerType: customApiKey ? 'byok' : 'gemini',
          retryable: isRetryableCategory(classifyGeminiErrorCode(error.code)),
          context: 'code=OVERLOADED retry_exhausted=true',
        });

        console.warn('[analyze-chunk] Extraction model still overloaded after retry; returning buffering response.', {
          model: effectiveModel,
        });

        return jsonWithCors<AnalyzeChunkResponse>(request, {
          entities: [],
          has_claim: false,
          claim_text: null,
          action_state: 'BUFFERING',
          reason: EXTRACTION_OVERLOAD_BUFFERING_REASON,
          claims: [],
          chunkRange: buildChunkRange(parsedBody.chunks),
        });
      }
    }

    if (!rawExtraction) {
      throw new Error('Extraction response missing after overload handling.');
    }

    // -------------------------------------------------------------------------
    // PHASE 7: Normalize entities
    // -------------------------------------------------------------------------
    console.log('[analyze-chunk:raw] LLM response:', JSON.stringify(rawExtraction).slice(0, 500));
    
    const entities = Array.isArray(rawExtraction?.entities)
      ? rawExtraction.entities.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0
        )
      : [];

    // -------------------------------------------------------------------------
    // PHASE 8: Normalize claims
    // -------------------------------------------------------------------------
    const {
      hasClaim,
      malformedClaimPayload,
      actionState,
      reason,
      claims,
      metrics: extractionMetrics,
    } = await normalizeClaimResult(rawExtraction, parsedBody.chunks, approximateTimestamp, customApiKey);

    if (malformedClaimPayload) {
      console.warn('[analyze-chunk] Model returned has_claim=true without usable claim_text.');
    }

    // -------------------------------------------------------------------------
    // PHASE 9: Build and return response
    // -------------------------------------------------------------------------
    console.info('[analyze-chunk]', {
      videoId: parsedBody.videoId,
      chunkCount: parsedBody.chunks.length,
      entityCount: entities.length,
      actionState,
      claimCount: claims.length,
      inputTokens,
      outputTokens,
    });

    return jsonWithCors<AnalyzeChunkResponse>(request, {
      entities,
      has_claim: hasClaim,
      claim_text: claims[0]?.claimText ?? null,
      action_state: actionState,
      reason,
      claims,
      chunkRange: buildChunkRange(parsedBody.chunks),
      _metrics: extractionMetrics,
    });

  } catch (error: unknown) {
    // -------------------------------------------------------------------------
    // ERROR HANDLING
    // -------------------------------------------------------------------------
    console.error('[analyze-chunk] RAW ERROR:', error);
    console.error('[analyze-chunk] Error details:', {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : 'N/A',
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
      stack: error instanceof Error ? error.stack : 'N/A',
    });

    // Log provider errors via observability layer
    if (isGeminiError(error)) {
      const category = classifyGeminiErrorCode(error.code);
      logProviderError({
        category,
        route: '/api/analyze-chunk',
        model: body?.model,
        providerType: customApiKey ? 'byok' : 'gemini',
        retryable: isRetryableCategory(category),
        context: `code=${error.code}`,
      });
    } else {
      logRouteFailure({
        route: '/api/analyze-chunk',
        category: 'internal_error',
        statusCode: 500,
        model: body?.model,
        providerType: customApiKey ? 'byok' : 'gemini',
        retryable: false,
        context: error instanceof Error ? error.name : 'unknown error',
      });
    }

    // PARSE_ERROR: Surface distinct state for model output failures
    if (body && isGeminiError(error) && error.code === 'PARSE_ERROR') {
      console.warn('[analyze-chunk] PARSE_ERROR — model output failed validation.', {
        code: error.code,
        status: error.status,
      });
      return jsonWithCors<AnalyzeChunkResponse>(request, {
        entities: [],
        has_claim: false,
        claim_text: null,
        action_state: 'PARSE_ERROR',
        reason: `Model output could not be parsed: ${error.message.substring(0, 120)}`,
        claims: [],
        chunkRange: buildChunkRange(body.chunks),
      });
    }

    // RATE_LIMITED: Return 429
    if (isGeminiError(error) && error.code === 'RATE_LIMITED') {
      return jsonWithCors(
        request,
        { error: 'Rate limited. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    // QUOTA_EXHAUSTED: Return 429 with specific message
    if (isGeminiError(error) && error.code === 'QUOTA_EXHAUSTED') {
      return jsonWithCors(
        request,
        { error: 'API quota exhausted. Please try again later or add your own API key in settings.', errorCode: 'QUOTA_EXHAUSTED' },
        { status: 429 }
      );
    }

    // AUTH_ERROR: Return 500 with generic message
    if (isGeminiError(error) && error.code === 'AUTH_ERROR') {
      if (customApiKey) {
        return jsonWithCors(
          request,
          {
            error: 'The supplied Google AI Studio key was rejected. Update it in settings and try again.',
            errorCode: 'INVALID_API_KEY',
          },
          { status: 401 }
        );
      }
      return jsonWithCors(
        request,
        { error: 'Server configuration error. Contact support.' },
        { status: 500 }
      );
    }

    // Generic error
    return jsonWithCors(
      request,
      { error: 'Failed to analyze transcript chunk.' },
      { status: 500 }
    );
  }
}
