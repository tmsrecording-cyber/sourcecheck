import { API_BASE, REQUEST_TIMEOUT_MS } from '../../config';
import type { GeminiModelOption } from '../../../shared/types';
import { FREEMIUM_MODEL, normalizeModel } from '../../../shared/types';
import { PROVIDER_SETTINGS_KEY, getStoredProviderApiKey } from '../providers/types';
import { logSessionInitFailure, logProviderError, logRetryExhausted } from '../telemetry';

// Retry delays for session token acquisition: 300ms, 800ms, 1500ms (exponential backoff)
const SESSION_TOKEN_RETRY_DELAYS_MS = [300, 800, 1500];
const MAX_SESSION_TOKEN_ATTEMPTS = 3;

interface FetchPayload {
  [key: string]: unknown;
  model?: GeminiModelOption;
}

// Session token cache (shared across calls)
let cachedSessionToken: string | null = null;
let pendingSessionTokenRequest: Promise<string | null> | null = null;

/**
 * Clear the cached session token. Called on 401 to force re-authentication.
 */
async function clearSessionToken(): Promise<void> {
  cachedSessionToken = null;
  try {
    await chrome.storage.session.remove(['apiSessionToken']);
    console.log('[SourceCheck/API] Session token cleared');
  } catch (e) {
    console.log('[SourceCheck/API] Failed to clear session token:', e);
  }
}

/**
 * Get a session token from the backend. The backend validates the extension ID
 * via ALLOWED_EXTENSION_IDS and signs the token with SESSION_SECRET.
 * 
 * EXPORTED: Used by both fetchWithBYOK and service-worker.ts for unified session handling.
 */
export async function getSessionToken(): Promise<string | null> {
  console.log('[SourceCheck/API] Getting session token...');
  
  if (cachedSessionToken !== null) {
    console.log('[SourceCheck/API] Using cached session token');
    return cachedSessionToken || null;
  }

  // Dedup: if a registration request is already in flight, wait for it.
  if (pendingSessionTokenRequest !== null) {
    console.log('[SourceCheck/API] Waiting for in-flight session request');
    return pendingSessionTokenRequest;
  }

  pendingSessionTokenRequest = (async () => {
    // Try session storage first (survives SW termination within a browser session).
    try {
      const stored = await chrome.storage.session.get(['apiSessionToken']);
      if (stored.apiSessionToken && typeof stored.apiSessionToken === 'string') {
        console.log('[SourceCheck/API] Found session token in storage');
        cachedSessionToken = stored.apiSessionToken;
        return cachedSessionToken;
      }
    } catch (e) {
      console.log('[SourceCheck/API] Session storage unavailable:', e);
    }

    // Request a token from the backend with bounded retry for transient failures.
    for (let attempt = 0; attempt < MAX_SESSION_TOKEN_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delay = SESSION_TOKEN_RETRY_DELAYS_MS[attempt - 1] ?? 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        console.log(`[SourceCheck/API] Fetching session token (attempt ${attempt + 1}/${MAX_SESSION_TOKEN_ATTEMPTS}):`, `${API_BASE}/api/session/init`);
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        };
        const clientSecret = import.meta.env.VITE_CLIENT_SECRET;
        if (clientSecret) {
          headers['x-sourcecheck-client-secret'] = clientSecret;
        }
        const res = await fetch(`${API_BASE}/api/session/init`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ extensionId: chrome.runtime.id }),
        });

        console.log('[SourceCheck/API] Session init response status:', res.status);
        
        if (res.ok) {
          const data = await res.json();
          const token: string = typeof data.token === 'string' ? data.token : '';
          console.log('[SourceCheck/API] Got session token:', token ? 'yes (length: ' + token.length + ')' : 'no');
          if (token) {
            cachedSessionToken = token;
            await chrome.storage.session.set({ apiSessionToken: token }).catch(() => {});
          }
          return token || null;
        } else {
          const errorText = await res.text().catch(() => '');
          console.error('[SourceCheck/API] Session init failed:', res.status, errorText);
          logSessionInitFailure({
            statusCode: res.status,
            context: res.status === 403 ? 'extension_id_not_allowed' : 'session_init_non_ok',
            retryable: false,
          });
          // Non-OK response (e.g., 403, 429) - don't retry, fail fast
          break;
        }
      } catch (e) {
        console.error(`[SourceCheck/API] Session init error (attempt ${attempt + 1}):`, e);
        const isLastAttempt = attempt === MAX_SESSION_TOKEN_ATTEMPTS - 1;
        if (isLastAttempt) {
          logSessionInitFailure({
            context: e instanceof Error ? e.name : 'network_error',
            retryable: true,
          });
        }
        // Retry on transient network errors unless this was the last attempt
      }
    }

    return null;
  })().finally(() => {
    pendingSessionTokenRequest = null;
  });

  return pendingSessionTokenRequest;
}

