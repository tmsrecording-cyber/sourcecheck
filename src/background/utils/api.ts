import { API_BASE, REQUEST_TIMEOUT_MS } from '../../config';
import type { GeminiModelOption } from '../../../shared/types';

interface FetchPayload {
  [key: string]: unknown;
  model?: GeminiModelOption;
}

interface BYOKConfig {
  customApiKey: string | null;
  selectedModel: GeminiModelOption;
}

// Session token cache (shared across calls)
let cachedSessionToken: string | null = null;
let pendingSessionTokenRequest: Promise<string | null> | null = null;

/**
 * Get a session token from the backend. The backend validates the extension ID
 * via ALLOWED_EXTENSION_IDS and signs the token with SESSION_SECRET.
 */
async function getSessionToken(): Promise<string | null> {
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

    // Request a token from the backend.
    try {
      console.log('[SourceCheck/API] Fetching session token from:', `${API_BASE}/api/session/init`);
      const res = await fetch(`${API_BASE}/api/session/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        },
        body: JSON.stringify({ extensionId: chrome.runtime.id }),
      });

      console.log('[SourceCheck/API] Session init response status:', res.status);
      
      if (res.ok) {
        const data = await res.json();
        const token: string = typeof data.token === 'string' ? data.token : '';
        console.log('[SourceCheck/API] Got session token:', token ? 'yes (length: ' + token.length + ')' : 'no');
        cachedSessionToken = token;
        if (token) {
          await chrome.storage.session.set({ apiSessionToken: token }).catch(() => {});
        }
        return token || null;
      } else {
        const errorText = await res.text().catch(() => '');
        console.error('[SourceCheck/API] Session init failed:', res.status, errorText);
      }
    } catch (e) {
      console.error('[SourceCheck/API] Session init error:', e);
    }

    cachedSessionToken = '';
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
 * Check if an error/status code indicates a transient failure that should be retried.
 * Only retries truly transient errors - NOT auth failures, quota exhaustion, etc.
 */
const isTransientError = (status: number | null, errorResponse: ErrorResponse | null, error: unknown): boolean => {
  // If backend explicitly says not retryable, respect that
  if (errorResponse?.retryable === false) return false;
  
  // If backend explicitly says retryable, trust it
  if (errorResponse?.retryable === true) return true;
  
  // Check error codes that should never be retried
  const nonRetryableCodes = ['AUTH_ERROR', 'QUOTA_EXHAUSTED'];
  if (errorResponse?.errorCode && nonRetryableCodes.includes(errorResponse.errorCode)) {
    return false;
  }
  
  // Status code based heuristics
  if (status === 401) return false; // Auth errors - retrying won't help
  if (status === 429 || status === 503 || status === 502 || status === 504) return true;
  if (status !== null) return false;
  
  // Network errors (status is null) are generally retryable
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('abort') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ETIMEDOUT')
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
  const { customApiKey, selectedModel } = await chrome.storage.sync.get([
    'customApiKey',
    'selectedModel',
  ]) as BYOKConfig;

  const hasCustomKey = customApiKey && customApiKey.trim() !== '';
  const modelToUse = hasCustomKey && selectedModel
    ? selectedModel
    : 'gemini-2.5-flash-lite';
  
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
        headers.set('X-Custom-Api-Key', customApiKey.trim());
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
          
          // Check if we should retry this error
          if (attempt < MAX_RETRIES && isTransientError(response.status, errorResponse, null)) {
            console.warn(`[SourceCheck/API] Transient error ${response.status}, will retry:`, errorText.slice(0, 100));
            lastError = new Error(`API Error ${response.status}: ${errorResponse?.error || errorText}`);
            lastError.name = errorResponse?.errorCode || 'API_ERROR';
            continue; // Go to next retry iteration
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
      const statusMatch = error instanceof Error && error.message.match(/API Error (\d+)/);
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
  throw lastError ?? new Error('Request failed after retries');
}
