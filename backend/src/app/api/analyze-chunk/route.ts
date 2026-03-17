import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSON, isGeminiError } from '@/lib/gemini';
import { buildClaimExtractionPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import { InMemoryRateLimitStore } from '@/lib/rate-limit-store';

// Force Node.js runtime - Edge runtime doesn't support ioredis
export const runtime = 'nodejs';

// Simple in-memory rate limiter for this route
const rateLimitStore = new InMemoryRateLimitStore();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_POINTS = 80;
const RATE_LIMIT_COST = 2;
import type {
  AnalyzeChunkRequest,
  AnalyzeChunkResponse,
  ClaimType,
  ExtractionActionState,
  ExtractedClaim,
  TranscriptChunk,
} from '@/types/shared';

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

const VALID_MODEL_ACTION_STATES = new Set<Exclude<ExtractionActionState, 'PARSE_ERROR'>>([
  'VERIFYING',
  'REJECTED',
  'BUFFERING',
]);
const MAX_CHUNKS_PER_REQUEST = 20;
const MAX_CHUNK_TEXT_LENGTH = 1200;
const MAX_COMBINED_TRANSCRIPT_LENGTH = 16_000;
const MAX_METADATA_FIELD_LENGTH = 300;
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
      enum: ['VERIFYING', 'REJECTED', 'BUFFERING'],
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

const normalizeText = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();

const resolveClaimTimestamp = (chunks: TranscriptChunk[], exactQuote: string, fallback: number) => {
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
};

const inferConfidence = (claimType: ClaimType): number => {
  switch (claimType) {
    case 'canonical':  return 0.90;
    case 'study':      return 0.88;
    case 'statistic':  return 0.85;
    case 'historical': return 0.80;
    case 'surprising': return 0.72;
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

// Anchor validation: returns true only if the exact_quote can be found within
// the transcript window. Rejects hallucinated quotes that aren't in the text.
const findAnchorInWindow = (chunks: TranscriptChunk[], exactQuote: string): boolean => {
  const normalizedQuote = normalizeText(exactQuote);
  if (!normalizedQuote) return false;
  const combinedTranscript = normalizeText(chunks.map((c) => c.text).join(' '));
  return combinedTranscript.includes(normalizedQuote);
};

const validateAnalyzeChunkRequest = (body: AnalyzeChunkRequest) => {
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
};

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  let body: AnalyzeChunkRequest | null = null;

  try {
    const parsedBody = await request.json() as AnalyzeChunkRequest;
    body = parsedBody;

    const validationError = validateAnalyzeChunkRequest(parsedBody);
    if (validationError) {
      const response = NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    // Rate limiting check (moved from middleware to route)
    const extensionId = request.headers.get('x-extension-id')?.trim() || 'unknown';
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimitKey = `ext:${extensionId}:ip:${clientIp}:/api/analyze-chunk`;
    
    const allowed = await rateLimitStore.tryConsume(
      rateLimitKey,
      RATE_LIMIT_COST,
      RATE_LIMIT_MAX_POINTS,
      RATE_LIMIT_WINDOW_MS
    );
    
    if (!allowed) {
      const response = NextResponse.json(
        { error: 'Rate limit exceeded. Please retry shortly.' },
        { status: 429 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    // Extract BYOK header - user can provide their own API key
    const customApiKey = request.headers.get('x-custom-api-key')?.trim();
    
    // DEBUG: Log incoming request details
    console.log('[analyze-chunk] Request:', {
      videoId: parsedBody.videoId,
      model: parsedBody.model,
      hasCustomKey: !!customApiKey,
      customKeyLength: customApiKey?.length || 0,
      chunkCount: parsedBody.chunks.length,
    });

    const combinedText = parsedBody.chunks
      .map((chunk) => chunk.text)
      .join('\n\n');

    const approximateTimestamp = parsedBody.chunks[0].startTime;

    const prompt = buildClaimExtractionPrompt(
      combinedText,
      parsedBody.videoTitle || 'Unknown Video',
      parsedBody.channelName || 'Unknown Channel',
      approximateTimestamp
    );

    const { data: rawExtraction, inputTokens, outputTokens } = await askGeminiJSON<RawExtraction>(
      prompt,
      800,
      CLAIM_EXTRACTION_SCHEMA,
      parsedBody.model,  // Pass client-selected model
      customApiKey  // BYOK: Pass user's API key if provided
    );

    const entities = Array.isArray(rawExtraction?.entities)
      ? rawExtraction.entities.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    // ---- Candidate extraction with anchor validation ----
    // If the model returns a `candidates` array, validate each one's exact_quote
    // against the transcript window. Reject any candidate whose quote can't be
    // found in the text — this catches hallucinated quotes.
    let claimText: string | null = null;
    let exactQuote: string | null = null;
    let claimType: ClaimType | null = null;
    let allCandidatesRejected = false;

    const rawCandidates = Array.isArray(rawExtraction?.candidates) ? rawExtraction.candidates : null;
    if (rawCandidates && rawCandidates.length > 0) {
      const validCandidates = rawCandidates.filter((candidate) => {
        const quote = typeof candidate.exact_quote === 'string' ? candidate.exact_quote.trim() : '';
        return quote && findAnchorInWindow(parsedBody.chunks, quote);
      });

      if (validCandidates.length === 0) {
        allCandidatesRejected = true;
      } else {
        const best = validCandidates[0];
        claimText = typeof best.claim_text === 'string' && best.claim_text.trim() ? best.claim_text.trim() : null;
        exactQuote = typeof best.exact_quote === 'string' && best.exact_quote.trim() ? best.exact_quote.trim() : null;
        claimType = best.claim_type;
      }
    }

    const requestedHasClaim = rawExtraction?.has_claim === true || (rawCandidates !== null && !allCandidatesRejected && claimText !== null);
    const hasClaim = !allCandidatesRejected && claimText !== null;
    const malformedClaimPayload = !allCandidatesRejected && requestedHasClaim && claimText === null;
    const rawActionState = VALID_MODEL_ACTION_STATES.has(
      rawExtraction?.action_state as Exclude<ExtractionActionState, 'PARSE_ERROR'>
    )
      ? rawExtraction.action_state as Exclude<ExtractionActionState, 'PARSE_ERROR'>
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
          : (hasClaim ? 'Claim detected.' : 'Awaiting end of statement...');
    const finalClaimType = claimType ?? (claimText ? inferClaimType(claimText) : null);

    const claims: ExtractedClaim[] = hasClaim && claimText
      ? [{
          id: crypto.randomUUID(),
          claimText,
          claimType: finalClaimType!,
          exactQuote: exactQuote || claimText,
          timestampSeconds: resolveClaimTimestamp(parsedBody.chunks, exactQuote || claimText, approximateTimestamp),
          confidence: inferConfidence(finalClaimType!),
        }]
      : [];

    if (malformedClaimPayload) {
      console.warn('[analyze-chunk] Model returned has_claim=true without usable claim_text.');
    }

    console.info('[analyze-chunk]', {
      videoId: parsedBody.videoId,
      chunkCount: parsedBody.chunks.length,
      entityCount: entities.length,
      actionState,
      claimCount: claims.length,
      inputTokens,
      outputTokens,
    });

    const response = NextResponse.json<AnalyzeChunkResponse>({
      entities,
      has_claim: hasClaim,
      claim_text: claimText,
      action_state: actionState,
      reason,
      claims,
      chunkRange: {
        startIndex: parsedBody.chunks[0].index,
        endIndex: parsedBody.chunks[parsedBody.chunks.length - 1].index,
      },
    });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;

  } catch (error: unknown) {
    // DEBUG: Log full error details to Vercel logs
    console.error('[analyze-chunk] RAW ERROR:', error);
    console.error('[analyze-chunk] Error details:', {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : 'N/A',
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
      stack: error instanceof Error ? error.stack : 'N/A',
    });

    if (body && isGeminiError(error) && error.code === 'PARSE_ERROR') {
      // Surface a distinct PARSE_ERROR state instead of silently masking as
      // BUFFERING. The worker can now count and log model parse failures
      // separately from genuine mid-sentence buffering holds.
      console.warn('[analyze-chunk] PARSE_ERROR — model output failed validation.', {
        code: error.code,
        status: error.status,
      });
      const response = NextResponse.json<AnalyzeChunkResponse>({
        entities: [],
        has_claim: false,
        claim_text: null,
        action_state: 'PARSE_ERROR',
        reason: `Model output could not be parsed: ${error.message.substring(0, 120)}`,
        claims: [],
        chunkRange: {
          startIndex: body.chunks[0].index,
          endIndex: body.chunks[body.chunks.length - 1].index,
        },
      });
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    if (isGeminiError(error) && error.code === 'RATE_LIMITED') {
      const response = NextResponse.json(
        { error: 'Rate limited. Please wait a moment and try again.' },
        { status: 429 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    if (isGeminiError(error) && error.code === 'AUTH_ERROR') {
      const response = NextResponse.json(
        { error: 'Server configuration error. Contact support.' },
        { status: 500 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    const response = NextResponse.json(
      { error: 'Failed to analyze transcript chunk.' },
      { status: 500 }
    );
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
