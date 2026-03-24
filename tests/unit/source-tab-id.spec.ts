import { describe, expect, it } from 'vitest';

import { getSourceIdFromTabUrl } from '../../src/background/utils/sourceTabId';

describe('getSourceIdFromTabUrl', () => {
  it('extracts YouTube video ids from the v query param', () => {
    expect(
      getSourceIdFromTabUrl('https://www.youtube.com/watch?v=abc123xyz99', 'youtube'),
    ).toBe('abc123xyz99');
  });

  it('rejects non-YouTube hosts even when they include a v param', () => {
    expect(
      getSourceIdFromTabUrl('https://example.com/watch?v=abc123xyz99', 'youtube'),
    ).toBeNull();
  });

  it('rejects non-watch YouTube paths', () => {
    expect(
      getSourceIdFromTabUrl('https://www.youtube.com/shorts/abc123xyz99?v=abc123xyz99', 'youtube'),
    ).toBeNull();
  });

  it('extracts Google Meet source ids from the pathname', () => {
    expect(
      getSourceIdFromTabUrl('https://meet.google.com/abc-defg-hij?authuser=1', 'meet'),
    ).toBe('abc-defg-hij');
  });

  it('normalizes trailing slashes for Meet paths', () => {
    expect(
      getSourceIdFromTabUrl('https://meet.google.com/abc-defg-hij/?authuser=1', 'meet'),
    ).toBe('abc-defg-hij');
  });

  it('rejects malformed Meet paths', () => {
    expect(
      getSourceIdFromTabUrl('https://meet.google.com/not-a-meet-code', 'meet'),
    ).toBeNull();
  });

  it('falls back to hostname detection for Meet when source type is missing', () => {
    expect(
      getSourceIdFromTabUrl('https://meet.google.com/abc-defg-hij?pli=1'),
    ).toBe('abc-defg-hij');
  });

  it('returns null for invalid or missing urls', () => {
    expect(getSourceIdFromTabUrl(undefined, 'youtube')).toBeNull();
    expect(getSourceIdFromTabUrl('not-a-url', 'youtube')).toBeNull();
  });
});
