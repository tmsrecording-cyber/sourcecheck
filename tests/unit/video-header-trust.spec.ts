import { describe, expect, it } from 'vitest';

import type { SourceCard } from '../../shared/types';
import {
  buildVerificationSummary,
} from '../../src/sidepanel/components/VideoHeader';
import { buildLiveStripCopy } from '../../src/sidepanel/hooks/useLiveStageFlow';

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
    expect(summary?.text).toBe('Supported 1 · Mixed 1 · Unsupported 1 · Unverifiable 1');
    expect(summary?.total).toBe(4);
  });

  it('preserves zero-count buckets in the summary text', () => {
    const summary = buildVerificationSummary([makeCard('1', 'supported')]);

    expect(summary?.text).toBe('Supported 1 · Mixed 0 · Unsupported 0 · Unverifiable 0');
    expect(summary?.total).toBe(1);
  });

  it('returns null when there are no cards', () => {
    expect(buildVerificationSummary([])).toBeNull();
  });

  describe('buildLiveStripCopy', () => {
    it('returns null while the live surface itself is carrying the story', () => {
      expect(buildLiveStripCopy({ status: 'monitoring', livePhase: 'reading', anchorTime: null })).toBeNull();
    });

    it('returns null while checking so the top card stays the source of truth', () => {
      expect(buildLiveStripCopy({ status: 'verifying', livePhase: 'checking', anchorTime: 125 })).toBeNull();
      expect(buildLiveStripCopy({ status: 'verifying', livePhase: 'checking', anchorTime: null })).toBeNull();
    });

    it('returns null while a resolved card is still docking', () => {
      expect(buildLiveStripCopy({ status: 'ready', livePhase: 'resolved', anchorTime: 140, isDocking: true })).toBeNull();
    });

    it('returns Caught up only for true idle state', () => {
      expect(buildLiveStripCopy({ status: 'ready', livePhase: 'idle', anchorTime: null })).toBe('Caught up');
    });

    it('returns Loading transcript for loading status', () => {
      expect(buildLiveStripCopy({ status: 'loading', livePhase: 'idle', anchorTime: null })).toBe('Loading transcript');
    });

    it('returns null for no-transcript and error statuses', () => {
      expect(buildLiveStripCopy({ status: 'no-transcript', livePhase: 'idle', anchorTime: null })).toBeNull();
      expect(buildLiveStripCopy({ status: 'error', livePhase: 'idle', anchorTime: null })).toBeNull();
    });
  });
});