// Maximum retries for transient errors
const MAX_RETRIES = 3;
// Base delay for exponential backoff (ms)
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Error response from backend with classification.
 */
interface ErrorResponse {
  error: string;
  errorCode?: string;
  retryable?: boolean;
}

/**
 * Canonical error categories for unified error surfacing across the extension.
 * These are the ONLY error codes that should be shown to users or drive UI behavior.
 */
export type CanonicalErrorCode =
  | 'AUTH_ERROR'           // 401, invalid session/api key - fail closed, open settings
  | 'RATE_LIMITED'         // 429 backend rate limit - retryable
  | 'QUOTA_EXHAUSTED'      // 429 provider quota - show settings
  | 'INVALID_API_KEY'      // Provider auth error - show settings
  | 'PROVIDER_OVERLOADED'  // 503 - retryable
  | 'NETWORK_ERROR'        // Network/fetch failures - retryable
  | 'UPSTREAM_ERROR'       // 502/504 - retryable
  | 'PAYLOAD_TOO_LARGE'    // 413 - request body too large
  | 'UNKNOWN_ERROR';       // Fallback

/**
 * Error classification result with canonical code and UI behavior flags.
 */
export interface ClassifiedError {
  code: CanonicalErrorCode;
  message: string;
  retryable: boolean;
  showSettings: boolean;  // If true, UI should open settings panel
  clearSession: boolean;  // If true, session token should be cleared
}

/**
 * Non-retryable error codes that should fail fast without retries.
 * EXPORTED: Single source of truth for error code classification.
 */
export const NON_RETRYABLE_ERROR_CODES = ['AUTH_ERROR', 'QUOTA_EXHAUSTED', 'INVALID_API_KEY', 'PAYLOAD_TOO_LARGE'] as const;

/**
 * Error codes that should trigger settings panel opening.
 */
export const SETTINGS_TRIGGER_CODES: CanonicalErrorCode[] = ['AUTH_ERROR', 'QUOTA_EXHAUSTED', 'INVALID_API_KEY'];

/**
 * Check if an error code indicates a non-retryable failure.
 * EXPORTED: Shared helper for consistent error classification.
 */
export const isNonRetryableErrorCode = (errorCode: string | null | undefined): boolean => {
  return !!errorCode && NON_RETRYABLE_ERROR_CODES.includes(errorCode as typeof NON_RETRYABLE_ERROR_CODES[number]);
};

/**
 * Check if error should trigger settings panel.
 * EXPORTED: Unified behavior for auth/quota/key errors.
 */
export const shouldShowSettings = (code: CanonicalErrorCode): boolean => {
  return SETTINGS_TRIGGER_CODES.includes(code);
};

/**
 * Classify any error into a canonical error code with consistent UI behavior.
 * This is the SINGLE POINT where all errors are normalized for the extension.
 * 
 * EXPORTED: All error paths must use this to ensure consistent UX.
 */
