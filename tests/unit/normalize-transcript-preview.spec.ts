import { describe, expect, it } from 'vitest';

import { normalizeTranscriptPreview } from '../../src/sidepanel/utils/normalizeTranscriptPreview';

describe('normalizeTranscriptPreview', () => {
  it('converts shouty transcript text to sentence case', () => {
    expect(
      normalizeTranscriptPreview('THAT INTO BY TONIGHT. THANK YOU. AND WE WILL SEE.'),
    ).toBe('That into by tonight. Thank you. And we will see.');
  });

  it('preserves normal sentence-case text', () => {
    expect(
      normalizeTranscriptPreview('Oil prices continue to weigh down the markets.'),
    ).toBe('Oil prices continue to weigh down the markets.');
  });
});
