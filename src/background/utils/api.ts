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
  if (cachedSessionToken !== null) {
    return cachedSessionToken || null;
  }

  // Dedup: if a registration request is already in flight, wait for it.
  if (pendingSessionTokenRequest !== null) {
    return pendingSessionTokenRequest;
  }

  pendingSessionTokenRequest = (async () => {
    // Try session storage first (survives SW termination within a browser session).
    try {
      const stored = await chrome.storage.session.get(['apiSessionToken']);
      if (stored.apiSessionToken && typeof stored.apiSessionToken === 'string') {
        cachedSessionToken = stored.apiSessionToken;
        return cachedSessionToken;
      }
    } catch {
      // Session storage unavailable — fall through to registration.
    }

    // Request a token from the backend.
    try {
      const res = await fetch(`${API_BASE}/api/session/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        },
        body: JSON.stringify({ extensionId: chrome.runtime.id }),
      });

      if (res.ok) {
        const data = await res.json();
        const token: string = typeof data.token === 'string' ? data.token : '';
        cachedSessionToken = token;
        if (token) {
          await chrome.storage.session.set({ apiSessionToken: token }).catch(() => {});
        }
        return token || null;
      }
    } catch {
      // Backend unreachable or init failed — proceed without a token.
    }

    cachedSessionToken = '';
    return null;
  })().finally(() => {
    pendingSessionTokenRequest = null;
  });

  return pendingSessionTokenRequest;
}

/**
 * Fetches from the backend with optional BYOK (Bring Your Own Key) support.
 * 
 * If the user has saved a custom API key in Chrome storage, it will be sent
 * in the X-Custom-Api-Key header. The backend will use their key and skip
 * rate limiting. If no key is present, the backend uses the default key
 * and applies rate limiting.
 * 
 * Automatically includes session token for authentication.
 */
export async function fetchWithBYOK(
  endpoint: string,
  payload: FetchPayload,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<unknown> {
  // Get session token first (required for production)
  const sessionToken = await getSessionToken();
  
  // Pull the saved key and model from storage
  const { customApiKey, selectedModel } = await chrome.storage.sync.get([
    'customApiKey',
    'selectedModel',
  ]) as BYOKConfig;

  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Extension-Id': chrome.runtime.id,
  });

  // Add session token if available
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  // If the user has a key, inject it into a custom header
  const hasCustomKey = customApiKey && customApiKey.trim() !== '';
  if (hasCustomKey) {
    headers.set('X-Custom-Api-Key', customApiKey.trim());
  }

  // Use their selected model if they have a key, otherwise force free tier model
  const modelToUse = hasCustomKey && selectedModel
    ? selectedModel
    : 'gemini-2.5-flash-lite';
  
  payload.model = modelToUse;

  // Set up the abort controller for timeouts
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