export function classifyError(
  error: unknown,
  context?: { status?: number; errorCode?: string; url?: string }
): ClassifiedError {
  const status = context?.status;
  const backendCode = context?.errorCode;
  
  // Extract message safely
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  
  // 1. Check backend-provided error code first (most authoritative)
  if (backendCode) {
    switch (backendCode) {
      case 'AUTH_ERROR':
        return {
          code: 'AUTH_ERROR',
          message: 'Authentication failed. Please check your API key.',
          retryable: false,
          showSettings: true,
          clearSession: true,
        };
      case 'QUOTA_EXHAUSTED':
        return {
          code: 'QUOTA_EXHAUSTED',
          message: 'API quota exhausted. Try again later or use your own API key.',
          retryable: false,
          showSettings: true,
          clearSession: false,
        };
      case 'RATE_LIMITED':
        return {
          code: 'RATE_LIMITED',
          message: 'Rate limited. Too many requests.',
          retryable: true,
          showSettings: false,
          clearSession: false,
        };
      case 'OVERLOADED':
        return {
          code: 'PROVIDER_OVERLOADED',
          message: 'Provider temporarily overloaded. Retrying...',
          retryable: true,
          showSettings: false,
          clearSession: false,
        };
    }
  }
  
  // 2. Check HTTP status codes
  if (status === 401) {
    return {
      code: 'AUTH_ERROR',
      message: 'Session expired. Please refresh.',
      retryable: false,
      showSettings: true,
      clearSession: true,
    };
  }
  
  if (status === 429) {
    return {
      code: 'RATE_LIMITED',
      message: 'Rate limited. Too many requests.',
      retryable: true,
      showSettings: false,
      clearSession: false,
    };
  }
  
  if (status === 503) {
    return {
      code: 'PROVIDER_OVERLOADED',
      message: 'Service temporarily overloaded. Retrying...',
      retryable: true,
      showSettings: false,
      clearSession: false,
    };
  }
  
  if (status === 502 || status === 504) {
    return {
      code: 'UPSTREAM_ERROR',
      message: 'Upstream service error. Retrying...',
      retryable: true,
      showSettings: false,
      clearSession: false,
    };
  }

  if (status === 413) {
    return {
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Ask context too large. Try again after the video progresses.',
      retryable: false,
      showSettings: false,
      clearSession: false,
    };
  }
  
  // HTTP 500 - Internal Server Error (transient, should retry)
  if (status === 500) {
    return {
      code: 'UPSTREAM_ERROR',
      message: 'Service temporarily unavailable. Retrying...',
      retryable: true,
      showSettings: false,
      clearSession: false,
    };
  }
  
  // 3. Check for network/transport errors (status is null/undefined)
  if (status === null || status === undefined) {
    const msg = message.toLowerCase();
    if (
      msg.includes('network') ||
      msg.includes('fetch') ||
      msg.includes('abort') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('failed to fetch')
    ) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Network error. Check your connection.',
        retryable: true,
        showSettings: false,
        clearSession: false,
      };
    }
  }
  
  // 4. Check message heuristics for provider errors
  const msgLower = message.toLowerCase();
  if (msgLower.includes('api key') || msgLower.includes('invalid key') || msgLower.includes('unauthorized')) {
    return {
      code: 'INVALID_API_KEY',
      message: 'Invalid API key. Please check your settings.',
      retryable: false,
      showSettings: true,
      clearSession: false,
    };
  }
  
  if (msgLower.includes('quota') || msgLower.includes('exhausted') || msgLower.includes('limit exceeded')) {
    return {
      code: 'QUOTA_EXHAUSTED',
      message: 'API quota exhausted. Try again later or use your own API key.',
      retryable: false,
      showSettings: true,
      clearSession: false,
    };
  }
  
  // 5. Default fallback
  return {
    code: 'UNKNOWN_ERROR',
    message: message || 'An unexpected error occurred.',
    retryable: false,
    showSettings: false,
    clearSession: false,
  };
}

/**
 * Broadcast a provider error to the sidepanel for UI handling.
 * This is the canonical way to surface errors to the user.
 * 
 * EXPORTED: Use this instead of ad-hoc error handling.
 */
