import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { askGeminiJSON } from '../src/lib/gemini';

// Store original fetch for cleanup
let originalFetch: typeof global.fetch;

function setupFetchMock() {
  originalFetch = global.fetch;
  global.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                // Flash 3.0 might mix thoughts and text, or append trailing commas
                { text: 'Here are my thoughts:\n```json\n{\n  "status": "supported",\n  "sourceTitle": "Test",\n  "sourceType": "other",\n  "nuance": "Text",\n  "extra": 123,\n}\n```\n' }
              ]
            },
            finishReason: 'STOP'
          }
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }
      })
    } as Response;
  };
}

function cleanupFetchMock() {
  global.fetch = originalFetch;
}

describe('Flash 3.0 parse regression', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    setupFetchMock();
  });

  afterEach(() => {
    cleanupFetchMock();
  });

  it('PASS: safely extracts JSON from markdown fences with trailing commas', async () => {
    const { data } = await askGeminiJSON('test prompt', 1000);
    expect(data).toHaveProperty('status', 'supported');
    expect(data).toHaveProperty('sourceTitle', 'Test');
  });

  it('PASS: lite extraction requests still force application/json while omitting schema constraints', async () => {
    let requestBody: any = null;
    global.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: '{"status":"supported","sourceTitle":"Test","sourceType":"other","nuance":"Text"}' }
                ]
              },
              finishReason: 'STOP'
            }
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 }
        })
      } as Response;
    };

    await askGeminiJSON(
      'test prompt',
      1000,
      {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
      },
      'gemini-3.1-flash-lite-preview',
      'custom-key'
    );

    expect(requestBody?.generationConfig?.responseMimeType).toBe('application/json');
    expect(requestBody?.generationConfig?.responseJsonSchema).toBeUndefined();
  });
});
