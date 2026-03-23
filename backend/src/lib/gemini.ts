import { ALLOWED_MODELS, FREEMIUM_MODEL, BYOK_DEFAULT_MODEL, normalizeModel, type GeminiModelOption } from '../types-shared';
import { recordParseError, type ParseErrorRoute, type ParseErrorType } from './parse-evidence';

const DEFAULT_THINKING_BUDGET = 128;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

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
  model?: string;  // Allow dynamic model selection from client
  tier?: 'free' | 'pro';  // User tier for model access control
  customApiKey?: string;  // BYOK: User's own API key
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

const extractBalancedJsonValueFromIndex = (value: string, startIndex: number) => {
  const startChar = value[startIndex];
  if (startChar !== '{' && startChar !== '[') {
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

const cleanJsonSyntax = (value: string) => {
  // Strip trailing commas only outside of string literals.
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (!inString && ch === ',') {
      // Look ahead past whitespace to see if the next non-whitespace char closes a container.
      let j = i + 1;
      while (j < value.length && (value[j] === ' ' || value[j] === '\n' || value[j] === '\r' || value[j] === '\t')) {
        j++;
      }
      if (j < value.length && (value[j] === '}' || value[j] === ']')) {
        // Skip the trailing comma.
        continue;
      }
    }
    result += ch;
  }
  return result;
};

/**
 * Extracts and parses a JSON object from a raw string, which may include
 * conversational text or markdown code fences.
 *
 * This function is exported for testing purposes.
 * @internal
 */
export const parseJsonResponse = <T>(rawText: string): T => {
  // Extract JSON from fenced code blocks. Prioritize explicit ```json fences first.
  // Only fall back to generic ``` fences if the trimmed content starts with { or [.
  // This prevents matching arbitrary fenced prose/code as JSON candidates.
  const explicitJsonFence = rawText.match(/```json\s*([\s\S]+?)\s*```/i);
  const genericFenceMatch = rawText.match(/```\s*([\s\S]+?)\s*```/);
  
  let candidate: string;
  let fenceType: 'explicit_json' | 'generic' | 'none' = 'none';
  
  if (explicitJsonFence) {
    candidate = (explicitJsonFence[1] || '').trim();
    fenceType = 'explicit_json';
  } else if (genericFenceMatch) {
    const content = (genericFenceMatch[1] || '').trim();
    // Only use generic fence if content looks like JSON (starts with { or [)
    if (content.startsWith('{') || content.startsWith('[')) {
      candidate = content;
      fenceType = 'generic';
    } else {
      candidate = rawText.trim();
    }
  } else {
    candidate = rawText.trim();
  }
  
  const parseErrorMessage = 'No JSON object or array found in Gemini response.';

  // Track recovery path for observability
  let usedRecovery = false;
  let recoveryMethod: 'none' | 'fenced_explicit' | 'fenced_generic' | 'balanced' = 'none';

  if (fenceType === 'explicit_json') {
    recoveryMethod = 'fenced_explicit';
  } else if (fenceType === 'generic') {
    recoveryMethod = 'fenced_generic';
  }

  try {
    // First attempt: parse the candidate text directly (after cleaning syntax).
    // This works if the candidate is a clean JSON object.
    const result = JSON.parse(cleanJsonSyntax(candidate)) as T;
    // Log successful parse with recovery info for observability
    if (recoveryMethod !== 'none') {
      console.log('[gemini.ts] JSON parse succeeded with recovery:', {
        recoveryMethod,
        rawTextLength: rawText.length,
        candidateLength: candidate.length,
      });
    }
    return result;
  } catch {
    // Second attempt: If the first parse fails, the candidate might still contain
    // a valid JSON object surrounded by other text (e.g., if no code fences were used).
    
    const candidates: T[] = [];
    for (let index = 0; index < candidate.length; index += 1) {
      const character = candidate[index];
      if (character !== '{' && character !== '[') {
        continue;
      }

      const extracted = extractBalancedJsonValueFromIndex(candidate, index);
      if (!extracted) {
        continue;
      }

      // Always advance past the end of the extracted balanced region.
      // This prevents the scanner from re-entering the interior and spuriously
      // matching sub-objects that belong to an already-seen array.
      const skipTo = index + extracted.length - 1; // for loop will +1 after

      try {
        const result = JSON.parse(cleanJsonSyntax(extracted)) as T;
        // Objects are immediately returned — they're the target schema shape.
        if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
          console.log('[gemini.ts] JSON parse succeeded with balanced object extraction:', {
            recoveryMethod: 'balanced_object',
            rawTextLength: rawText.length,
            extractedLength: extracted.length,
          });
          return result;
        }
        // Arrays are saved as candidates rather than returned immediately.
        // LLM preamble can contain arrays (e.g., entity lists) before the real
        // JSON object — eagerly returning here would miss the correct payload.
        if (Array.isArray(result) && result.length > 0) {
          candidates.push(result);
        }
      } catch {
        // Keep scanning: benign brace-like prose can precede the real JSON payload.
      }

      index = skipTo;
    }

    // If we reached here, we didn't find a perfect object. If we found any valid
    // JSON arrays (like a solo entity list), use the first one as a fallback.
    if (candidates.length > 0) {
      console.log('[gemini.ts] JSON parse falling back to first balanced array/primitive:', {
        recoveryMethod: 'balanced_fallback',
        candidateCount: candidates.length,
      });
      return candidates[0];
    }

    // Log honest failure before throwing
    console.warn('[gemini.ts] JSON parse failed - no recoverable JSON found:', {
      rawTextLength: rawText.length,
      rawTextPreview: rawText.slice(0, 300).replace(/\s+/g, ' ').trim(),
      triedFenced: !!explicitJsonFence,
      triedBalanced: true,
    });

    throw new Error(parseErrorMessage);
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

// Returns new normalized objects instead of mutating the originals.
const dedupeGroundingSources = (sources: GroundingSource[]): GroundingSource[] => {
  const seenUrls = new Set<string>();
  const uniqueSources: GroundingSource[] = [];

  for (const source of sources) {
    const normalizedUrl = source.url.trim();
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    uniqueSources.push({ url: normalizedUrl, title: source.title.trim() || 'Unknown source' });
  }
  return uniqueSources;
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
    rawTextPreview: rawText.slice(0, 500).replace(/\s+/g, ' ').trim(),
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

  return DEFAULT_THINKING_BUDGET;
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
  | 'QUOTA_EXHAUSTED'
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
  useGrounding: boolean,
  route?: ParseErrorRoute,
  recoveryAttempted?: boolean,
  recoverySucceeded?: boolean
) => {
  const rawText = trimModelText(response.text);

  if (!rawText) {
    if (route) {
      recordParseError({
        route,
        model: response.model,
        errorType: 'empty_response',
        rawLength: 0,
        recoveryAttempted: recoveryAttempted ?? false,
        recoverySucceeded: recoverySucceeded ?? false,
        schemaUsed: !!schema,
      });
    }
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
    if (route) {
      recordParseError({
        route,
        model: response.model,
        errorType: 'json_syntax',
        rawLength: rawText.length,
        recoveryAttempted: recoveryAttempted ?? false,
        recoverySucceeded: recoverySucceeded ?? false,
        schemaUsed: !!schema,
      });
    }
    throw new GeminiError(
      'PARSE_ERROR',
      `Failed to parse Gemini response as JSON (${response.model}). Raw: ${truncateForLog(rawText, 200)}`,
      502
    );
  }

  // FIX: Some models (e.g. gemini-3.1-flash-lite-preview) may return:
  // 1. An array wrapping a single object: [{ ... }] - unwrap it
  // 2. Just the entities array due to truncation - treat as parse error to trigger retry
  if (schema?.type === 'object' && Array.isArray(data)) {
    // Case 1: Single-element array containing an object - unwrap it
    if (
      data.length === 1 &&
      typeof data[0] === 'object' &&
      data[0] !== null &&
      !Array.isArray(data[0])
    ) {
      console.log('[gemini.ts] Unwrapping single-element array to object:', {
        model: response.model,
      });
      data = data[0] as T;
    } else {
      // Case 2: Array of primitives (e.g., entities array from truncated response)
      // This indicates the model hit token limits or produced malformed output.
      // Throw PARSE_ERROR to trigger extension retry logic.
      console.log('[gemini.ts] Truncated response detected (got array, expected object):', {
        model: response.model,
        arrayLength: data.length,
        firstElementType: typeof data[0],
      });
      if (route) {
        recordParseError({
          route,
          model: response.model,
          errorType: 'array_unwrap_failed',
          rawLength: rawText.length,
          recoveryAttempted: recoveryAttempted ?? false,
          recoverySucceeded: recoverySucceeded ?? false,
          schemaUsed: !!schema,
        });
      }
      throw new GeminiError(
        'PARSE_ERROR',
        `Model returned array instead of object (truncated response) (${response.model})`,
        502
      );
    }
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
      if (route) {
        recordParseError({
          route,
          model: response.model,
          errorType: 'schema_mismatch',
          rawLength: rawText.length,
          recoveryAttempted: recoveryAttempted ?? false,
          recoverySucceeded: recoverySucceeded ?? false,
          schemaUsed: !!schema,
        });
      }
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

// Default tiers - in production, this would come from auth/subscription system
function getTierForRequest(_identity?: string): 'free' | 'pro' {
  // TODO: Integrate with actual subscription/auth system
  // For now, all requests are treated as free tier
  return 'free';
}

/**
 * Validate and get the effective model for a request.
 * 
 * POLICY ENFORCEMENT:
 * - Freemium/trial/managed tier: ONLY gemini-2.5-flash is allowed (FREEMIUM_MODEL)
 * - BYOK mode: User can select any model from ALLOWED_MODELS
 * - Invalid/stale models are normalized to the BYOK default
 * 
 * NOTE: Header model resolution (x-custom-model) is handled at the route layer
 * before calling this function. Pass the already-resolved model here.
 */
function getEffectiveModel(
  requestedModel: string | undefined,
  _tier: 'free' | 'pro',
  customApiKey: string | undefined
): GeminiModelOption {
  // Normalize the requested model (handles null/undefined and stale values)
  const normalizedRequested = normalizeModel(requestedModel);

  // Managed tier (no custom API key):
  // All ALLOWED_MODELS use the same backend API key — no cost difference.
  // The route layer decides which model fits each stage:
  //   - Extraction (analyze-chunk): user's selected model passes through (flash-lite for Dual)
  //   - Verification (verify-claim): route overrides to flash-2.5 for FACTS Grounding accuracy
  if (!customApiKey) {
    if (!requestedModel) {
      return FREEMIUM_MODEL;
    }
    return normalizedRequested;
  }

  // BYOK mode: Allow any valid model from ALLOWED_MODELS
  if (!requestedModel) {
    return BYOK_DEFAULT_MODEL;
  }

  return normalizedRequested;
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
  // Use custom API key if provided (BYOK), otherwise use environment key
  const apiKey = options.customApiKey || process.env.GEMINI_API_KEY;
  
  // Determine tier and validate model per policy
  const tier = options.tier || getTierForRequest();
  const model = getEffectiveModel(options.model, tier, options.customApiKey);
  
  console.log('[gemini.ts] Model selection:', {
    requestedModel: options.model,
    finalModel: model,
    tier,
    isBYOK: !!options.customApiKey,
  });
  
  const thinkingBudget = getThinkingBudget(model);
  const requestTimeoutMs = getRequestTimeoutMs();

  // Suppress warning for grounded calls - this is expected behavior, not an issue
  if (useGrounding && thinkingBudget !== null) {
    // No-op: thinkingConfig is intentionally ignored for grounded calls
  }

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
        temperature: model === 'gemini-3.1-flash-lite-preview' ? 0 : 0.2,
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
        { googleSearch: {} }
      ];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    // DEBUG: Log the actual API call details
    const apiUrl = `${API_BASE}/models/${model}:generateContent`;
    console.log('[gemini.ts] Calling Gemini API:', {
      url: apiUrl,
      model,
      useGrounding,
    });
    
    try {
      const response = await fetch(
        apiUrl,
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
        
        // DEBUG: Log the actual error from Google
        console.error('[gemini.ts] Gemini API error response:', {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorBody.substring(0, 500),
          model,
          apiUrl,
        });

        // Check for quota exhaustion in error message (various API providers use different terms)
        const errorLower = errorBody.toLowerCase();
        const isQuotaExhausted = errorLower.includes('quota') || 
                                   errorLower.includes('exhausted') || 
                                   errorLower.includes('billing') ||
                                   errorLower.includes('limit exceeded') ||
                                   errorLower.includes('usage limit');
        
        if (isQuotaExhausted) {
          throw new GeminiError(
            'QUOTA_EXHAUSTED',
            'API quota exhausted. Please check your Google AI Studio billing or wait until quota resets.',
            429
          );
        }
        
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

      // Map structured API errors to typed GeminiError
      if (data.error) {
        const status = data.error.code || 502;
        const message = data.error.message || 'Unknown Gemini API error';
        const lower = message.toLowerCase();

        if (status === 401 || status === 403) {
          throw new GeminiError('AUTH_ERROR', message, status);
        }
        if (status === 429) {
          throw new GeminiError(
            lower.includes('quota') || lower.includes('billing') || lower.includes('exhausted')
              ? 'QUOTA_EXHAUSTED'
              : 'RATE_LIMITED',
            message,
            429
          );
        }
        if (status === 503) {
          throw new GeminiError('OVERLOADED', message, 503);
        }
        throw new GeminiError('API_ERROR', message, status >= 400 ? status : 502);
      }

      // Extract text — unconditionally filter out thinking/reasoning parts (thought=true).
      // We only want the final, actual response from the model.
      const rawTextParts = data.candidates?.[0]?.content?.parts || [];

      const text = trimModelText(
        rawTextParts
          .filter((part) => !part.thought)
          .map((part) => part.text || '')
          .join('')
      );

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
    console.error('[gemini.ts] Upstream API error:', error instanceof Error ? error.message : String(error));
    
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
  schema?: GeminiJsonSchema,
  model?: string,
  customApiKey?: string,
  route?: ParseErrorRoute
): Promise<{ data: T; inputTokens: number; outputTokens: number }> {
  // Compute effective model first to determine correct behavior
  // Tier is determined by presence of customApiKey (BYOK = pro, managed = free)
  const effectiveModel = getEffectiveModel(model, customApiKey ? 'pro' : 'free', customApiKey);
  
  // FIX: gemini-3.1-flash-lite-preview produces severely truncated JSON (43-53 chars)
  // when both responseMimeType:'application/json' AND responseJsonSchema are provided.
  // Skip the API-level schema constraint for lite models and rely on prompt-based JSON
  const isLiteModel = effectiveModel.includes('lite');
  const response = await askGemini(prompt, maxTokens, {
    ...(!isLiteModel ? { responseMimeType: 'application/json' } : {}),
    ...(!isLiteModel && schema ? { responseJsonSchema: schema } : {}),
    model: effectiveModel,
    ...(customApiKey ? { customApiKey } : {}),
  });
  const data = parseGeminiJsonResponse<T>(response, schema, false, route);

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
  schema?: GeminiJsonSchema,
  model?: string,
  customApiKey?: string,
  route?: ParseErrorRoute
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
  const response = await askGeminiWithSearch(prompt, maxTokens, { model, customApiKey });
  const data = parseGeminiJsonResponse<T>(response, schema, true, route);

  return {
    data,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    sources: response.groundingMetadata?.sources || [],
  };
}

// ============================================================================
// EMBEDDING GENERATION (for cross-video memory / semantic deduplication)
// ============================================================================

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBEDDING_TIMEOUT_MS = 15_000;

/**
 * Generate a text embedding vector for semantic similarity search.
 * Used for cross-video memory and advanced deduplication.
 * 
 * Returns an empty array if embedding generation fails (graceful degradation).
 * This ensures claim verification still works even if embeddings are unavailable.
 */
export async function generateEmbedding(
  text: string,
  customApiKey?: string,
  taskType?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' | 'SEMANTIC_SIMILARITY',
): Promise<number[]> {
  // Validate input
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn('[gemini.ts] Cannot generate embedding for empty/invalid text');
    return [];
  }

  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[gemini.ts] GEMINI_API_KEY not set, skipping embedding generation');
    return [];
  }

  // Truncate very long text to stay within model limits
  const truncatedText = text.slice(0, 8000);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const apiUrl = `${API_BASE}/models/${EMBEDDING_MODEL}:embedContent`;
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        content: {
          parts: [{ text: truncatedText }],
        },
        // Native dimensionality reduction — better than post-hoc averaging.
        // Matryoshka-trained models preserve semantic meaning at lower dimensions.
        outputDimensionality: 768,
        ...(taskType ? { taskType } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.warn('[gemini.ts] Embedding API error:', {
        status: response.status,
        error: errorText,
      });
      return [];
    }

    const data = await response.json() as {
      embedding?: { values?: number[] };
    };

    const embedding = data.embedding?.values;
    
    if (!Array.isArray(embedding) || embedding.length === 0) {
      console.warn('[gemini.ts] Embedding API returned empty/invalid embedding');
      return [];
    }

    console.info('[gemini.ts] Embedding generated:', {
      dimensions: embedding.length,
      textLength: truncatedText.length,
    });

    return embedding;
  } catch (error) {
    // Handle timeout specifically
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[gemini.ts] Embedding generation timed out');
    } else {
      console.warn('[gemini.ts] Embedding generation failed:', error instanceof Error ? error.message : 'Unknown error');
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// Re-export policy constants for backend use
export { ALLOWED_MODELS, FREEMIUM_MODEL, BYOK_DEFAULT_MODEL, normalizeModel };
// Deployment bump: Wed Mar 18 00:52:46 PDT 2026
