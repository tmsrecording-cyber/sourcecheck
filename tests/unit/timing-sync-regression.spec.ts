import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeSeconds, roundSeconds, secondsFromMilliseconds } from '../../shared/time';

const playbackSource = readFileSync(
  join(process.cwd(), 'src/content/playback.ts'),
  'utf8',
);
const serviceWorkerSource = readFileSync(
  join(process.cwd(), 'src/background/service-worker.ts'),
  'utf8',
);

describe('timing sync regression guardrails', () => {
  it('rounds media time to millisecond precision without flooring', () => {
    expect(roundSeconds(12.34567)).toBe(12.346);
    expect(normalizeSeconds(98.76543)).toBe(98.765);
    expect(secondsFromMilliseconds(9876)).toBe(9.876);
  });

  it('preserves fractional playback time and duration in the content script', () => {
    expect(playbackSource).toContain('normalizeSeconds(video.currentTime)');
    expect(playbackSource).toContain('normalizeSeconds(video.duration)');
    expect(playbackSource).not.toContain('Math.floor(video.currentTime)');
    expect(playbackSource).not.toContain('Math.floor(video.duration)');
  });

  it('forces immediate playback resync on explicit media state changes', () => {
    expect(playbackSource).toContain("video.addEventListener('ratechange', forceSyncListener)");
    expect(playbackSource).toContain("video.addEventListener('play', forceSyncListener)");
    expect(playbackSource).toContain("video.addEventListener('pause', forceSyncListener)");
  });

  it('preserves transcript sub-second timing in the worker', () => {
    expect(serviceWorkerSource).toContain('secondsFromMilliseconds(chunk.startMs)');
    expect(serviceWorkerSource).toContain('normalizeSeconds(chunk.startTime)');
    expect(serviceWorkerSource).toContain('secondsFromMilliseconds(raw.startMs)');
    expect(serviceWorkerSource).not.toContain('Math.floor(chunk.startMs / 1000)');
    expect(serviceWorkerSource).not.toContain('Math.floor(raw.startMs / 1000)');
  });
});
