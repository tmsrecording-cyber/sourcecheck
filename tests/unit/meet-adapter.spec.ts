// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { meetAdapter } from '../../src/content/adapters/meet';
import type { TranscriptChunk } from '../../src/content/transcript';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeLocation = (pathname: string, hostname = 'meet.google.com'): Location =>
  ({ pathname, hostname, search: '', hash: '', href: `https://${hostname}${pathname}` } as Location);

// ---------------------------------------------------------------------------
// canHandle
// ---------------------------------------------------------------------------

describe('meetAdapter.canHandle', () => {
  it('returns true for a valid 3-4-3 meeting code path', () => {
    expect(meetAdapter.canHandle(makeLocation('/abc-defg-hij'))).toBe(true);
  });

  it('returns true with trailing slash', () => {
    expect(meetAdapter.canHandle(makeLocation('/abc-defg-hij/'))).toBe(true);
  });

  it('returns true with query string', () => {
    expect(meetAdapter.canHandle(makeLocation('/abc-defg-hij?authuser=0'))).toBe(true);
  });

  it('returns false for Meet lobby (/)', () => {
    expect(meetAdapter.canHandle(makeLocation('/'))).toBe(false);
  });

  it('returns false for a YouTube URL on meet.google.com hostname (impossible in practice but guarded)', () => {
    expect(meetAdapter.canHandle(makeLocation('/watch?v=abc123'))).toBe(false);
  });

  it('returns false when hostname is not meet.google.com', () => {
    expect(meetAdapter.canHandle(makeLocation('/abc-defg-hij', 'www.youtube.com'))).toBe(false);
  });

  it('returns false for a short invalid code', () => {
    expect(meetAdapter.canHandle(makeLocation('/ab-cdef-gh'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getVideoId
// ---------------------------------------------------------------------------

describe('meetAdapter.getVideoId', () => {
  it('extracts the meeting code from the path', () => {
    expect(meetAdapter.getVideoId(makeLocation('/abc-defg-hij'))).toBe('abc-defg-hij');
  });

  it('strips query string from the meeting code', () => {
    expect(meetAdapter.getVideoId(makeLocation('/abc-defg-hij?authuser=0'))).toBe('abc-defg-hij');
  });

  it('returns null for non-matching paths', () => {
    expect(meetAdapter.getVideoId(makeLocation('/'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildSourceContext
// ---------------------------------------------------------------------------

describe('meetAdapter.buildSourceContext', () => {
  it('always returns visibility: private and type: meet', () => {
    const ctx = meetAdapter.buildSourceContext('abc-defg-hij', 'Q3 Planning');
    expect(ctx).toEqual({
      type: 'meet',
      visibility: 'private',
      sourceId: 'abc-defg-hij',
      sourceLabel: 'Q3 Planning',
    });
  });
});

// ---------------------------------------------------------------------------
// extractMetadata
// ---------------------------------------------------------------------------

describe('meetAdapter.extractMetadata', () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it('strips the "Google Meet | " prefix from the page title', () => {
    document.title = 'Google Meet | Q3 Planning';
    const { title, channel } = meetAdapter.extractMetadata(document);
    expect(title).toBe('Q3 Planning');
    expect(channel).toBe('Google Meet');
  });

  it('strips the "Google Meet – " dash variant', () => {
    document.title = 'Google Meet – Design Review';
    const { title, channel } = meetAdapter.extractMetadata(document);
    expect(title).toBe('Design Review');
  });

  it('falls back to "Google Meet" when title is the generic default', () => {
    document.title = 'Google Meet';
    const { title } = meetAdapter.extractMetadata(document);
    expect(title).toBe('Google Meet');
  });

  it('always returns channel "Google Meet"', () => {
    document.title = 'Anything';
    const { channel } = meetAdapter.extractMetadata(document);
    expect(channel).toBe('Google Meet');
  });
});

// ---------------------------------------------------------------------------
// extractTranscript — always returns null (live caption path)
// ---------------------------------------------------------------------------

describe('meetAdapter.extractTranscript', () => {
  it('resolves to null immediately (live caption path does not use this method)', async () => {
    const result = await meetAdapter.extractTranscript(
      'abc-defg-hij',
      new AbortController().signal,
      () => {},
      {},
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startLiveCapture
// ---------------------------------------------------------------------------

describe('meetAdapter.startLiveCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clean up any injected DOM nodes
    document.body.innerHTML = '';
  });

  it('is defined on the adapter', () => {
    expect(typeof meetAdapter.startLiveCapture).toBe('function');
  });

  it('calls onChunk when caption DOM is mutated with new text', async () => {
    const controller = new AbortController();
    const chunks: TranscriptChunk[] = [];

    meetAdapter.startLiveCapture!('abc-defg-hij', controller.signal, (chunk) => {
      chunks.push(chunk);
    }, () => {});

    // Inject a caption node matching the ARIA live region selector
    const captionEl = document.createElement('div');
    captionEl.setAttribute('jsname', 'tgaKEf');
    captionEl.textContent = 'The quick brown fox jumps over the lazy dog.';
    document.body.appendChild(captionEl);

    // Allow MutationObserver microtasks to settle
    await Promise.resolve();
    // Advance timers past the silence flush deadline
    vi.advanceTimersByTime(4000);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].text).toContain('quick brown fox');

    controller.abort();
  });

  it('stops producing chunks after the signal is aborted', async () => {
    const controller = new AbortController();
    const chunks: TranscriptChunk[] = [];

    meetAdapter.startLiveCapture!('abc-defg-hij', controller.signal, (chunk) => {
      chunks.push(chunk);
    }, () => {});

    controller.abort();

    const captionEl = document.createElement('div');
    captionEl.setAttribute('jsname', 'tgaKEf');
    captionEl.textContent = 'This text should not be captured.';
    document.body.appendChild(captionEl);

    await Promise.resolve();
    vi.advanceTimersByTime(4000);

    expect(chunks.length).toBe(0);
  });

  it('deduplicates incremental caption growth — only emits the new words', async () => {
    const controller = new AbortController();
    const chunks: TranscriptChunk[] = [];

    meetAdapter.startLiveCapture!('abc-defg-hij', controller.signal, (chunk) => {
      chunks.push(chunk);
    }, () => {});

    const captionEl = document.createElement('div');
    captionEl.setAttribute('jsname', 'tgaKEf');
    document.body.appendChild(captionEl);

    // Step 1: first words appear
    captionEl.textContent = 'The quick';
    await Promise.resolve();

    // Step 2: Meet grows the same utterance in-place
    captionEl.textContent = 'The quick brown fox';
    await Promise.resolve();

    // Step 3: sentence completes — should flush
    captionEl.textContent = 'The quick brown fox jumps.';
    await Promise.resolve();
    vi.advanceTimersByTime(4000);

    // The flushed chunk must NOT contain the duplicated prefix
    const flushedText = chunks.map((c) => c.text).join(' ');
    expect(flushedText).not.toMatch(/quick.*quick/);
    // But it must contain the full sentence once
    expect(flushedText).toContain('quick brown fox');

    controller.abort();
  });

  it('handles a full caption reset (new utterance) without duplicating old text', async () => {
    const controller = new AbortController();
    const chunks: TranscriptChunk[] = [];

    meetAdapter.startLiveCapture!('abc-defg-hij', controller.signal, (chunk) => {
      chunks.push(chunk);
    }, () => {});

    const captionEl = document.createElement('div');
    captionEl.setAttribute('jsname', 'tgaKEf');
    document.body.appendChild(captionEl);

    // First utterance completes
    captionEl.textContent = 'First sentence.';
    await Promise.resolve();
    vi.advanceTimersByTime(4000);

    // Caption resets to a completely new utterance (doesn't start with old text)
    captionEl.textContent = 'Second sentence.';
    await Promise.resolve();
    vi.advanceTimersByTime(4000);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toContain('First sentence');
    expect(chunks[1].text).toContain('Second sentence');

    controller.abort();
  });
});

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

describe('adapter registry', () => {
  it('meetAdapter has sourceType meet and visibility private', () => {
    expect(meetAdapter.sourceType).toBe('meet');
    expect(meetAdapter.visibility).toBe('private');
  });
});
