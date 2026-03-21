import { describe, expect, it } from 'vitest';

import {
  DISTANCE,
  getPressSettle,
  noticeArrival,
  noticeArrivalReduced,
  pressSettle,
  SOFT_SPRING,
} from '../../src/sidepanel/styles/motionTokens';

describe('motion tokens', () => {
  it('preserves the SourceCheck signature easing', () => {
    expect(SOFT_SPRING).toEqual([0.16, 1, 0.3, 1]);
  });

  it('disables press feedback when reduced motion is preferred', () => {
    expect(getPressSettle(true)).toBeUndefined();
    expect(getPressSettle(null)).toEqual(pressSettle);
    expect(getPressSettle(false)).toEqual(pressSettle);
  });

  it('keeps the press settle motion subtle', () => {
    expect(pressSettle.scale).toBe(DISTANCE.pressScale);
    expect(pressSettle.scale).toBeGreaterThan(0.99);
  });

  it('uses separate notice arrivals for standard and reduced motion', () => {
    expect(noticeArrival.initial).toHaveProperty('x', 12);
    expect(noticeArrivalReduced.initial).toEqual({ opacity: 0 });
  });
});
