import { NextRequest, NextResponse } from 'next/server';
import { askGeminiJSON, isGeminiError } from '@/lib/gemini';
import { buildVideoQuestionPrompt } from '@/lib/prompts';
import { getCorsHeaders, isAllowedOrigin } from '@/lib/cors';
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
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: getCorsHeaders(request),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body: AskVideoQuestionRequest = await request.json();

    const validationError = validateAskVideoRequest(body);
    if (validationError) {
      const response = NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
      Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
      return response;
    }

    // Extract BYOK header - user can provide their own API key
    const customApiKey = request.headers.get('x-custom-api-key')?.trim();

    const prompt = buildVideoQuestionPrompt({
      question: body.question,
      videoTitle: body.videoTitle || 'Unknown Video',
      channelName: body.channelName || 'Unknown Channel',
      currentTime: body.currentTime ?? null,
      transcriptContext: body.transcriptContext || [],
      sourceCards: body.sourceCards || [],
    });

    const { data: rawAnswer } = await askGeminiJSON<RawAskVideoResponse>(
      prompt,
      900,
      ASK_VIDEO_SCHEMA,
      body.model,  // Pass client-selected model
      customApiKey  // BYOK: Pass user's API key if provided
    );

    const answer = typeof rawAnswer?.answer === 'string' && rawAnswer.answer.trim()
      ? rawAnswer.answer.trim().slice(0, MAX_ANSWER_LENGTH)
      : FALLBACK_ANSWER;
    const sources = sanitizeSources(rawAnswer?.sources, body.sourceCards || []);

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
      { error: 'Failed to answer the question.' },
      { status: 500 }
    );
    Object.entries(getCorsHeaders(request)).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }
}
