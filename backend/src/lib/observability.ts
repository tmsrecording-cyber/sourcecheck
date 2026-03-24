/**
 * Minimal, privacy-conscious observability layer for SourceCheck.
 * 
 * This module provides structured error/event capture for critical failure paths.
 * It is intentionally minimal — no broad analytics, no PII, no user behavior tracking.
 * 
 * Design principles:
 * - Categorical events over verbose payloads
 * - No transcript text, no user questions, no API keys, no tokens
 * - Only safe metadata: route names, error codes, HTTP status, model names
 * - Local logging only — no external observability services
 */

import type { MatchResolutionPath, VerificationStatus, KnownClaimMatchSummary } from '@/types/shared';

export type FailureCategory =
  | 'auth_error'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'upstream_timeout'
  | 'upstream_error'
  | 'upstream_parse_error'
  | 'internal_error'
  | 'validation_error'
  | 'transcript_unavailable'
  | 'transcript_fetch_failed'
  | 'transcript_parse_failed';

export type SafeProviderType = 'gemini' | 'byok' | 'fact_check_tools' | 'unknown';

type FailureTelemetryEvent = {
  name: 'route_failure' | 'session_init_failure' | 'provider_error' | 'rate_limit_hit' | 'transcript_failure';
  timestamp: number;
  // Safe metadata only — no PII
  route?: string;
  category: FailureCategory;
  statusCode?: number;
  model?: string;
  retryable: boolean;
  providerType?: SafeProviderType;
  extensionVersion?: string;
  // Context (sanitized)
  context?: string;
};

type VerificationResolutionSource =
  | 'recent_verification_cache'
  | 'internal_memory'
  | 'claimreview'
  | 'live_grounded'
  | 'fallback';

type VerificationResolutionTelemetryEvent = {
  name: 'verification_resolution';
  timestamp: number;
  route: '/api/verify-claim';
  resolutionPath: MatchResolutionPath;
  resolutionSource: VerificationResolutionSource;
  status: VerificationStatus;
  conflictDetected: boolean;
  conflictReason?: string;
  matchOrigin?: KnownClaimMatchSummary['origin'];
  matchType?: KnownClaimMatchSummary['matchType'];
  freshnessClass?: NonNullable<KnownClaimMatchSummary['freshnessClass']>;
  context?: string;
};

export type TelemetryEvent = FailureTelemetryEvent | VerificationResolutionTelemetryEvent;
type BufferedTelemetryEvent =
  | Omit<FailureTelemetryEvent, 'timestamp'>
  | Omit<VerificationResolutionTelemetryEvent, 'timestamp'>;

// Simple in-memory ring buffer for recent events (development/debug only)
const MAX_BUFFERED_EVENTS = 100;
const eventBuffer: TelemetryEvent[] = [];

/**
 * Log a structured telemetry event.
 * Events are logged to console and optionally buffered for debugging.
 */
