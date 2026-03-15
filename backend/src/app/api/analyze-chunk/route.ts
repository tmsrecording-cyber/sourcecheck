import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSON, isGeminiError } from '@/lib/gemini';
import { buildClaimExtractionPrompt } from '@/lib/prompts';
import type {
  AnalyzeChunkRequest,
  AnalyzeChunkResponse,
  ClaimType,
  ExtractionActionState,
  ExtractedClaim,
  TranscriptChunk,
} from '@/types/shared';

type RawExtraction = {
  entities?: unknown;
  has_claim?: unknown;
  claim_text?: unknown;
  exact_quote?: unknown;
  action_state?: unknown;
  reason?: unknown;
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
    claim_text: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    exact_quote: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
    action_state: {
      type: 'string',
      enum: ['VERIFYING', 'REJECTED', 'BUFFERING'],
    },
    reason: { type: 'string' },
  },
  required: ['entities', 'has_claim', 'claim_text', 'exact_quote', 'action_state', 'reason'],
  additionalProperties: false,
} as const;

const normalizeText = (text: string) =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();

const resolveClaimTimestamp = (chunks: TranscriptChunk[], exactQuote: string, fallback: number) => {
  const normalizedQuote = normalizeText(exactQuote);
  if (!normalizedQuote) {
    return fallback;
  }

  const matchedChunk = chunks.find((chunk) => {
    const normalizedChunk = normalizeText(chunk.text);
    return normalizedChunk.includes(normalizedQuote) || normalizedQuote.includes(normalizedChunk);
  });

  return matchedChunk?.startTime ?? fallback;
};

const inferConfidence = (claimType: ClaimType): number => {
  switch (claimType) {
    case 'study':      return 0.88;
    case 'statistic':  return 0.85;
    case 'historical': return 0.80;
    case 'surprising': return 0.72;
  }
};

const inferClaimType = (claimText: string): ClaimType => {
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

export async function POST(request: NextRequest) {
  let body: AnalyzeChunkRequest | null = null;

  try {
    const parsedBody = await request.json() as AnalyzeChunkRequest;
    body = parsedBody;

    const validationError = validateAnalyzeChunkRequest(parsedBody);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

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
      CLAIM_EXTRACTION_SCHEMA
    );

    const entities = Array.isArray(rawExtraction?.entities)
      ? rawExtraction.entities.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const claimText = typeof rawExtraction?.claim_text === 'string' && rawExtraction.claim_text.trim().length > 0
      ? rawExtraction.claim_text.trim()
      : null;
    const exactQuote = typeof rawExtraction?.exact_quote === 'string' && rawExtraction.exact_quote.trim().length > 0
      ? rawExtraction.exact_quote.trim()
      : null;
    const requestedHasClaim = rawExtraction?.has_claim === true;
    const hasClaim = requestedHasClaim && claimText !== null;
    const malformedClaimPayload = requestedHasClaim && claimText === null;
    const rawActionState = VALID_MODEL_ACTION_STATES.has(
      rawExtraction?.action_state as Exclude<ExtractionActionState, 'PARSE_ERROR'>
    )
      ? rawExtraction.action_state as Exclude<ExtractionActionState, 'PARSE_ERROR'>
      : null;
    const actionState = hasClaim
      ? 'VERIFYING'
      : rawActionState && rawActionState !== 'VERIFYING'
        ? rawActionState
        : 'BUFFERING';
    const reason = malformedClaimPayload
      ? 'Model marked a claim but returned no usable claim text.'
      : typeof rawExtraction?.reason === 'string' && rawExtraction.reason.trim().length > 0
      ? rawExtraction.reason.trim()
      : (hasClaim ? 'Claim detected.' : 'Awaiting end of statement...');
    const inferredClaimType = claimText ? inferClaimType(claimText) : null;

    const claims: ExtractedClaim[] = hasClaim && claimText
      ? [{
          id: crypto.randomUUID(),
          claimText,
          claimType: inferredClaimType!,
          exactQuote: exactQuote || claimText,
          timestampSeconds: resolveClaimTimestamp(parsedBody.chunks, exactQuote || claimText, approximateTimestamp),
          confidence: inferConfidence(inferredClaimType!),
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

    return NextResponse.json<AnalyzeChunkResponse>({
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

  } catch (error: unknown) {
    console.error('[analyze-chunk] Error:', {
      name: error instanceof Error ? error.name : typeof error,
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
    });

    if (body && isGeminiError(error) && error.code === 'PARSE_ERROR') {
      // Surface a distinct PARSE_ERROR state instead of silently masking as
      // BUFFERING. The worker can now count and log model parse failures
      // separately from genuine mid-sentence buffering holds.
      console.warn('[analyze-chunk] PARSE_ERROR — model output failed validation.', {
        code: error.code,
        status: error.status,
      });
      return NextResponse.json<AnalyzeChunkResponse>({
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
    }

    if (isGeminiError(error) && error.code === 'RATE_LIMITED') {
      return NextResponse.json(
        { error: 'Rate limited. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    if (isGeminiError(error) && error.code === 'AUTH_ERROR') {
      return NextResponse.json(
        { error: 'Server configuration error. Contact support.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to analyze transcript chunk.' },
      { status: 500 }
    );
  }
}
