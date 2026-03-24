import { describe, expect, it } from 'vitest';

import {
  estimateByteSize,
  truncateTranscriptToFit,
  wouldExceedQuota,
} from '../../src/background/utils/storageQuota';

describe('storage quota helpers', () => {
  it('keeps the newest fitting suffix when only some transcript chunks fit', () => {
    const transcript = [
      { index: 0, text: 'alpha '.repeat(20), startTime: 0, duration: 1 },
      { index: 1, text: 'beta '.repeat(20), startTime: 10, duration: 1 },
      { index: 2, text: 'gamma '.repeat(20), startTime: 20, duration: 1 },
    ];

    const maxBytes = estimateByteSize([transcript[1], transcript[2]]) + 16;
    expect(truncateTranscriptToFit(transcript, maxBytes)).toEqual([transcript[1], transcript[2]]);
  });

  it('returns an empty transcript when zero chunks fit', () => {
    const transcript = [
      { index: 0, text: 'oversized transcript chunk', startTime: 0, duration: 1 },
    ];

    expect(truncateTranscriptToFit(transcript, 2)).toEqual([]);
  });

  it('keeps quota estimation deterministic for normal payloads', () => {
    const payload = { a: 'hello', b: [1, 2, 3] };
    expect(estimateByteSize(payload)).toBeGreaterThan(0);
    expect(wouldExceedQuota({ payload }, 1)).toBe(true);
    expect(wouldExceedQuota({ payload }, 10_000)).toBe(false);
  });
});