function pushTelemetryEvent(event: BufferedTelemetryEvent): void {
  const fullEvent = {
    ...event,
    timestamp: Date.now(),
  } as TelemetryEvent;

  // Add to ring buffer
  eventBuffer.push(fullEvent);
  if (eventBuffer.length > MAX_BUFFERED_EVENTS) {
    eventBuffer.shift();
  }

  // Log to console as structured JSON for log aggregation
  const logLine = `[sourcecheck.telemetry] ${JSON.stringify(fullEvent)}`;
  
  // Use appropriate log level based on severity
  if ('category' in event && (event.category === 'internal_error' || event.category === 'upstream_parse_error')) {
    console.error(logLine);
  } else if ('category' in event && (event.category === 'rate_limited' || event.category === 'quota_exhausted')) {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

export function logTelemetryEvent(event: Omit<FailureTelemetryEvent, 'timestamp'>): void {
  pushTelemetryEvent(event);
}

/**
 * Get recent events from the buffer (for debugging/monitoring endpoints).
 */
export function getRecentEvents(limit: number = 50): TelemetryEvent[] {
  return eventBuffer.slice(-limit);
}

/**
 * Clear the event buffer.
 */
export function clearEventBuffer(): void {
  eventBuffer.length = 0;
}

export function logVerificationResolution(params: {
  resolutionPath: MatchResolutionPath;
  resolutionSource: VerificationResolutionSource;
  status: VerificationStatus;
  conflictDetected: boolean;
  conflictReason?: string;
  matchOrigin?: KnownClaimMatchSummary['origin'];
  matchType?: KnownClaimMatchSummary['matchType'];
  freshnessClass?: NonNullable<KnownClaimMatchSummary['freshnessClass']>;
  context?: string;
}): void {
  pushTelemetryEvent({
    name: 'verification_resolution',
    route: '/api/verify-claim',
    resolutionPath: params.resolutionPath,
    resolutionSource: params.resolutionSource,
    status: params.status,
    conflictDetected: params.conflictDetected,
    ...(params.conflictReason ? { conflictReason: params.conflictReason } : {}),
    ...(params.matchOrigin ? { matchOrigin: params.matchOrigin } : {}),
    ...(params.matchType ? { matchType: params.matchType } : {}),
    ...(params.freshnessClass ? { freshnessClass: params.freshnessClass } : {}),
    ...(params.context ? { context: params.context } : {}),
  });
}

/**
 * Create a standardized route failure event.
 */
export function logRouteFailure(params: {
  route: string;
  category: FailureCategory;
  statusCode: number;
  model?: string;
  retryable: boolean;
  providerType?: SafeProviderType;
  extensionVersion?: string;
  context?: string;
}): void {
  logTelemetryEvent({
    name: 'route_failure',
    ...params,
  });
}

/**
 * Create a session initialization failure event.
 */
export function logSessionInitFailure(params: {
  category: FailureCategory;
  statusCode?: number;
  context?: string;
}): void {
  logTelemetryEvent({
    name: 'session_init_failure',
    category: params.category,
    statusCode: params.statusCode,
    retryable: params.category === 'rate_limited' || params.category === 'upstream_timeout',
    context: params.context,
  });
}

/**
 * Create a provider (Gemini/BYOK) error event.
 */
export function logProviderError(params: {
  category: FailureCategory;
  route: string;
  model?: string;
  providerType: SafeProviderType;
  retryable: boolean;
  context?: string;
}): void {
  logTelemetryEvent({
    name: 'provider_error',
    route: params.route,
    category: params.category,
    model: params.model,
    providerType: params.providerType,
    retryable: params.retryable,
    context: params.context,
  });
}

/**
 * Create a rate limit hit event.
 */
export function logRateLimitHit(params: {
  route: string;
  identity: string;
  retryAfter?: number;
}): void {
  // Sanitize identity — only log extension ID prefix or "byok" marker
  const safeIdentity = params.identity.startsWith('ext:') 
    ? `ext:${params.identity.slice(4, 12)}...` 
    : params.identity === 'byok' ? 'byok' : 'unknown';
  
  logTelemetryEvent({
    name: 'rate_limit_hit',
    route: params.route,
    category: 'rate_limited',
    retryable: true,
    context: `identity=${safeIdentity}, retryAfter=${params.retryAfter ?? 'unknown'}`,
  });
}

/**
 * Classify a GeminiError code into a telemetry category.
 */
export function classifyGeminiErrorCode(code: string): FailureCategory {
  switch (code) {
    case 'AUTH_ERROR':
      return 'auth_error';
    case 'QUOTA_EXHAUSTED':
      return 'quota_exhausted';
    case 'RATE_LIMITED':
      return 'rate_limited';
    case 'OVERLOADED':
      return 'upstream_timeout';
    case 'API_ERROR':
      return 'upstream_error';
    case 'PARSE_ERROR':
      return 'upstream_parse_error';
    default:
      return 'internal_error';
  }
}

/**
 * Determine if an error is retryable based on category.
 */
export function isRetryableCategory(category: FailureCategory): boolean {
  return ['rate_limited', 'upstream_timeout', 'upstream_error'].includes(category);
}
