import { describe, expect, it } from 'vitest';

import { GeminiError, isRecoverableUpstreamWarning } from '../src/lib/gemini';

describe('gemini upstream warning classification', () => {
  it('treats recoverable truncation and empty-response finish reasons as warnings', () => {
    expect(
      isRecoverableUpstreamWarning(
        new GeminiError(
          'API_ERROR',
          'Gemini stopped at MAX_TOKENS before returning a complete response (gemini-2.5-flash).',
          502,
        ),
      ),
    ).toBe(true);

    expect(
      isRecoverableUpstreamWarning(
        new GeminiError(
          'API_ERROR',
          'Gemini returned no text (finishReason=OTHER, model=gemini-2.5-flash).',
          502,
        ),
      ),
    ).toBe(true);
  });

  it('does not downgrade unrelated API failures', () => {
    expect(
      isRecoverableUpstreamWarning(
        new GeminiError('API_ERROR', 'Gemini API request timed out for gemini-2.5-flash.', 504),
      ),
    ).toBe(false);

    expect(
      isRecoverableUpstreamWarning(
        new GeminiError('QUOTA_EXHAUSTED', 'Free tier limit reached.', 429),
      ),
    ).toBe(false);
  });
});
