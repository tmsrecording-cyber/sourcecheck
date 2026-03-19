// Force Node.js runtime - Redis rate limiting requires Node.js APIs
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSON, isGeminiError } from '@/lib/gemini';
import { buildVideoQuestionPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
import { verifyBearerSessionToken } from '@/proxy';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { logRouteFailure, logProviderError, classifyGeminiErrorCode, isRetryableCategory } from '@/lib/observability';
import { validateClientSecretAuth } from '@/lib/client-secret-auth';
import type {
  AskQuestionResponse,
  AskQuestionSource,
  AskVideoQuestionRequest,
} from '@/types/shared';

interface RawAskVideoResponse {
  answer?: unknown;
  sources?: unknown;
}

const FALLBACK_ANSWER = "The speakers haven't discussed this recently, or I don't have enough context to answer.";
const MAX_QUESTION_LENGTH = 500;
const MAX_ANSWER_LENGTH = 1800;
const MAX_METADATA_FIELD_LENGTH = 300;
const MAX_TRANSCRIPT_CONTEXT_CHUNKS = 24;
const MAX_SOURCE_CARDS = 20;
const MAX_TRANSCRIPT_CHUNK_TEXT_LENGTH = 1200;
const MAX_TRANSCRIPT_TOTAL_LENGTH = 18_000;
const ASK_VIDEO_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
  },
  required: ['answer', 'sources'],
  additionalProperties: false,
} as const;

const normalizeSourceKey = (value: string) => value.trim().toLowerCase();

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase();

const sanitizeHttpUrl = (value?: string | null) => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

