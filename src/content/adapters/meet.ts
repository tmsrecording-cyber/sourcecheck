/**
 * Google Meet transcript adapter.
 *
 * Implements TranscriptAdapter for meet.google.com call pages.
 * Captions are read from the live DOM via MutationObserver — there is no
 * pre-existing transcript to fetch, so extractTranscript returns null and
 * the orchestrator uses startLiveCapture instead.
 *
 * All Meet-specific DOM logic lives here. The worker pipeline and backend
 * APIs remain source-agnostic and never import from this file.
 *
 * Visibility is always 'private': meeting sessions must not be persisted
 * beyond the current browser session or indexed in cross-video memory.
 */

import type { TranscriptChunk } from '../transcript';
import type { TranscriptSourceContext } from '../../../shared/types';
import type { TranscriptAdapter } from './transcript-adapter';

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Pattern for an active Meet call path: /abc-defg-hij (3-4-3 letter code) */
const MEET_CALL_PATH = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}(\/|$|\?)/;

/** Returns the meeting code from the path, e.g. "abc-defg-hij" */
const extractMeetingCode = (pathname: string): string | null => {
  const match = MEET_CALL_PATH.exec(pathname);
  if (!match) return null;
  // pathname starts with /<code>, strip the leading slash
  return pathname.split('/')[1]?.split('?')[0] ?? null;
};

// ---------------------------------------------------------------------------
// Caption DOM selectors
// Ordered from most stable to least stable. MeetCaptionReader tries each in
// sequence and uses the first one that yields a non-empty node list.
// ---------------------------------------------------------------------------

/**
 * Candidate selectors for the live caption text container.
 * Google Meet's DOM is Closure-compiled; class names change across deploys.
 * jsname and aria attributes are more stable but are still not a public API.
 * Selector maintenance is expected as part of Meet adapter upkeep.
 *
 * NOTE: [aria-live="polite"] intentionally excluded — Meet uses it for ALL
 * system notifications (microphone status, participant join/leave, etc.),
 * not just captions. Including it floods the transcript with UI noise.
 * Captions must be enabled in Meet (CC button) for either selector below to exist.
 */
const CAPTION_TEXT_SELECTORS = [
  '[jsname="tgaKEf"]',             // live caption text node (most recent observed)
  '[data-message-text]',           // speaker message container (older Meet)
];

const CAPTION_SPEAKER_SELECTORS = [
  '[jsname="YSxPC"]',              // speaker name node
  '[data-sender-name]',            // older Meet speaker attribute
];

// ---------------------------------------------------------------------------
// Caption buffer
// ---------------------------------------------------------------------------

const WORDS_PER_MS = 1 / 400; // ~400ms per spoken word (approx 150wpm)
const FLUSH_AFTER_SILENCE_MS = 3500;
const SENTENCE_BOUNDARY = /[.!?](?:\s|$)/;

/**
 * Accumulates raw caption text and flushes discrete TranscriptChunks when:
 * - A sentence boundary is detected
 * - The speaker changes
 * - No new text has arrived for FLUSH_AFTER_SILENCE_MS
 */
class MeetCaptionBuffer {
  private text = '';
  private startMs = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSpeaker = '';
  private readonly sessionStartMs: number;
  private readonly onChunk: (chunk: TranscriptChunk) => void;

  constructor(sessionStartMs: number, onChunk: (chunk: TranscriptChunk) => void) {
    this.sessionStartMs = sessionStartMs;
    this.onChunk = onChunk;
  }

