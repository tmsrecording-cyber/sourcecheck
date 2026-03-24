/**
 * PARSE_ERROR Evidence Collection
 * 
 * Tracks JSON parsing and schema validation failures by:
 * - Route (analyze-chunk, verify-claim, ask-video)
 * - Model (gemini-2.5-flash, etc.)
 * - Error type (parse vs schema vs empty)
 * - Recovery path usage
 * 
 * NO automatic fallback here — this is evidence gathering only.
 * NO PII — only counts, lengths, and categorical data.
 */

export type ParseErrorRoute = '/api/analyze-chunk' | '/api/verify-claim' | '/api/ask-video';

export type ParseErrorType = 
  | 'empty_response'      // Gemini returned empty text
  | 'json_syntax'         // Invalid JSON syntax
  | 'schema_mismatch'     // JSON valid but doesn't match schema
  | 'array_unwrap_failed' // Got array when object expected (not single-element)
  | 'truncation_detected'; // Token limit truncation indicators

export interface ParseErrorEvidence {
  timestamp: number;
  route: ParseErrorRoute;
  model: string;
  errorType: ParseErrorType;
  rawLength: number;           // Length of raw response (not content)
  recoveryAttempted: boolean;  // Whether retry/recovery was tried
  recoverySucceeded: boolean;  // Whether recovery worked
  schemaUsed: boolean;         // Whether strict schema was enforced
}

// In-memory counters (resets on deploy — for evidence gathering phase)
const parseErrorCounters = new Map<string, number>();
const parseErrorSamples: ParseErrorEvidence[] = [];
const MAX_SAMPLES = 50;

export const shouldWarnForParseEvidence = (route: ParseErrorRoute): boolean =>
  route === '/api/verify-claim' || route === '/api/analyze-chunk';

/**
 * Record a parse/schema error for evidence.
 * Called from gemini.ts when JSON parsing fails.
 */
export function recordParseError(evidence: Omit<ParseErrorEvidence, 'timestamp'>): void {
  const fullEvidence: ParseErrorEvidence = {
    ...evidence,
    timestamp: Date.now(),
  };

  // Increment counter
  const key = `${evidence.route}|${evidence.model}|${evidence.errorType}`;
  parseErrorCounters.set(key, (parseErrorCounters.get(key) || 0) + 1);

  // Store sample (ring buffer)
  parseErrorSamples.push(fullEvidence);
  if (parseErrorSamples.length > MAX_SAMPLES) {
    parseErrorSamples.shift();
  }

  // Structured log for aggregation. Verify/analyze parse churn is often recoverable
  // or surfaced as structured 200 responses, so keep it out of error-level noise.
  const log = shouldWarnForParseEvidence(evidence.route) ? console.warn : console.error;
  log('[parse-evidence]', JSON.stringify({
    ...fullEvidence,
    rawLength: evidence.rawLength, // Already safe (just length, not content)
  }));
}

/**
 * Get parse error counts by route/model/type.
 * For evidence analysis and reporting.
 */
export function getParseErrorCounts(): Record<string, number> {
  return Object.fromEntries(parseErrorCounters);
}

/**
 * Get recent parse error samples.
 * For detailed debugging (no PII in samples).
 */
export function getParseErrorSamples(limit: number = 20): ParseErrorEvidence[] {
  return parseErrorSamples.slice(-limit);
}

/**
 * Get summary statistics for evidence reporting.
 */
export function getParseErrorSummary(): {
  totalErrors: number;
  byRoute: Record<string, number>;
  byModel: Record<string, number>;
  byType: Record<string, number>;
  recoveryRate: number; // % of errors where recovery succeeded
} {
  const byRoute: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byType: Record<string, number> = {};
  
  let totalRecoveryAttempted = 0;
  let totalRecoverySucceeded = 0;

  for (const sample of parseErrorSamples) {
    byRoute[sample.route] = (byRoute[sample.route] || 0) + 1;
    byModel[sample.model] = (byModel[sample.model] || 0) + 1;
    byType[sample.errorType] = (byType[sample.errorType] || 0) + 1;
    
    if (sample.recoveryAttempted) {
      totalRecoveryAttempted++;
      if (sample.recoverySucceeded) totalRecoverySucceeded++;
    }
  }

  return {
    totalErrors: parseErrorSamples.length,
    byRoute,
    byModel,
    byType,
    recoveryRate: totalRecoveryAttempted > 0 
      ? Math.round((totalRecoverySucceeded / totalRecoveryAttempted) * 100) 
      : 0,
  };
}

/**
 * Clear all evidence (for testing).
 */
export function clearParseEvidence(): void {
  parseErrorCounters.clear();
  parseErrorSamples.length = 0;
}
