const DEFAULT_MODEL = 'gemini-3-flash-preview';
const DEFAULT_25_THINKING_BUDGET = 128;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const getModel = () => process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

const getRequestTimeoutMs = () => {
  const configured = process.env.GEMINI_REQUEST_TIMEOUT_MS?.trim();
  if (!configured) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(configured, 10);
  if (Number.isFinite(parsed) && parsed >= 1000) {
    return parsed;
  }

  return DEFAULT_REQUEST_TIMEOUT_MS;
};

type GeminiJsonSchema = Record<string, unknown>;

type GeminiCallOptions = {
  responseMimeType?: string;
  responseJsonSchema?: GeminiJsonSchema;
};

// Minimal JSON Schema validator covering the subset used in this codebase:
// object, string (with optional enum), boolean, number, integer, null, array,
// anyOf, required, additionalProperties:false.
// Returns null on success or an error string on the first violation.
export function validateAgainstSchema(data: unknown, schema: GeminiJsonSchema): string | null {
  if (schema.anyOf) {
    const variants = schema.anyOf as GeminiJsonSchema[];
    const passes = variants.some((v) => validateAgainstSchema(data, v) === null);
    return passes ? null : `Value does not match any expected type in anyOf`;
  }

  if (schema.type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return `Expected object, got ${data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data}`;
    }
    const obj = data as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, GeminiJsonSchema>;

    const required = schema.required as string[] | undefined;
    if (required) {
      for (const field of required) {
        if (!(field in obj)) return `Missing required field: "${field}"`;
      }
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(props));
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) return `Unexpected property: "${key}"`;
      }
    }

    for (const [key, propSchema] of Object.entries(props)) {
      if (!(key in obj)) continue;
      const err = validateAgainstSchema(obj[key], propSchema);
      if (err) return `"${key}": ${err}`;
    }
    return null;
  }

  if (schema.type === 'string') {
    if (typeof data !== 'string') return `Expected string, got ${typeof data}`;
    if (schema.enum) {
      const allowed = schema.enum as string[];
      if (!allowed.includes(data)) {
        return `Expected one of [${allowed.join(', ')}], got "${data}"`;
      }
    }
    return null;
  }

  if (schema.type === 'boolean') {
    return typeof data === 'boolean' ? null : `Expected boolean, got ${typeof data}`;
  }

  if (schema.type === 'number') {
    return typeof data === 'number' && Number.isFinite(data)
      ? null
      : `Expected number, got ${typeof data}`;
  }

  if (schema.type === 'integer') {
    return typeof data === 'number' && Number.isInteger(data)
      ? null
      : `Expected integer, got ${typeof data}`;
  }

  if (schema.type === 'null') {
    return data === null ? null : `Expected null, got ${Array.isArray(data) ? 'array' : typeof data}`;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(data)) return `Expected array, got ${typeof data}`;
    const items = schema.items as GeminiJsonSchema | undefined;
    if (items) {
      for (let i = 0; i < (data as unknown[]).length; i++) {
        const err = validateAgainstSchema((data as unknown[])[i], items);
        if (err) return `[${i}]: ${err}`;
      }
    }
    return null;
  }

  return null; // Unknown/unsupported schema construct — pass through.
}

const stripCodeFences = (value: string) =>
  value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

