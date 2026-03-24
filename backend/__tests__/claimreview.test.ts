import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchClaimReviewMatches } from '../src/lib/claimreview';
import type { ExtractedClaim } from '../src/types/shared';

const claim: ExtractedClaim = {
  claimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
  claimType: 'historical',
  exactQuote: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
  timestampSeconds: 24,
  confidence: 0.9,
  normalizedClaimText: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
  checkworthiness: 0.9,
  normalizationVersion: 1,
  claimFeatures: {
    speaker: null,
    attributedEntity: null,
    subject: 'The Department of Homeland Security',
    predicate: 'was in',
    object: 'a funding shutdown',
    polarity: 'affirmed',
    quantityRaw: '40 days',
    quantityValue: 40,
    quantityUnit: 'days',
    comparisonOperator: 'eq',
    dateOrPeriodRaw: 'March 2026',
    dateOrPeriodNormalized: '2026-march',
    timeSensitivity: 'time_bound',
    location: null,
    topicTags: ['government'],
    attributionType: 'speaker_assertion',
  },
};

describe('claimreview', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('FACT_CHECK_TOOLS_API_KEY', 'test-key');
    vi.stubEnv('FACT_CHECK_TOOLS_TIMEOUT_MS', '1000');
    vi.stubGlobal('fetch', fetchMock);
    vi.setSystemTime(new Date('2026-03-23T18:00:00.000Z'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  it('returns early with no API key', async () => {
    vi.stubEnv('FACT_CHECK_TOOLS_API_KEY', '');
    const matches = await searchClaimReviewMatches(claim);
    expect(matches).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('builds structured queries and ranks higher-overlap hits first', async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = new URL(String(input));
      const query = url.searchParams.get('query');

      if (query?.includes('funding shutdown')) {
        return {
          ok: true,
          json: async () => ({
            claims: [
              {
                text: 'Government funding issues continued in 2026.',
                claimReview: [
                  {
                    publisher: { name: 'Generic News', site: 'https://generic.example' },
                    url: 'https://generic.example/review',
                    title: 'Generic News review of 2026 funding issues',
                    reviewDate: '2025-01-01T00:00:00.000Z',
                    textualRating: 'Mixed',
                    languageCode: 'en',
                  },
                ],
              },
              {
                text: 'The Department of Homeland Security was in a funding shutdown for 40 days in March 2026.',
                claimReview: [
                  {
                    publisher: { name: 'Reuters', site: 'https://www.reuters.com' },
                    url: 'https://www.reuters.com/fact-check/example',
                    title: 'Reuters fact check: DHS shutdown lasted 40 days in March 2026',
                    reviewDate: '2026-03-22T00:00:00.000Z',
                    textualRating: 'False',
                    languageCode: 'en',
                  },
                ],
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ claims: [] }),
      };
    });

    const matches = await searchClaimReviewMatches(claim);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.some((url) =>
      url.searchParams.get('query') === 'The Department of Homeland Security was in a funding shutdown 40 days March 2026'
    )).toBe(true);

    expect(matches).toHaveLength(2);
    expect(matches[0].hit.reviewPublisher).toBe('Reuters');
    expect(matches[0].hit.claimText).toContain('40 days in March 2026');
    expect(matches[1].hit.reviewPublisher).toBe('Generic News');
  });
});
