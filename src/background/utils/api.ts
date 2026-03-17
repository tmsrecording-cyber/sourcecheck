import { API_BASE, REQUEST_TIMEOUT_MS } from '../config';
import type { GeminiModelOption } from '../../../shared/types';

interface FetchPayload {
  [key: string]: unknown;
  model?: GeminiModelOption;
}

interface BYOKConfig {
  customApiKey: string | null;
  selectedModel: GeminiModelOption;
}

/**
 * Fetches from the backend with optional BYOK (Bring Your Own Key) support.
 * 
 * If the user has saved a custom API key in Chrome storage, it will be sent
 * in the X-Custom-Api-Key header. The backend will use their key and skip
 * rate limiting. If no key is present, the backend uses the default key
 * and applies rate limiting.
 */
export async function fetchWithBYOK(
  endpoint: string,
  payload: FetchPayload,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<unknown> {
  // Pull the saved key and model from storage
  const { customApiKey, selectedModel } = await chrome.storage.sync.get([
    'customApiKey',
    'selectedModel',
  ]) as BYOKConfig;

  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-Extension-Id': chrome.runtime.id,
  });

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