const extractBalancedJsonValue = (value: string) => {
  const startIndex = value.search(/[{[]/);
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{' || character === '[') {
      depth += 1;
      continue;
    }

    if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
};

const parseJsonResponse = <T>(rawText: string) => {
  const cleaned = stripCodeFences(rawText);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const extracted = extractBalancedJsonValue(cleaned);
    if (!extracted) {
      throw new Error('No JSON object or array found in Gemini response.');
    }

    return JSON.parse(extracted) as T;
  }
};

type GeminiRequestBody = {
  contents: Array<{ parts: Array<{ text: string }> }>;
  generationConfig: {
    maxOutputTokens: number;
    temperature: number;
    thinkingConfig?: { thinkingBudget: number };
    responseMimeType?: string;
    responseJsonSchema?: GeminiJsonSchema;
  };
  tools?: Array<Record<string, unknown>>;
};

type GeminiFinishReason =
  | 'STOP'
  | 'MAX_TOKENS'
  | 'SAFETY'
  | 'RECITATION'
  | 'OTHER'
  | string;

const THINKING_MODEL_PATTERNS = [
  /^gemini-2\.5-(?:pro|flash)(?:[-.\w]*)?$/i,
  /^gemini-3(?:\.\d+)?-(?:pro|flash)(?:[-.\w]*)?$/i,
] as const;

const isThinkingModel = (model: string) =>
  THINKING_MODEL_PATTERNS.some((pattern) => pattern.test(model));

const trimModelText = (value: string) => value.trim();

const truncateForLog = (value: string, maxChars: number = 220) =>
  value.replace(/\s+/g, ' ').trim().slice(0, maxChars);

const dedupeGroundingSources = (sources: GroundingSource[]): GroundingSource[] => {
  const seenUrls = new Set<string>();

  return sources.filter((source) => {
    const normalizedUrl = source.url.trim();
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      return false;
    }

    seenUrls.add(normalizedUrl);
    source.url = normalizedUrl;
    source.title = source.title.trim() || 'Unknown source';
    return true;
  });
};

const buildEmptyResponseError = (finishReason: GeminiFinishReason | undefined, model: string) => {
  switch (finishReason) {
    case 'SAFETY':
      return new GeminiError('API_ERROR', `Gemini blocked the response due to safety filters (${model}).`, 422);
    case 'MAX_TOKENS':
      return new GeminiError('API_ERROR', `Gemini stopped at MAX_TOKENS before returning a complete response (${model}).`, 502);
    case 'RECITATION':
      return new GeminiError('API_ERROR', `Gemini stopped due to RECITATION safeguards (${model}).`, 422);
    case 'OTHER':
      return new GeminiError('API_ERROR', `Gemini returned no text for an unspecified finish reason (${model}).`, 502);
    default:
      return new GeminiError(
        'API_ERROR',
        finishReason
          ? `Gemini returned no text (finishReason=${finishReason}, model=${model}).`
          : `Gemini returned no text and no finish reason (${model}).`,
        502
      );
  }
};

const logJsonFailure = ({
  model,
  useGrounding,
  rawText,
  validationError,
}: {
  model: string;
  useGrounding: boolean;
  rawText: string;
  validationError?: string;
}) => {
  console.error('[gemini.ts] JSON response failure:', {
    model,
    useGrounding,
    validationError: validationError ?? null,
    rawTextLength: rawText.length,
  });
};

const getThinkingBudget = (model: string) => {
  if (!isThinkingModel(model)) {
    return null;
  }

  const configured = process.env.GEMINI_THINKING_BUDGET?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return DEFAULT_25_THINKING_BUDGET;
};

interface GeminiResponse {
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  groundingMetadata?: GroundingMetadata;
}

interface GroundingSource {
  title: string;
  url: string;
}

interface GroundingMetadata {
  sources: GroundingSource[];
  searchQueries?: string[];
}

interface GeminiAPIResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
    finishReason?: string;
    groundingMetadata?: {
      groundingChunks?: Array<{
        web?: { uri?: string; title?: string };
      }>;
      searchEntryPoint?: {
        renderedContent?: string;
      };
      webSearchQueries?: string[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

export type GeminiErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'API_ERROR'
  | 'PARSE_ERROR';

export class GeminiError extends Error {
  code: GeminiErrorCode;
  status: number;

  constructor(code: GeminiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.status = status;
  }
}

export const isGeminiError = (error: unknown): error is GeminiError =>
  error instanceof GeminiError;

const parseGeminiJsonResponse = <T>(
  response: GeminiResponse,
  schema: GeminiJsonSchema | undefined,
  useGrounding: boolean
) => {
  const rawText = trimModelText(response.text);

  if (!rawText) {
    throw new GeminiError(
      'PARSE_ERROR',
      `Gemini returned an empty ${useGrounding ? 'grounded ' : ''}JSON response (${response.model}).`,
      502
    );
  }

  let data: T;

  try {
    data = parseJsonResponse<T>(rawText);
  } catch {
    logJsonFailure({
      model: response.model,
      useGrounding,
      rawText,
    });
    throw new GeminiError(
      'PARSE_ERROR',
      `Failed to parse Gemini response as JSON (${response.model}). Raw: ${truncateForLog(rawText, 200)}`,
      502
    );
  }

  if (schema) {
    const validationError = validateAgainstSchema(data, schema);
    if (validationError) {
      logJsonFailure({
        model: response.model,
        useGrounding,
        rawText,
        validationError,
      });
      throw new GeminiError(
        'PARSE_ERROR',
        `Schema validation failed for Gemini JSON response (${response.model}): ${validationError}`,
        502
      );
    }
  }

  return data;
};

/**
 * Send a prompt to Gemini and get back the text response.
 * No web search — just plain LLM completion.
 * Use this for claim extraction (doesn't need search).
 */
export async function askGemini(
  prompt: string,
  maxTokens: number = 1000,
  options: GeminiCallOptions = {}
): Promise<GeminiResponse> {
  return callGemini(prompt, maxTokens, false, options);
}

/**
 * Send a prompt to Gemini WITH Google Search grounding enabled.
 * Gemini will automatically search the web to inform its answer.
 * Use this for claim verification.
 */
export async function askGeminiWithSearch(
  prompt: string,
  maxTokens: number = 1000,
  options: GeminiCallOptions = {}
): Promise<GeminiResponse> {
  return callGemini(prompt, maxTokens, true, options);
}

/**
 * Core Gemini API call — shared by both grounded and ungrounded paths.
 */
async function callGemini(
  prompt: string,
  maxTokens: number,
  useGrounding: boolean,
  options: GeminiCallOptions = {}
): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = getModel();
  const thinkingBudget = getThinkingBudget(model);
  const requestTimeoutMs = getRequestTimeoutMs();

  if (!apiKey) {
    throw new GeminiError('AUTH_ERROR', 'GEMINI_API_KEY not set in environment variables.', 500);
  }

  try {
    // Build request body
    const body: GeminiRequestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2,
        // Thinking mode suppresses Google Search grounding — the model answers from
        // training data instead of searching. Only apply thinkingConfig on non-grounded calls.
        ...(!useGrounding && thinkingBudget !== null ? { thinkingConfig: { thinkingBudget } } : {}),
        ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
        ...(options.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {}),
      },
    };

    // Add Google Search grounding tool if requested
    if (useGrounding) {
      body.tools = [
        { google_search: {} }
      ];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(
        `${API_BASE}/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();

        if (response.status === 429) {
          throw new GeminiError('RATE_LIMITED', 'Gemini API rate limit hit. Try again in a moment.', 429);
        }
        if (response.status === 401 || response.status === 403) {
          throw new GeminiError(
            'AUTH_ERROR',
            'Gemini request was rejected. Check API key, project access, and model availability.',
            response.status
          );
        }
        if (response.status === 503) {
          throw new GeminiError('OVERLOADED', 'Gemini API is temporarily overloaded. Retry shortly.', 503);
        }

        throw new GeminiError(
          'API_ERROR',
          `Gemini API (${model}) error ${response.status}: ${errorBody.substring(0, 200)}`,
          502
        );
      }

      const data: GeminiAPIResponse = await response.json();

      if (data.error) {
        throw new Error(`Gemini API error: ${data.error.message}`);
      }

      // Extract text — filter out thinking/reasoning parts (thought=true) so they
      // don't corrupt JSON responses from thinking-capable models like Gemini 3.x.
      const text = trimModelText(data.candidates?.[0]?.content?.parts
        ?.filter((part) => !part.thought)
        ?.map((part) => part.text || '')
        .join('') || '');

      if (!text) {
        const finishReason = data.candidates?.[0]?.finishReason as GeminiFinishReason | undefined;
        console.warn('[gemini.ts] Empty response from Gemini.', {
          model,
          useGrounding,
          finishReason: finishReason ?? null,
        });
        throw buildEmptyResponseError(finishReason, model);
      }

      // Extract grounding metadata if present
      let groundingMetadata: GroundingMetadata | undefined;
      const rawGrounding = data.candidates?.[0]?.groundingMetadata;

      if (rawGrounding) {
        const sources = dedupeGroundingSources((rawGrounding.groundingChunks || [])
          .filter((chunk) => chunk.web?.uri)
          .map((chunk) => ({
            title: chunk.web?.title || 'Unknown source',
            url: chunk.web?.uri as string,
          })));

        groundingMetadata = {
          sources,
          searchQueries: rawGrounding.webSearchQueries,
        };
      }

      return {
        model,
        text,
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        groundingMetadata,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error: unknown) {
    if (isGeminiError(error)) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new GeminiError('API_ERROR', `Gemini API request timed out for ${model}.`, 504);
    }

    console.error('[gemini.ts] API error:', {
      name: error instanceof Error ? error.name : typeof error,
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new GeminiError('API_ERROR', `Gemini API error: ${message}`, 502);
  }
}

/**
 * Send a prompt and parse the response as JSON.
 * No grounding — for structured extraction only.
 */
export async function askGeminiJSON<T = unknown>(
  prompt: string,
  maxTokens: number = 1000,
  schema?: GeminiJsonSchema
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  const response = await askGemini(prompt, maxTokens, {
    responseMimeType: 'application/json',
    ...(schema ? { responseJsonSchema: schema } : {}),
  });
  const data = parseGeminiJsonResponse<T>(response, schema, false);

  return {
    data,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

/**
 * Send a prompt WITH Google Search grounding and parse as JSON.
 * Also returns the grounding sources for source card URLs.
 */
export async function askGeminiJSONWithSearch<T = unknown>(
  prompt: string,
  maxTokens: number = 1000,
  schema?: GeminiJsonSchema
): Promise<{
  data: T;
  inputTokens: number;
  outputTokens: number;
  sources: GroundingSource[];
}> {
  // NOTE: responseMimeType:'application/json' + google_search is NOT supported on all
  // Gemini model versions (e.g. gemini-3.1-flash-lite-preview rejects the combination).
  // We rely on prompt-based JSON instructions + parseJsonResponse() instead.
  // The schema is enforced via post-hoc validation (validateAgainstSchema) below.
  const response = await askGeminiWithSearch(prompt, maxTokens);
  const data = parseGeminiJsonResponse<T>(response, schema, true);

  return {
    data,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    sources: response.groundingMetadata?.sources || [],
  };
}
