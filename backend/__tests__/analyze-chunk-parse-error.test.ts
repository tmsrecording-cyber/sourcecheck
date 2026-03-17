/**
 * Security tests for backend/src/app/api/analyze-chunk/route.ts
 *
 * Fix 4: PARSE_ERROR was silently mapped to BUFFERING
 *   — the route now returns action_state: 'PARSE_ERROR' when Gemini fails to
 *     produce valid JSON, allowing the worker to log and count model failures
 *     separately from genuine mid-sentence buffering holds.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiError } from '../src/lib/gemini';

// ---------------------------------------------------------------------------
// Module mocks (hoisted — run before any imports)
// ---------------------------------------------------------------------------

// Hoist the mock function so it can be referenced both in vi.mock() and tests.
const { mockAskGeminiJSON } = vi.hoisted(() => ({
  mockAskGeminiJSON: vi.fn(),
}));

// Mock @/lib/gemini: keep the real GeminiError + isGeminiError, only stub the
// network-calling function so tests run without a live Gemini API key.
vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/gemini')>();
  return {
    ...actual,
    askGeminiJSON: mockAskGeminiJSON,
  };
});

// Mock @/lib/prompts — prompt content doesn't matter for these tests.
vi.mock('@/lib/prompts', () => ({
  buildClaimExtractionPrompt: vi.fn(() => 'mock-prompt'),
}));

// Minimal NextResponse mock — the test assertions use .status and .json().
vi.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: () => Promise.resolve(body),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { POST } from '../src/app/api/analyze-chunk/route';

// Minimal valid request body — passes all validation guards in the route.
const VALID_BODY = {
  videoId: 'test-video-123',
  videoTitle: 'Test Video',
  channelName: 'Test Channel',
  currentTimestamp: 60,
  chunks: [
    {
      text: 'A new study found that drinking coffee reduces cancer risk by 40 percent.',
      startTime: 60,
      duration: 5,
      index: 0,
    },
  ],
};

function fakeRequest(body = VALID_BODY) {
  return { json: () => Promise.resolve(body) } as any;
}

// ---------------------------------------------------------------------------
// Fix 4 tests
// ---------------------------------------------------------------------------
describe('Fix 4: PARSE_ERROR surfaces as distinct action_state instead of BUFFERING', () => {
  beforeEach(() => {
    mockAskGeminiJSON.mockReset();
  });

  it('PASS: Gemini PARSE_ERROR returns action_state: PARSE_ERROR (not BUFFERING)', async () => {
    mockAskGeminiJSON.mockRejectedValue(
      new GeminiError('PARSE_ERROR', 'Model returned invalid JSON: {bad json}', 502)
    );

    const response = await POST(fakeRequest());
    const body = await response.json();

    expect(body.action_state).toBe('PARSE_ERROR');
    expect(body.action_state).not.toBe('BUFFERING');
    expect(body.has_claim).toBe(false);
    expect(body.claim_text).toBeNull();
    expect(body.claims).toHaveLength(0);
    expect(response.status).toBe(200);  // structured response, not 5xx
  });

  it('PASS: PARSE_ERROR response includes a human-readable reason', async () => {
    mockAskGeminiJSON.mockRejectedValue(
      new GeminiError('PARSE_ERROR', 'Failed to parse Gemini response as JSON.', 502)
    );

    const response = await POST(fakeRequest());
    const body = await response.json();

    expect(typeof body.reason).toBe('string');
    expect(body.reason.length).toBeGreaterThan(0);
  });

  it('PASS: PARSE_ERROR response includes a valid chunkRange', async () => {
    mockAskGeminiJSON.mockRejectedValue(
      new GeminiError('PARSE_ERROR', 'bad json', 502)
    );

    const response = await POST(fakeRequest());
    const body = await response.json();

    expect(body.chunkRange).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('PASS: worker can log PARSE_ERROR distinctly — console.warn is called', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockAskGeminiJSON.mockRejectedValue(
      new GeminiError('PARSE_ERROR', 'Model returned invalid JSON', 502)
    );

    await POST(fakeRequest());

    const parseErrorWarnings = warnSpy.mock.calls.filter(([msg]) =>
      typeof msg === 'string' && msg.includes('PARSE_ERROR')
    );
    expect(parseErrorWarnings.length).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });

  it('PASS: genuine BUFFERING still works when model says no claim', async () => {
    mockAskGeminiJSON.mockResolvedValue({
      data: {
        entities: ['vaccines'],
        has_claim: false,
        action_state: 'BUFFERING',
        reason: 'Awaiting end of statement...',
        candidates: [],
      },
      inputTokens: 100,
      outputTokens: 50,
    });

    const response = await POST(fakeRequest());
    const body = await response.json();

    expect(body.action_state).toBe('BUFFERING');
    expect(body.has_claim).toBe(false);
    expect(body.claims).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it('PASS: successful claim extraction returns action_state: VERIFYING', async () => {
    mockAskGeminiJSON.mockResolvedValue({
      data: {
        entities: ['coffee', 'cancer'],
        has_claim: true,
        action_state: 'VERIFYING',
        reason: 'Quantified health claim with specific percentage.',
        candidates: [
          {
            claim_text: 'Drinking coffee reduces cancer risk by 40 percent.',
            exact_quote: 'drinking coffee reduces cancer risk by 40 percent',
            claim_type: 'study',
            verifiability: 0.9,
            value: 0.9,
            speaker_confidence: 0.9,
            reason: 'Quantified claim with percentage.',
          },
        ],
      },
      inputTokens: 120,
      outputTokens: 60,
    });

    const response = await POST(fakeRequest());
    const body = await response.json();

    expect(body.action_state).toBe('VERIFYING');
    expect(body.has_claim).toBe(true);
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0].claimText).toBe('Drinking coffee reduces cancer risk by 40 percent.');
  });

  it('PASS: has_claim=true without usable claim_text is downgraded to a non-claim response', async () => {
    mockAskGeminiJSON.mockResolvedValue({
      data: {
        entities: ['coffee'],
        has_claim: true,
        action_state: 'VERIFYING',
        reason: 'Model thought it found a claim.',
        candidates: [
          {
            claim_text: '   ',
            exact_quote: 'drinking coffee reduces cancer risk by 40 percent',
            claim_type: 'study',
            verifiability: 0.9,
            value: 0.9,
            speaker_confidence: 0.9,
            reason: 'Model thought it found a claim.',
          },
        ],
      },
      inputTokens: 120,
      outputTokens: 60,
    });

    const response = await POST(fakeRequest());
    const body = await response.json();

    expect(body.has_claim).toBe(false);
    expect(body.claims).toHaveLength(0);
    expect(body.action_state).not.toBe('VERIFYING');
  });

  it('FAIL: non-PARSE_ERROR Gemini errors still return 500 (not PARSE_ERROR state)', async () => {
    mockAskGeminiJSON.mockRejectedValue(
      new GeminiError('API_ERROR', 'Gemini API returned 503', 502)
    );

    const response = await POST(fakeRequest());

    // Should not be treated as a structured PARSE_ERROR response.
    expect(response.status).toBe(500);
  });

  it('FAIL: rate-limit Gemini error returns 429 (not PARSE_ERROR state)', async () => {
    mockAskGeminiJSON.mockRejectedValue(
      new GeminiError('RATE_LIMITED', 'Rate limit hit.', 429)
    );

    const response = await POST(fakeRequest());
    expect(response.status).toBe(429);
  });
});
