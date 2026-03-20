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
  'gemini-2.5-flash',  // Reliable standard
  'gemini-3.1-flash-lite-preview',  // Fastest, lightest
  'gemini-3-flash-preview',       // Balanced quality
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
