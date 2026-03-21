import { describe, expect, it } from 'vitest';

import type { SourceCard } from '../../shared/types';
import {
  buildHeaderAnchorCopy,
  buildStatusLineCopy,
  buildVerificationSummary,
  resolveVideoHeaderStatus,
} from '../../src/sidepanel/components/VideoHeader';

const makeCard = (
  id: string,
  status: SourceCard['status'],
): SourceCard => ({
  id,
  claim: {
    id: `claim-${id}`,
    claimText: `Claim ${id}`,
    claimType: 'historical',
    exactQuote: `Claim ${id}`,
    timestampSeconds: 10,
    confidence: 0.9,
  },
  status,
  sourceTitle: `Source ${id}`,
  sourceUrl: `https://example.com/${id}`,
  sourceType: 'news_article',
  nuance: `Nuance ${id}`,
  timestampSeconds: 10,
  verifiedAt: '2026-03-20T00:00:00.000Z',
});

describe('video header trust helpers', () => {
  it('builds a four-bucket verification summary in the exact order', () => {
    const summary = buildVerificationSummary([
      makeCard('1', 'supported'),
      makeCard('2', 'partial'),
      makeCard('3', 'disputed'),
      makeCard('4', 'unverifiable'),
    ]);

    expect(summary).not.toBeNull();
    expect(summary?.text).toBe('Supported 1 • Mixed 1 • Unsupported 1 • Unverifiable 1');
    expect(summary?.total).toBe(4);
  });

  it('preserves zero-count buckets in the summary text', () => {
    const summary = buildVerificationSummary([makeCard('1', 'supported')]);

    expect(summary?.text).toBe('Supported 1 • Mixed 0 • Unsupported 0 • Unverifiable 0');
    expect(summary?.total).toBe(1);
  });

  it('returns null when there are no cards', () => {
    expect(buildVerificationSummary([])).toBeNull();
  });

  it('uses "Checking at" for monitoring and verifying with a time', () => {
    expect(buildHeaderAnchorCopy('monitoring', 125)).toBe('Checking at 2:05');
    expect(buildHeaderAnchorCopy('verifying', 125)).toBe('Checking at 2:05');
  });

  it('uses "Checking now" for active states without a time', () => {
    expect(buildHeaderAnchorCopy('monitoring', null)).toBe('Checking now');
    expect(buildHeaderAnchorCopy('verifying', null)).toBe('Checking now');
  });

  it('uses "Last checked at" for ready with time', () => {
    expect(buildHeaderAnchorCopy('ready', 125)).toBe('Last checked at 2:05');
  });

  it('uses exact anchor copy for no-transcript, loading, error, idle, and ready without time', () => {
    expect(buildHeaderAnchorCopy('no-transcript', null)).toBe('Transcript unavailable');
    expect(buildHeaderAnchorCopy('loading', null)).toBe('Preparing transcript');
    expect(buildHeaderAnchorCopy('error', null)).toBe('Could not verify right now');
    expect(buildHeaderAnchorCopy('idle', null)).toBe('Waiting for video');
    expect(buildHeaderAnchorCopy('ready', null)).toBe('Caught up');
  });

  it('matches the exact status-line copy', () => {
    expect(buildStatusLineCopy('monitoring', true)).toBe('Listening for checkable claims.');
    expect(buildStatusLineCopy('monitoring', false)).toBe('Waiting for a claim worth checking.');
    expect(buildStatusLineCopy('verifying', true)).toBe('Checking the latest claim.');
    expect(buildStatusLineCopy('ready', true)).toBe('Checks are up to date.');
    expect(buildStatusLineCopy('loading', false)).toBe('Loading transcript.');
    expect(buildStatusLineCopy('no-transcript', false)).toBe('No usable captions were found for this video.');
    expect(buildStatusLineCopy('error', true)).toBe('Something interrupted verification. Try refreshing the page.');
    expect(buildStatusLineCopy('idle', true)).toBeNull();
  });

  it('keeps resolved hero dwell on a calm ready status instead of forcing verifying', () => {
    expect(
      resolveVideoHeaderStatus('verifying', {
        mode: 'resolved',
        card: makeCard('resolved', 'unverifiable'),
        dwellUntil: Date.now() + 1500,
      }),
    ).toBe('ready');
  });

  it('keeps verifying status when the promoted hero is actively verifying', () => {
    expect(
      resolveVideoHeaderStatus('ready', {
        mode: 'verifying',
        claimText: 'Claim in flight',
        timestampSeconds: 42,
      }),
    ).toBe('verifying');
  });
});