  append(text: string, speaker: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Speaker change → flush what we have before starting a new utterance
    if (speaker && speaker !== this.lastSpeaker && this.text) {
      this.flush();
    }
    this.lastSpeaker = speaker;

    if (!this.text) {
      // First text in a new chunk — record the wall-clock start
      this.startMs = Date.now() - this.sessionStartMs;
    }

    this.text += (this.text ? ' ' : '') + trimmed;

    // Sentence boundary → flush immediately
    if (SENTENCE_BOUNDARY.test(this.text)) {
      this.flush();
      return;
    }

    // Reset the silence timer
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_AFTER_SILENCE_MS);
  }

  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.text) return;

    const wordCount = this.text.split(/\s+/).length;
    const durationMs = Math.max(wordCount / WORDS_PER_MS, 500);

    this.onChunk({ text: this.text, startMs: this.startMs, durationMs });
    this.text = '';
    this.startMs = 0;
  }

  stop(): void {
    this.flush();
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// DOM reader
// ---------------------------------------------------------------------------

/** Finds the first DOM node matching any of the given selectors */
const queryFirst = (selectors: string[]): Element | null => {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
};

/** Returns all nodes matching any of the given selectors */
const queryAll = (selectors: string[]): Element[] => {
  for (const sel of selectors) {
    const nodes = Array.from(document.querySelectorAll(sel));
    if (nodes.length) return nodes;
  }
  return [];
};

/**
 * Known Google Meet system notification strings that appear in caption containers
 * but are not actual speech. Matched case-insensitively against the full text.
 */
const MEET_SYSTEM_NOISE_RE = /^(your microphone is (on|off|muted)|you('re| are) (muted|unmuted)|someone (joined|left)|you (joined|left)|caption(s are| is) (on|off)|presenting now|you are presenting|stop presenting|turn on captions)/i;

const readCaptionText = (): string => {
  const text = queryAll(CAPTION_TEXT_SELECTORS)
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  return MEET_SYSTEM_NOISE_RE.test(text) ? '' : text;
};

const readSpeakerName = (): string =>
  queryFirst(CAPTION_SPEAKER_SELECTORS)?.textContent?.trim() ?? '';

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const meetAdapter: TranscriptAdapter = {
  sourceType: 'meet',
  visibility: 'private',

  canHandle(location: Location): boolean {
    return (
      location.hostname === 'meet.google.com' &&
      MEET_CALL_PATH.test(location.pathname)
    );
  },

  getVideoId(location: Location): string | null {
    return extractMeetingCode(location.pathname);
  },

  buildSourceContext(sourceId: string, sourceLabel: string): TranscriptSourceContext {
    return {
      type: 'meet',
      visibility: 'private',
      sourceId,
      sourceLabel,
    };
  },

  extractMetadata(_doc: Document): { title: string; channel: string } {
    // Meet sets the page title to the meeting name when in-call.
    // Strip the generic "Google Meet | " prefix if present.
    const raw = document.title.replace(/^Google Meet\s*[\|–-]\s*/i, '').trim();
    const title = raw || 'Google Meet';
    return { title, channel: 'Google Meet' };
  },

  // Meet has no pre-existing transcript to fetch. The live path uses
  // startLiveCapture instead. Return null so the orchestrator skips
  // the static-fetch retry loop for this adapter.
  extractTranscript(): Promise<null> {
    return Promise.resolve(null);
  },

  startLiveCapture(
    _meetingId: string,
    signal: AbortSignal,
    onChunk: (chunk: TranscriptChunk) => void,
  ): void {
    const sessionStartMs = Date.now();
    const buffer = new MeetCaptionBuffer(sessionStartMs, onChunk);

    let lastSeenText = '';

    const observer = new MutationObserver(() => {
      const text = readCaptionText();
      if (!text || text === lastSeenText) return;

      // Compute the delta so we only append new words to the buffer.
      // Meet incrementally grows the current utterance in-place (e.g.
      // "The quick" → "The quick brown fox"), so appending the full text
      // on every mutation would duplicate every word already accumulated.
      // If the new text is a strict extension of what we last saw, strip the
      // prefix and only hand the new suffix to the buffer.  If the caption
      // region was cleared / replaced entirely (speaker change, sentence end)
      // pass the full new text so the buffer can flush the previous chunk.
      const delta = lastSeenText && text.startsWith(lastSeenText)
        ? text.slice(lastSeenText.length).trim()
        : text;

      lastSeenText = text;
      if (!delta) return;
      buffer.append(delta, readSpeakerName());
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    signal.addEventListener('abort', () => {
      observer.disconnect();
      buffer.stop();
    }, { once: true });
  },
};