const validateAskVideoRequest = (body: AskVideoQuestionRequest) => {
  if (!body.question?.trim()) {
    return 'question is required.';
  }

  if (body.question.length > MAX_QUESTION_LENGTH) {
    return `question exceeds ${MAX_QUESTION_LENGTH} characters.`;
  }

  if ((body.videoTitle || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'videoTitle is too long.';
  }

  if ((body.channelName || '').length > MAX_METADATA_FIELD_LENGTH) {
    return 'channelName is too long.';
  }

  if (body.currentTime !== null && body.currentTime !== undefined) {
    if (!Number.isFinite(body.currentTime) || body.currentTime < 0) {
      return 'currentTime must be a non-negative number when provided.';
    }
  }

  const transcriptContext = Array.isArray(body.transcriptContext) ? body.transcriptContext : [];
  const sourceCards = Array.isArray(body.sourceCards) ? body.sourceCards : [];

  if (transcriptContext.length === 0 && sourceCards.length === 0) {
    return 'No transcript or source-card context was provided.';
  }

  if (transcriptContext.length > MAX_TRANSCRIPT_CONTEXT_CHUNKS) {
    return `transcriptContext exceeds ${MAX_TRANSCRIPT_CONTEXT_CHUNKS} chunks.`;
  }

  let transcriptTotalLength = 0;
  for (const chunk of transcriptContext) {
    if (typeof chunk.text !== 'string' || !chunk.text.trim()) {
      return 'Each transcript chunk must include non-empty text.';
    }

    if (chunk.text.length > MAX_TRANSCRIPT_CHUNK_TEXT_LENGTH) {
      return `A transcript chunk exceeds ${MAX_TRANSCRIPT_CHUNK_TEXT_LENGTH} characters.`;
    }

    if (!Number.isFinite(chunk.startTime) || chunk.startTime < 0) {
      return 'Each transcript chunk requires a non-negative startTime.';
    }

    if (!Number.isFinite(chunk.duration) || chunk.duration < 0) {
      return 'Each transcript chunk requires a non-negative duration.';
    }

    transcriptTotalLength += chunk.text.length;
  }

  if (transcriptTotalLength > MAX_TRANSCRIPT_TOTAL_LENGTH) {
    return `Transcript context is too large (max ${MAX_TRANSCRIPT_TOTAL_LENGTH} chars).`;
  }

  if (sourceCards.length > MAX_SOURCE_CARDS) {
    return `sourceCards exceeds ${MAX_SOURCE_CARDS} items.`;
  }

  return null;
};

const sanitizeSources = (
  rawSources: unknown,
  sourceCards: AskVideoQuestionRequest['sourceCards']
): AskQuestionSource[] => {
  if (!Array.isArray(rawSources) || sourceCards.length === 0) {
    return [];
  }

  const availableSources = sourceCards.map((card) => ({
    title: card.sourceTitle || card.claim.claimText,
    url: sanitizeHttpUrl(card.sourceUrl),
  }));
  const byTitle = new Map(
    availableSources.map((source) => [normalizeSourceKey(source.title), source])
  );
  const byUrl = new Map(
    availableSources
      .filter((source) => source.url)
      .map((source) => [normalizeUrl(source.url as string), source])
  );
  const deduped = new Set<string>();
  const sanitized: AskQuestionSource[] = [];

  rawSources.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    const rawTitle = typeof (candidate as { title?: unknown }).title === 'string'
      ? (candidate as { title: string }).title.trim()
      : '';
    const rawUrl = typeof (candidate as { url?: unknown }).url === 'string'
      ? (candidate as { url: string }).url.trim()
      : '';

    const matched = (rawUrl && byUrl.get(normalizeUrl(rawUrl))) || (rawTitle && byTitle.get(normalizeSourceKey(rawTitle)));
    if (!matched) {
      return;
    }

    const dedupeKey = matched.url || normalizeSourceKey(matched.title);
    if (deduped.has(dedupeKey)) {
      return;
    }

    deduped.add(dedupeKey);
    sanitized.push(matched);
  });

  return sanitized;
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

  let body: AskVideoQuestionRequest | null = null;
  // Declare outside try for error handling access
  const extensionId = request.headers.get('x-extension-id')?.trim() || '';
  const customApiKey = request.headers.get('x-custom-api-key')?.trim();
  // BYOK: Check for model in header (x-custom-model) as override
  const headerModel = request.headers.get('x-custom-model')?.trim();
  
  try {
    const parsedBody: AskVideoQuestionRequest = await request.json();
    body = parsedBody;

    const validationError = validateAskVideoRequest(parsedBody);
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
        route: '/api/ask-video',
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
        route: '/api/ask-video',
        category: 'rate_limited',
        statusCode: 429,
        retryable: true,
        context: `retryAfter=${rateLimitResult.retryAfter}`,
      });
      const response = createRateLimitResponse(request, rateLimitResult.retryAfter);
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    const prompt = buildVideoQuestionPrompt({
      question: parsedBody.question,
      videoTitle: parsedBody.videoTitle || 'Unknown Video',
      channelName: parsedBody.channelName || 'Unknown Channel',
      currentTime: parsedBody.currentTime ?? null,
      transcriptContext: parsedBody.transcriptContext || [],
      sourceCards: parsedBody.sourceCards || [],
    });

    // BYOK: Use header model if provided (from x-custom-model), else fall back to body
    const effectiveModel = customApiKey && headerModel ? headerModel : parsedBody.model;
    
    const { data: rawAnswer } = await askGeminiJSON<RawAskVideoResponse>(
      prompt,
      900,
      ASK_VIDEO_SCHEMA,
      effectiveModel,  // Pass effective model (header override for BYOK)
      customApiKey,  // BYOK: Pass user's API key if provided
      '/api/ask-video'
    );

    const answer = typeof rawAnswer?.answer === 'string' && rawAnswer.answer.trim()
      ? rawAnswer.answer.trim().slice(0, MAX_ANSWER_LENGTH)
      : FALLBACK_ANSWER;
    const sources = sanitizeSources(rawAnswer?.sources, parsedBody.sourceCards || []);

    const response = NextResponse.json<AskQuestionResponse>({
      answer,
      sources,
    });
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  } catch (error: unknown) {
    console.error('[ask-video] Error:', {
      name: error instanceof Error ? error.name : typeof error,
      code: isGeminiError(error) ? error.code : undefined,
      status: isGeminiError(error) ? error.status : undefined,
    });

    // Log provider errors via observability layer
    if (isGeminiError(error)) {
      const category = classifyGeminiErrorCode(error.code);
      logProviderError({
        category,
        route: '/api/ask-video',
        model: body?.model,
        providerType: customApiKey ? 'byok' : 'gemini',
        retryable: isRetryableCategory(category),
        context: `code=${error.code}`,
      });
    } else {
      logRouteFailure({
        route: '/api/ask-video',
        category: 'internal_error',
        statusCode: 500,
        model: body?.model,
        providerType: customApiKey ? 'byok' : 'gemini',
        retryable: false,
        context: error instanceof Error ? error.name : 'unknown error',
      });
    }

    if (isGeminiError(error) && error.code === 'RATE_LIMITED') {
      const response = NextResponse.json(
        { error: 'Rate limited. Please wait a moment and try again.' },
        { status: 429 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    if (isGeminiError(error) && error.code === 'QUOTA_EXHAUSTED') {
      const response = NextResponse.json(
        { error: 'API quota exhausted. Please try again later or add your own API key in settings.', errorCode: 'QUOTA_EXHAUSTED' },
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
      { error: 'Failed to answer the question.' },
      { status: 500 }
    );
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
