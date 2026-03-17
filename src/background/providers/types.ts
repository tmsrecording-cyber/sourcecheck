import type {
  AnalyzeChunkRequest,
  AnalyzeChunkResponse,
  VerifyClaimRequest,
  VerifyClaimResponse,
  AskVideoQuestionRequest,
  AskQuestionResponse,
} from '../../../shared/types';

export const GEMINI_MODELS = [
  'gemini-2.5-flash-lite-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3-flash-preview',
] as const;

export type GeminiModel = typeof GEMINI_MODELS[number];

export const DEFAULT_GEMINI_MODEL: GeminiModel = 'gemini-3.1-flash-lite-preview';

export interface ProviderSettings {
  provider: 'gemini';
  apiKey: string;
  model?: string;
}

export const PROVIDER_SETTINGS_KEY = 'providerSettings';

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
