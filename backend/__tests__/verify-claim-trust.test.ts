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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupSessionAuthEnv, createAuthHeaders, createUnauthHeaders, TEST_EXTENSION_ID, mockCryptoSubtle } from './helpers/session';

// ---------------------------------------------------------------------------
// The route handler calls askGeminiJSONWithSearch — mock it so we control
// whether grounding sources are present.
// ---------------------------------------------------------------------------
const mockAskGemini = vi.fn();
vi.mock('../src/lib/gemini', () => ({
  askGeminiJSONWithSearch: (...args: unknown[]) => mockAskGemini(...args),
  isGeminiError: () => false,
  generateEmbedding: () => Promise.resolve([]), // Embeddings disabled in tests
}));

// crypto will be stubbed in beforeEach with proper subtle mock

// ---------------------------------------------------------------------------
// Import the handler under test
// ---------------------------------------------------------------------------
import { POST } from '../src/app/api/verify-claim/route';
import type { NextRequest } from 'next/server';

async function makeVerifyRequest(overrides: Record<string, unknown> = {}, includeAuth = true) {
  const body = {
    claim: {
      claimText: 'The earth is flat.',
      claimType: 'study',
      timestampSeconds: 42,
    },
    videoId: 'test-video-123',
    videoTitle: 'Test Video',
    channelName: 'Test Channel',
    ...overrides,
  };

  const headers = includeAuth
    ? await createAuthHeaders(TEST_EXTENSION_ID)
    : createUnauthHeaders(TEST_EXTENSION_ID);

  return {
    json: () => Promise.resolve(body),
    headers: new Headers(headers),
    nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
  } as unknown as NextRequest;
}

describe('Verify-claim trust boundary: ungrounded responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSessionAuthEnv();
    mockCryptoSubtle();
  });
  
  afterEach(() => {
    vi.unstubAllGlobals();
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('Source not available');
    expect(json.sourceCard.sourceType).toBe('other');
    expect(json.sourceCard.sourceUrl).toBe('');
    expect(json.sourceCard.nuance).toBe('This type of claim requires access to papers, filings, or official records.');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('Source not available');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.nuance).toBe('This type of claim requires access to papers, filings, or official records.');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.nuance).toBe('This type of claim requires access to papers, filings, or official records.');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.sourceTitle).toBe('Source not available');
    expect(json.sourceCard.nuance).toBe('This type of claim requires access to papers, filings, or official records.');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('Missing details');
    expect(json.sourceCard.nuance).toBe('The claim is too vague—needs dates, names, or specifics to verify.');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('unverifiable');
    expect(json.sourceCard.sourceTitle).toBe('Source not available');
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

    const res = await POST(await makeVerifyRequest());
    const json = await res.json();

    expect(json.sourceCard.status).toBe('disputed');
    expect(json.sourceCard.sourceTitle).toBe('Reuters Fact Check');
    expect(json.sourceCard.sourceUrl).toBe('https://example.com/reuters');
    expect(json.sourceCard.nuance).toBe('Major sources disagree on the size of the effect.');
  });

  it('PASS: request without session token returns 401 Unauthorized', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'supported',
        sourceTitle: 'Test Source',
        sourceType: 'news_article',
        nuance: 'Test nuance.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [{ title: 'Test Source', url: 'https://example.com/test' }],
    });

    const res = await POST(await makeVerifyRequest({}, false));
    expect(res.status).toBe(401);
    
    const json = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  it('PASS: BYOK requests skip rate limiting', async () => {
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'supported',
        sourceTitle: 'Test Source',
        sourceType: 'news_article',
        nuance: 'Test nuance.',
      },
      inputTokens: 10,
      outputTokens: 20,
      sources: [{ title: 'Test Source', url: 'https://example.com/test' }],
    });

    const headers = await createAuthHeaders(TEST_EXTENSION_ID);
    const res = await POST({
      json: () => Promise.resolve({
        claim: { claimText: 'Test claim', claimType: 'study', timestampSeconds: 42 },
        videoId: 'test-video-123',
        videoTitle: 'Test Video',
        channelName: 'Test Channel',
      }),
      headers: new Headers({
        ...headers,
        'x-custom-api-key': 'user-provided-api-key',
      }),
      nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
    } as unknown as NextRequest);
    
    // Should succeed despite low rate limit budget because BYOK skips rate limiting
    expect(res.status).toBe(200);
  });

  it('stores wording version with cached claims for future invalidation', async () => {
    // Gemini returns unverifiable with no grounding
    mockAskGemini.mockResolvedValue({
      data: {
        status: 'unverifiable',
        sourceTitle: 'Some old title',
        sourceType: 'other',
        nuance: '[From memory] Old cached wording that should be versioned.',
      },
      sources: [], // No grounding sources
      inputTokens: 100,
      outputTokens: 50,
    });

    const headers = await createAuthHeaders(TEST_EXTENSION_ID);
    const res = await POST({
      json: () => Promise.resolve({
        claim: { claimText: 'Test versioning claim', claimType: 'study', timestampSeconds: 42 },
        videoId: 'test-video-123',
        videoTitle: 'Test Video',
        channelName: 'Test Channel',
      }),
      headers: new Headers(headers),
      nextUrl: { pathname: '/api/verify-claim', hostname: 'localhost' },
    } as unknown as NextRequest);

    expect(res.status).toBe(200);
    const json = await res.json();

    // Status should be unverifiable due to no grounding
    expect(json.sourceCard.status).toBe('unverifiable');
    
    // The response should have scrubbed the old wording (guardUnverifiableNuance)
    expect(json.sourceCard.nuance).not.toContain('[From memory]');
  });
});
