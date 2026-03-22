import {
  ALLOWED_MODELS,
  FREEMIUM_MODEL,
  BYOK_DEFAULT_MODEL,
  normalizeModel,
  type GeminiModelOption,
} from '../../../shared/types';
import type {
  AnalyzeChunkRequest,
  AnalyzeChunkResponse,
  VerifyClaimRequest,
  VerifyClaimResponse,
  AskVideoQuestionRequest,
  AskQuestionResponse,
} from '../../../shared/types';

// Re-export from shared types for backwards compatibility
export { ALLOWED_MODELS, FREEMIUM_MODEL, BYOK_DEFAULT_MODEL, normalizeModel };
export type { GeminiModelOption };

/** 
 * BYOK model list - the three models available for Bring Your Own Key mode.
 * These are displayed in the SettingsPanel model selector.
 * All values MUST be in ALLOWED_MODELS from shared/types.ts.
 */
export const GEMINI_MODELS: readonly GeminiModelOption[] = [
  'gemini-2.5-flash',              // Reliable standard
  'gemini-3.1-flash-lite-preview', // Fastest, lightest
] as const;

/** 
 * Default model for BYOK mode.
 * This is the initial selection when user opens settings.
 */
export const DEFAULT_GEMINI_MODEL: GeminiModelOption = BYOK_DEFAULT_MODEL;

export interface ProviderSettings {
  provider: 'gemini';
  apiKey: string;
  model?: string;
}

export const PROVIDER_SETTINGS_KEY = 'providerSettings';

// Session-first storage: primary runtime location (cleared on browser close)
export const PROVIDER_SETTINGS_SESSION_KEY = 'providerSettingsSession';
// Persistent fallback for "Remember key" preference
export const PROVIDER_SETTINGS_LOCAL_KEY = 'providerSettingsLocal';
// Flag to track user's "Remember key" preference
export const PROVIDER_REMEMBER_KEY = 'providerRememberKey';
const GEMINI_API_KEY_PREFIX = 'AIza';
const MIN_GEMINI_API_KEY_LENGTH = 20;

export const getStoredProviderApiKey = (settings: unknown): string | null => {
  if (!settings || typeof settings !== 'object') {
    return null;
  }

  const rawApiKey = (settings as { apiKey?: unknown }).apiKey;
  if (typeof rawApiKey !== 'string') {
    return null;
  }

  const trimmedApiKey = rawApiKey.trim();
  if (
    trimmedApiKey.length < MIN_GEMINI_API_KEY_LENGTH ||
    !trimmedApiKey.startsWith(GEMINI_API_KEY_PREFIX)
  ) {
    return null;
  }

  return trimmedApiKey;
};

export const hasStoredProviderApiKey = (settings: unknown): boolean =>
  getStoredProviderApiKey(settings) !== null;

/**
 * Read provider API key from session-first storage.
 * Priority: session > local (legacy) > null
 * This supports the secure-by-default model where keys live in session
 * storage (cleared on browser close) with optional local persistence.
 */
export const readProviderApiKey = async (): Promise<string | null> => {
  try {
    // Check session storage first (current browser session)
    const sessionResult = await chrome.storage.session.get([PROVIDER_SETTINGS_SESSION_KEY]);
    const sessionKey = getStoredProviderApiKey(sessionResult[PROVIDER_SETTINGS_SESSION_KEY]);
    if (sessionKey) return sessionKey;

    // Fallback: check local storage (for "Remember key" or legacy migration)
    const localResult = await chrome.storage.local.get([PROVIDER_SETTINGS_LOCAL_KEY, PROVIDER_SETTINGS_KEY]);
    
    // Check new local key first
    const localKey = getStoredProviderApiKey(localResult[PROVIDER_SETTINGS_LOCAL_KEY]);
    if (localKey) {
      // Copy to session for current use
      await chrome.storage.session.set({
        [PROVIDER_SETTINGS_SESSION_KEY]: { provider: 'gemini', apiKey: localKey },
      });
      return localKey;
    }

    // Legacy: check old key for migration
    const legacyKey = getStoredProviderApiKey(localResult[PROVIDER_SETTINGS_KEY]);
    if (legacyKey) {
      // Migrate to new schema: copy to both session and local with remember=true
      await chrome.storage.session.set({
        [PROVIDER_SETTINGS_SESSION_KEY]: { provider: 'gemini', apiKey: legacyKey },
      });
      await chrome.storage.local.set({
        [PROVIDER_SETTINGS_LOCAL_KEY]: { provider: 'gemini', apiKey: legacyKey },
        [PROVIDER_REMEMBER_KEY]: true,
      });
      // Clean up legacy key
      await chrome.storage.local.remove(PROVIDER_SETTINGS_KEY);
      return legacyKey;
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Check if user has enabled "Remember key" preference.
 */
export const getRememberKeyPreference = async (): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get([PROVIDER_REMEMBER_KEY]);
    return result[PROVIDER_REMEMBER_KEY] === true;
  } catch {
    return false;
  }
};

export interface ProviderAdapter {
  analyzeChunk(req: AnalyzeChunkRequest): Promise<AnalyzeChunkResponse>;
  verifyClaim(req: VerifyClaimRequest): Promise<VerifyClaimResponse>;
  askQuestion(req: AskVideoQuestionRequest): Promise<AskQuestionResponse>;
}

export type ProviderErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'NOT_SUPPORTED';

export class ProviderError extends Error {
  code: ProviderErrorCode;
  status: number;

  constructor(code: ProviderErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export const isProviderError = (e: unknown): e is ProviderError =>
  e instanceof ProviderError;
