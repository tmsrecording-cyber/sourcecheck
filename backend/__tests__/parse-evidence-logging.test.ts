import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { askGeminiJSON, askGeminiJSONWithSearch } from '../src/lib/gemini';
import { clearParseEvidence } from '../src/lib/parse-evidence';

const TEST_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string' },
  },
  required: ['status'],
  additionalProperties: false,
} as const;

const MALFORMED_JSON_RESPONSE = '```json { "status": "supported", "sourceTitle": "Broken"';

let originalFetch: typeof global.fetch;

const installMalformedFetch = () => {
  originalFetch = global.fetch;
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ text: MALFORMED_JSON_RESPONSE }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
      },
    }),
  })) as typeof global.fetch;
};

const collectLines = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((args) => args.map((value) => String(value)).join(' '));

describe('parse evidence logging severity', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    clearParseEvidence();
    installMalformedFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    clearParseEvidence();
  });

  it('downgrades verify-claim parse churn to warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      askGeminiJSONWithSearch(
        'test prompt',
        700,
        TEST_SCHEMA,
        'gemini-2.5-flash',
        undefined,
        '/api/verify-claim',
      ),
    ).rejects.toMatchObject({ code: 'PARSE_ERROR' });

    const warnLines = collectLines(warnSpy);
    const errorLines = collectLines(errorSpy);

    expect(warnLines.some((line) => line.includes('[gemini.ts] JSON response failure:'))).toBe(true);
    expect(warnLines.some((line) => line.includes('[parse-evidence]'))).toBe(true);
    expect(errorLines.some((line) => line.includes('[gemini.ts] JSON response failure:'))).toBe(false);
    expect(errorLines.some((line) => line.includes('[parse-evidence]'))).toBe(false);
  });

  it('keeps ask-video parse failures at error level', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      askGeminiJSON(
        'test prompt',
        700,
        TEST_SCHEMA,
        'gemini-2.5-flash',
        undefined,
        '/api/ask-video',
      ),
    ).rejects.toMatchObject({ code: 'PARSE_ERROR' });

    const warnLines = collectLines(warnSpy);
    const errorLines = collectLines(errorSpy);

    expect(errorLines.some((line) => line.includes('[gemini.ts] JSON response failure:'))).toBe(true);
    expect(errorLines.some((line) => line.includes('[parse-evidence]'))).toBe(true);
    expect(warnLines.some((line) => line.includes('[gemini.ts] JSON response failure:'))).toBe(false);
    expect(warnLines.some((line) => line.includes('[parse-evidence]'))).toBe(false);
  });
});
