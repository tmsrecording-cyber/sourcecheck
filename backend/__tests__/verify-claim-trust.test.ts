/**
 * Trust boundary tests for verify-claim route.
 *
 * When Gemini returns no grounding sources, the card must:
 *   1. Status = 'unverifiable' regardless of model verdict
 *   2. sourceTitle replaced with trust-preserving fallback language
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
      claimType: 'study',
      timestampSeconds: 42,
    },
    videoTitle: 'Test Video',
    channelName: 'Test Channel',
    ...overrides,
  };

  return {
    json: () => Promise.resolve(body),
    headers: new Headers({
      'origin': 'chrome-extension://test-extension-id',
    }),
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
    expect(json.sourceCard.sourceTitle).toBe('Needs primary source');
    expect(json.sourceCard.sourceType).toBe('other');
    expect(json.sourceCard.sourceUrl).toBe('');
    expect(json.sourceCard.nuance).toBe('This likely needs a paper, dataset, or official record.');
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
    expect(json.sourceCard.sourceTitle).toBe('Needs primary source');
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

    expect(json.sourceCard.nuance).toBe('This likely needs a paper, dataset, or official record.');
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

    expect(json.sourceCard.nuance).toBe('This likely needs a paper, dataset, or official record.');
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

    expect(json.sourceCard.sourceTitle).toBe('Needs primary source');
    expect(json.sourceCard.nuance).toBe('This likely needs a paper, dataset, or official record.');
  });

  it('uses missing-context language when the unresolved outcome lacks specifics', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'unverifiable',
        sourceTitle: '',
        sourceType: 'other',
        nuance: 'Missing context about timeframe and population.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('More context needed');
    expect(json.sourceCard.nuance).toBe('The claim needs specifics like timeframe, population, or definition.');
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
      sources: [
        { title: 'Reuters Fact Check', url: 'https://example.com/reuters' },
        { title: 'Associated Press', url: 'https://example.com/ap' },
      ],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('Needs primary source');
    expect(json.sourceCard.sourceType).toBe('other');
    expect(json.sourceCard.sourceUrl).toBe('');
  });

  it('preserves grounded disputed behavior', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'disputed',
        sourceTitle: 'Reuters Fact Check',
        sourceType: 'news_article',
        nuance: 'Major sources disagree on the size of the effect.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [{ title: 'Reuters Fact Check', url: 'https://example.com/reuters' }],
    });

    const res = await POST(makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('disputed');
    expect(json.sourceCard.sourceTitle).toBe('Reuters Fact Check');
    expect(json.sourceCard.sourceUrl).toBe('https://example.com/reuters');
    expect(json.sourceCard.nuance).toBe('Major sources disagree on the size of the effect.');
  });
});