export async function broadcastProviderError(
  classifiedError: ClassifiedError
): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'PROVIDER_ERROR',
      payload: {
        code: classifiedError.code,
        message: classifiedError.message,
        retryable: classifiedError.retryable,
        showSettings: classifiedError.showSettings,
      },
    });
  } catch {
    // Sidepanel may not be open - this is fine
  }
}

/**
 * Check if an error/status code indicates a transient failure that should be retried.
 * Only retries truly transient errors - NOT auth failures, quota exhaustion, etc.
 * 
 * EXPORTED: Shared error classification logic to prevent drift between service-worker and API utils.
 */
export const isTransientError = (status: number | null, errorResponse: ErrorResponse | null, error: unknown): boolean => {
  // If backend explicitly says not retryable, respect that
  if (errorResponse?.retryable === false) return false;
  
  // If backend explicitly says retryable, trust it
  if (errorResponse?.retryable === true) return true;
  
  // Check error codes that should never be retried
  if (isNonRetryableErrorCode(errorResponse?.errorCode)) {
    return false;
  }
  
  // Status code based heuristics
  if (status === 401) return false; // Auth errors - retrying won't help
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (status !== null) return false;
  
  // Network errors (status is null) are generally retryable
  const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('abort') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('failed to fetch')
  );
};

/**
 * Calculate delay for exponential backoff with jitter.
 * Delays: 1s, 2s, 4s (with up to 20% jitter)
 */
const getRetryDelayMs = (attempt: number): number => {
  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const jitter = 0.8 + Math.random() * 0.4; // 0.8 to 1.2 multiplier
  return Math.floor(exponentialDelay * jitter);
};

/**
 * Fetches from the backend with optional BYOK (Bring Your Own Key) support.
 * 
 * If the user has saved a custom API key in Chrome storage, it will be sent
 * in the X-Custom-Api-Key header. The backend will use their key and skip
 * rate limiting. If no key is present, the backend uses the default key
 * and applies rate limiting.
 * 
 * Automatically includes session token for authentication.
 * 
 * Retries on transient errors (429, 503, network failures) with exponential backoff.
 */
