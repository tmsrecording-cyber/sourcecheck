/**
 * Minimal, privacy-conscious telemetry for the extension background.
 * 
 * This module provides structured error/failure logging for critical paths.
 * No transcript text, no user questions, no API keys, no tokens logged.
 * 
 * Events are logged to console only — no external services.
 */

export type FailureCategory =
  | 'session_init_failed'
  | 'provider_auth_error'
  | 'provider_quota_exhausted'
  | 'rate_limited'
  | 'transcript_fetch_failed'
  | 'transcript_unavailable'
  | 'transcript_parse_failed'
  | 'verify_failed'
  | 'ask_failed';

export type TelemetryEvent = {
  name: 'failure' | 'retry_exhausted' | 'state_transition';
  timestamp: number;
  category: FailureCategory;
  route?: string;
  statusCode?: number;
  errorCode?: string;
  retryable?: boolean;
  context?: string;
};

const MAX_BUFFERED_EVENTS = 50;
const eventBuffer: TelemetryEvent[] = [];

/**
 * Log a structured telemetry event.
 */
export function logTelemetryEvent(event: Omit<TelemetryEvent, 'timestamp'>): void {
  const fullEvent: TelemetryEvent = {
    ...event,
    timestamp: Date.now(),
  };

  // Add to ring buffer for debugging
  eventBuffer.push(fullEvent);
  if (eventBuffer.length > MAX_BUFFERED_EVENTS) {
    eventBuffer.shift();
  }

  // Log structured JSON for log aggregation
  const logLine = `[SourceCheck/Telemetry] ${JSON.stringify(fullEvent)}`;
  
  // Use appropriate log level
  if (event.name === 'retry_exhausted' || event.category === 'provider_auth_error') {
    console.error(logLine);
  } else if (event.category === 'rate_limited' || event.category === 'provider_quota_exhausted') {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

/**
 * Log a session token acquisition failure.
 */
export function logSessionInitFailure(params: {
  statusCode?: number;
  context?: string;
  retryable?: boolean;
}): void {
  logTelemetryEvent({
    name: 'failure',
    category: 'session_init_failed',
    ...params,
  });
}

/**
 * Log a provider error from the backend.
 */
export function logProviderError(params: {
  category: FailureCategory;
  route: string;
  errorCode?: string;
  retryable: boolean;
  context?: string;
}): void {
  logTelemetryEvent({
    name: 'failure',
    ...params,
  });
}

/**
 * Log that retries were exhausted for an operation.
 */
export function logRetryExhausted(params: {
  category: FailureCategory;
  route?: string;
  attempts: number;
  context?: string;
}): void {
  logTelemetryEvent({
    name: 'retry_exhausted',
    category: params.category,
    route: params.route,
    context: `attempts=${params.attempts}${params.context ? ', ' + params.context : ''}`,
  });
}

/**
 * Log transcript-related failures.
 */
export function logTranscriptFailure(params: {
  category: 'transcript_fetch_failed' | 'transcript_unavailable' | 'transcript_parse_failed';
  source?: string;
  context?: string;
}): void {
  logTelemetryEvent({
    name: 'failure',
    category: params.category,
    context: params.source ? `source=${params.source}` + (params.context ? `, ${params.context}` : '') : params.context,
  });
}

/**
 * Get recent events from buffer (for debugging).
 */
export function getRecentTelemetryEvents(limit: number = 30): TelemetryEvent[] {
  return eventBuffer.slice(-limit);
}

/**
 * Clear the telemetry buffer.
 */
export function clearTelemetryBuffer(): void {
  eventBuffer.length = 0;
}
