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
  console.log('[SourceCheck/API] fetchWithBYOK called:', endpoint);
  
  // Get session token first (required for production)
  const sessionToken = await getSessionToken();
  console.log('[SourceCheck/API] Session token:', sessionToken ? 'present' : 'MISSING');
  
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
    console.log('[SourceCheck/API] Added Authorization header');
  } else {
    console.warn('[SourceCheck/API] NO SESSION TOKEN - request may fail with 403');
  }

  // If the user has a key, inject it into a custom header
  const hasCustomKey = customApiKey && customApiKey.trim() !== '';
  if (hasCustomKey) {
    headers.set('X-Custom-Api-Key', customApiKey.trim());
    console.log('[SourceCheck/API] Using custom API key (BYOK)');
  }

  // Use their selected model if they have a key, otherwise force free tier model
  const modelToUse = hasCustomKey && selectedModel
    ? selectedModel
    : 'gemini-2.5-flash-lite';
  
  payload.model = modelToUse;
  console.log('[SourceCheck/API] Using model:', modelToUse);

  // Set up the abort controller for timeouts
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${API_BASE}${endpoint}`;
    console.log('[SourceCheck/API] Fetching:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    console.log('[SourceCheck/API] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('[SourceCheck/API] API Error:', response.status, errorText);
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('[SourceCheck/API] Success - response parsed');
    return data;
  } catch (e) {
    console.error('[SourceCheck/API] Fetch error:', e);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
