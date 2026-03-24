import type { TranscriptChunk } from '../../../shared/types';

/**
 * Estimate the byte size of a value when serialized to JSON.
 * This is approximate but sufficient for quota protection.
 */
export const estimateByteSize = (value: unknown): number => {
  try {
    const json = JSON.stringify(value);
    return new Blob([json]).size;
  } catch {
    return Infinity;
  }
};

/**
 * Check if storing data would exceed the quota.
 * Note: This is a best-effort check - actual quota may vary by browser.
 */
export const wouldExceedQuota = (data: Record<string, unknown>, quotaBytes: number): boolean => {
  const totalSize = Object.entries(data).reduce((sum, [, value]) => sum + estimateByteSize(value), 0);
  return totalSize > quotaBytes;
};

/**
 * Truncate a transcript to fit within a byte limit.
 * Keeps the most recent chunks since they're most relevant.
 */
export const truncateTranscriptToFit = (
  transcript: TranscriptChunk[],
  maxBytes: number,
): TranscriptChunk[] => {
  let low = 0;
  let high = transcript.length;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const candidate = transcript.slice(-mid);
    if (estimateByteSize(candidate) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low === 0 ? [] : transcript.slice(-low);
};
