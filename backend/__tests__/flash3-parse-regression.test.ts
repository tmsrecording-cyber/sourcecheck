import { describe, it, expect, beforeEach } from 'vitest';
import { askGeminiJSON } from '../src/lib/gemini';

// Mock fetch globally
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

describe('Flash 3.0 parse regression', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('PASS: safely extracts JSON from markdown fences with trailing commas', async () => {
    const { data } = await askGeminiJSON('test prompt', 1000);
    expect(data).toHaveProperty('status', 'supported');
    expect(data).toHaveProperty('sourceTitle', 'Test');
  });
});

