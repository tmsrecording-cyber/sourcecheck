import { describe, expect, it } from 'vitest';

import { getLiveNoHeroCardMode, getLiveStripMode } from '../../src/sidepanel/components/CardFeed';
import type { AnalysisStatus } from '../../shared/types';

const resolveMode = ({
  activeTab = 'live',
  status,
  hasCheckedCard = false,
  hasPendingClaim = false,
  hasScanSignal = false,
}: {
  activeTab?: 'live' | 'history';
  status: AnalysisStatus;
  hasCheckedCard?: boolean;
  hasPendingClaim?: boolean;
  hasScanSignal?: boolean;
}) =>
  getLiveStripMode({
    activeTab,
    status,
    hasCheckedCard,
    hasPendingClaim,
    hasScanSignal,
  });

describe('live strip mode', () => {
  it('uses watching mode whenever the live feed is caught up', () => {
    expect(resolveMode({ status: 'ready' })).toBe('watching');
    expect(resolveMode({ status: 'ready', hasCheckedCard: true })).toBe('watching');
  });

  it('uses primary mode while monitoring with no completed card yet', () => {
    expect(resolveMode({ status: 'monitoring', hasScanSignal: true })).toBe('primary');
  });

  it('uses forming mode while monitoring after a card already exists', () => {
    expect(resolveMode({ status: 'monitoring', hasCheckedCard: true, hasScanSignal: true })).toBe('forming');
  });

  it('suppresses the strip while a claim is actively verifying', () => {
    expect(resolveMode({ status: 'verifying', hasPendingClaim: true, hasScanSignal: true })).toBeNull();
  });

  it('never shows a live strip in history mode', () => {
    expect(resolveMode({ activeTab: 'history', status: 'ready', hasCheckedCard: true })).toBeNull();
  });
});

describe('live no-hero card mode', () => {
  it('uses a single scanning card path while monitoring with live preview', () => {
    expect(
      getLiveNoHeroCardMode({
        activeTab: 'live',
        effectiveHeroMode: 'none',
        status: 'monitoring',
        liveStripMode: 'primary',
      })
    ).toBe('scanning');
  });

  it('uses the same single scanning card path while caught up and watching', () => {
    expect(
      getLiveNoHeroCardMode({
        activeTab: 'live',
        effectiveHeroMode: 'none',
        status: 'ready',
        liveStripMode: 'watching',
      })
    ).toBe('scanning');
  });

  it('never renders a no-hero card while the hero slot is occupied', () => {
    expect(
      getLiveNoHeroCardMode({
        activeTab: 'live',
        effectiveHeroMode: 'checked',
        status: 'monitoring',
        liveStripMode: 'forming',
      })
    ).toBe('none');
  });
});