export async function fetchWithBYOK(
  endpoint: string,
  payload: FetchPayload,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<unknown> {
  console.log('[SourceCheck/API] fetchWithBYOK called:', endpoint);
  
  // Pull the saved key and model from storage (once, outside retry loop)
  // ARCHITECTURE: apiKey from local providerSettings, selectedModel from sync (single source of truth)
  const [providerResult, syncResult] = await Promise.all([
    chrome.storage.local.get([PROVIDER_SETTINGS_KEY]),
    chrome.storage.sync.get(['selectedModel']),
  ]);
  const customApiKey = getStoredProviderApiKey(providerResult[PROVIDER_SETTINGS_KEY]);
  // CANONICAL: selectedModel always comes from sync storage (single source of truth)
  const selectedModel = normalizeModel(syncResult.selectedModel);

  const hasCustomKey = customApiKey !== null;
  
  // MODEL POLICY: 
  // - Freemium (no custom key): Always use FREEMIUM_MODEL
  // - BYOK mode: Use normalized selectedModel from sync (single source of truth)
  const modelToUse = hasCustomKey ? selectedModel : FREEMIUM_MODEL;
  
  // Build payload with model
  const requestPayload = { ...payload, model: modelToUse };

  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Get fresh session token for each attempt (may have expired)
      const sessionToken = await getSessionToken();
      
      if (attempt > 0) {
        const delayMs = getRetryDelayMs(attempt - 1);
        console.log(`[SourceCheck/API] Retry attempt ${attempt}/${MAX_RETRIES} after ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-Extension-Id': chrome.runtime.id,
      });

      if (sessionToken) {
        headers.set('Authorization', `Bearer ${sessionToken}`);
      }

      if (hasCustomKey) {
        headers.set('X-Custom-Api-Key', customApiKey);
        // CANONICAL: Always send the selected model from sync storage (single source of truth)
        headers.set('X-Custom-Model', selectedModel);
      }

      const clientSecret = import.meta.env.VITE_CLIENT_SECRET;
      if (clientSecret) {
        headers.set('x-sourcecheck-client-secret', clientSecret);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const url = `${API_BASE}${endpoint}`;
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          
          // Try to parse structured error from backend
          let errorResponse: ErrorResponse | null = null;
          try {
            errorResponse = JSON.parse(errorText) as ErrorResponse;
          } catch {
            // Not JSON, use plain text
          }
          
          // Clear cached token on 401 (auth failure) to force re-authentication
          if (response.status === 401) {
            console.warn('[SourceCheck/API] 401 received, clearing cached session token');
            await clearSessionToken();
          }
          
          // Check if we should retry this error
          if (attempt < MAX_RETRIES && isTransientError(response.status, errorResponse, null)) {
            console.warn(`[SourceCheck/API] Transient error ${response.status}, will retry:`, errorText.slice(0, 100));
            lastError = new Error(`API Error ${response.status}: ${errorResponse?.error || errorText}`);
            lastError.name = errorResponse?.errorCode || 'API_ERROR';
            continue; // Go to next retry iteration
          }
          
          // Log provider errors for observability
          if (errorResponse?.errorCode) {
            const category = errorResponse.errorCode === 'QUOTA_EXHAUSTED' ? 'provider_quota_exhausted'
              : errorResponse.errorCode === 'AUTH_ERROR' || errorResponse.errorCode === 'INVALID_API_KEY' ? 'provider_auth_error'
              : errorResponse.errorCode === 'RATE_LIMITED' ? 'rate_limited'
              : 'verify_failed';
            
            logProviderError({
              category,
              route: endpoint,
              errorCode: errorResponse.errorCode,
              retryable: errorResponse.retryable ?? false,
              context: `status=${response.status}`,
            });
          }
          
          // Not retryable or out of retries
          const error = new Error(errorResponse?.error || `API Error ${response.status}: ${errorText}`);
          error.name = errorResponse?.errorCode || 'API_ERROR';
          (error as Error & { status: number }).status = response.status;
          throw error;
        }

        const data = await response.json();
        
        if (attempt > 0) {
          console.log('[SourceCheck/API] Success after retry');
        }
        
        return data;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      // Extract status from error if available
      const statusMatch = error instanceof Error ? error.message.match(/API Error (\d+)/) : null;
      const statusFromError = statusMatch?.[1];
      const statusNum = statusFromError ? parseInt(statusFromError, 10) : (error as Error & { status?: number }).status || null;
      
      // Check if this is a retryable error
      if (attempt < MAX_RETRIES && isTransientError(statusNum, null, error)) {
        console.warn(`[SourceCheck/API] Transient error on attempt ${attempt}, will retry:`, 
          error instanceof Error ? error.message : String(error));
        lastError = error instanceof Error ? error : new Error(String(error));
        continue; // Go to next retry iteration
      }
      
      // Not retryable or out of retries - rethrow with enhanced info
      if (error instanceof Error) {
        // Preserve error code in message for upstream handling
        if (error.name && error.name !== 'Error') {
          (error as Error & { errorCode?: string }).errorCode = error.name;
        }
      }
      throw error;
    }
  }
  
  // Exhausted all retries
  console.error(`[SourceCheck/API] Exhausted all ${MAX_RETRIES} retries`);
  
  // Log retry exhaustion with appropriate category
  const category = endpoint.includes('verify-claim') ? 'verify_failed' 
    : endpoint.includes('ask-video') ? 'ask_failed'
    : 'session_init_failed';
  
  logRetryExhausted({
    category,
    route: endpoint,
    attempts: MAX_RETRIES,
    context: lastError?.name || 'unknown_error',
  });
  
  throw lastError ?? new Error('Request failed after retries');
}
