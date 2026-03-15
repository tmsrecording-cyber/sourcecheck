/**
 * Trust boundary tests for verify-claim route.
 *
 * When Gemini returns no grounding sources, the card must:
 *   1. Status = 'unverifiable' regardless of model verdict
 *   2. sourceTitle replaced with generic fallback
 *   3. sourceType forced to 'other'
 *   4. sourceUrl is empty
 *   5. Nuance scrubbed of both positive and negative certainty language
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// The route handler calls askGeminiJSONWithSearch — mock it so we control
// whether grounding sources are present.
// ---------------------------------------------------------------------------
const mockAskGemini = vi.fn();
vi.mock('../src/lib/gemini', () => ({
  askGeminiJSONWithSearch: (...args: unknown[]) => mockAskGemini(...args),
  isGeminiError: () => false,
}));

// Stub crypto.randomUUID for deterministic IDs
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => '00000000-0000-0000-0000-000000000000',
});

// ---------------------------------------------------------------------------
// Import the handler under test
// ---------------------------------------------------------------------------
import { POST } from '../src/app/api/verify-claim/route';
import type { NextRequest } from 'next/server';

function makeVerifyRequest(overrides: Record<string, unknown> = {}) {
  const body = {
    claim: {
      claimText: 'The earth is flat.',
      claimType: 'factual',
      timestampSeconds: 42,
    },
    videoTitle: 'Test Video',
    channelName: 'Test Channel',
    ...overrides,
  };

  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe('Verify-claim trust boundary: ungrounded responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downgrades supported verdict to unverifiable when no grounding sources', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'supported',
        sourceTitle: 'Nature Magazine 2024',
        sourceType: 'academic_paper',
        nuance: 'An interesting finding.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [], // <-- no grounding
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('No web source found');
    expect(json.sourceCard.sourceType).toBe('other');
    expect(json.sourceCard.sourceUrl).toBe('');
  });

  it('downgrades disputed verdict to unverifiable when no grounding sources', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'disputed',
        sourceTitle: 'Reuters Fact Check',
        sourceType: 'news_article',
        nuance: 'This claim is debunked by multiple sources.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('No web source found');
    expect(json.sourceCard.sourceType).toBe('other');
  });

  it('scrubs positive certainty language from ungrounded nuance', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'supported',
        sourceTitle: 'Some Paper',
        sourceType: 'academic_paper',
        nuance: 'Confirmed by a 2020 meta-analysis in The Lancet.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.nuance).toBe('Could not find web sources to check this claim.');
  });

  it('scrubs negative certainty language from ungrounded nuance', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'disputed',
        sourceTitle: 'Snopes',
        sourceType: 'news_article',
        nuance: 'This is false according to official records.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.nuance).toBe('Could not find web sources to check this claim.');
  });

  it('preserves neutral nuance even when ungrounded', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'unverifiable',
        sourceTitle: '',
        sourceType: 'other',
        nuance: 'No relevant data found for this specific claim.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    // Neutral language should pass through — only assertive certainty is scrubbed.
    expect(json.sourceCard.nuance).toBe('No relevant data found for this specific claim.');
  });

  it('keeps grounded response intact when sources are present', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'supported',
        sourceTitle: 'WHO Report 2024',
        sourceType: 'official_source',
        nuance: 'Confirmed by WHO guidelines published in 2024.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [{ title: 'WHO Report 2024', url: 'https://who.int/report' }],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('supported');
    expect(json.sourceCard.sourceTitle).toBe('WHO Report 2024');
    expect(json.sourceCard.sourceType).toBe('official_source');
    expect(json.sourceCard.sourceUrl).toBe('https://who.int/report');
    // Nuance with positive language is fine when grounded
    expect(json.sourceCard.nuance).toBe('Confirmed by WHO guidelines published in 2024.');
  });

  it('returns an empty sourceUrl when grounded source titles do not match at all', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'supported',
        sourceTitle: 'WHO Report 2024',
        sourceType: 'official_source',
        nuance: 'Confirmed by WHO guidelines published in 2024.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [
        { title: 'Reuters Fact Check', url: 'https://example.com/reuters' },
        { title: 'Associated Press', url: 'https://example.com/ap' },
      ],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('supported');
    expect(json.sourceCard.sourceTitle).toBe('WHO Report 2024');
    expect(json.sourceCard.sourceType).toBe('official_source');
    expect(json.sourceCard.sourceUrl).toBe('');
  });
});
