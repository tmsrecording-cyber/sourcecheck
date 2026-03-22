/**
 * Motion Tokens for SourceCheck Sidepanel
 * 
 * This module provides a shared motion language for the sidepanel.
 * It preserves the SourceCheck "soft spring" feel while providing
 * consistent, tokenized motion patterns.
 * 
 * Philosophy:
 * - Productive motion for microinteractions (short, weighted, local)
 * - Expressive motion reserved for genuine milestones
 * - Reduced motion respected throughout
 * - The SourceCheck soft spring `[0.16, 1, 0.3, 1]` is the signature feel
 */

import type { Transition, Variants } from 'framer-motion';

// =============================================================================
// EASINGS
// =============================================================================

/**
 * SourceCheck signature soft spring easing.
 * This is the primary feel for the sidepanel - weighted but not snappy.
 */
export const SOFT_SPRING: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Carbon-inspired productive easings.
 * Used when a snappier, more immediate feel is needed.
 */
export const PRODUCTIVE = {
  standard: [0.2, 0, 0.38, 0.9] as [number, number, number, number],
  enter: [0, 0, 0.38, 0.9] as [number, number, number, number],
  exit: [0.2, 0, 1, 0.9] as [number, number, number, number],
} as const;

/** Quick ease for small state changes */
export const QUICK_EASE: [number, number, number, number] = [0.4, 0, 1, 1];

// =============================================================================
// DURATIONS (in seconds, matching Framer Motion conventions)
// =============================================================================

export const DURATION = {
  /** 70ms - Micro interactions, color changes */
  fast01: 0.07,
  /** 120ms - Fast feedback, hover states */
  fast02: 0.12,
  /** 220ms - Compact expand/collapse, small reveals */
  micro: 0.22,
  /** 280ms - Standard component transitions */
  standard: 0.28,
  /** 340ms - Card entry, layout shifts */
  layout: 0.34,
  /** 420ms - Hero card entry — deliberate milestone moment */
  heroEnter: 0.42,
  /** 460ms - Stack entry, staggered items */
  enter: 0.46,
  /** 380ms - Tab transitions */
  tab: 0.38,
  /** 560ms - Ask response arrival (most deliberate) */
  expressive: 0.56,
} as const;

// =============================================================================
// DISTANCES
// =============================================================================

export const DISTANCE = {
  /** Subtle lift for card hover (-1px) */
  liftY: -1,
  /** Stronger lift for emphasis (-2px) */
  liftYStrong: -2,
  /** Entry slide distance (14px) */
  enterY: 14,
  /** Exit slide distance (-10px) */
  exitY: -10,
  /** Subtle scale for card hover (1.006) */
  hoverScale: 1.006,
  /** Subtle scale for compact card hover (1.003) */
  hoverScaleCompact: 1.003,
  /** Press settle scale (0.996) */
  pressScale: 0.996,
  /** Stagger step delay (50ms) */
  staggerStep: 0.05,
  /** Max stagger items */
  staggerCap: 4,
} as const;

// =============================================================================
// SEMANTIC MOTION PRESETS
// =============================================================================

/**
 * State transition preset for cross-phase fades (scanning→checking→resolved→docked).
 */
export const stateTransition: Transition = {
  duration: DURATION.standard,
  ease: SOFT_SPRING,
};

/**
 * Hover lift configuration for interactive cards.
 * Used by: FeedCard, compact cards
 */
export const hoverLift = {
  y: DISTANCE.liftY,
  scale: DISTANCE.hoverScale,
  transition: {
    duration: DURATION.fast02,
    ease: SOFT_SPRING,
  },
};

/** Compact variant with subtler scale */
export const hoverLiftCompact = {
  y: DISTANCE.liftY,
  scale: DISTANCE.hoverScaleCompact,
  transition: {
    duration: DURATION.fast02,
    ease: SOFT_SPRING,
  },
};

/**
 * Press settle configuration.
 * Used by: all interactive surfaces
 */
export const pressSettle = {
  scale: DISTANCE.pressScale,
  transition: {
    duration: DURATION.fast01,
    ease: QUICK_EASE,
  },
};

/**
 * Stack entry variants for staggered list items.
 * Used by: CardFeed older cards list
 */
export const stackEntryVariants: Variants = {
  hidden: {
    opacity: 0,
    y: -10,
    rotateX: -18,
    transformPerspective: 1200,
    transformOrigin: 'top center',
  },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: {
      duration: DURATION.enter,
      delay: Math.min(index, DISTANCE.staggerCap) * DISTANCE.staggerStep,
      ease: SOFT_SPRING,
    },
  }),
  exit: {
    opacity: 0,
    y: DISTANCE.exitY,
    transition: {
      duration: DURATION.standard,
      ease: QUICK_EASE,
    },
  },
};

/**
 * Stack entry variants for reduced motion.
 * Removes 3D rotation, keeps fade and subtle slide.
 */
export const stackEntryVariantsReduced: Variants = {
  hidden: {
    opacity: 0,
    y: -4,
  },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: DURATION.micro,
      delay: Math.min(index, DISTANCE.staggerCap) * DISTANCE.staggerStep,
    },
  }),
  exit: {
    opacity: 0,
    transition: {
      duration: DURATION.fast01,
    },
  },
};

/**
 * Notice arrival configuration.
 * Used by: NoticeStack
 */
export const noticeArrival = {
  initial: { opacity: 0, x: 12, scale: 0.985 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: 10, scale: 0.985 },
  transition: {
    duration: DURATION.standard,
    ease: SOFT_SPRING,
  },
};

/** Notice arrival for reduced motion */
export const noticeArrivalReduced = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: {
    duration: DURATION.micro,
  },
};

/**
 * Ask response entry animation.
 * Used by: AskResponseCard
 */
export const askResponseEntry = {
  initial: { opacity: 0, y: 12, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: {
    duration: DURATION.expressive,
    ease: SOFT_SPRING,
  },
};

/** Ask response entry for reduced motion */
export const askResponseEntryReduced = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: {
    duration: DURATION.micro,
  },
};

/**
 * Hero card entry animation.
 * Used by: CardFeed hero slot
 */
export const heroCardEntry = {
  initial: { y: DISTANCE.enterY, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -12, opacity: 0 },
  transition: {
    duration: DURATION.heroEnter,
    ease: SOFT_SPRING,
  },
};

/**
 * Conveyor entry — new cards arrive at top of feed and slide down into position.
 * Existing cards shift down via `layout` animation.
 */
export const conveyorEntry = {
  initial: { y: -14, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 8, opacity: 0, scale: 0.96 },
  transition: {
    duration: DURATION.heroEnter,
    ease: SOFT_SPRING,
    layout: { duration: DURATION.layout, ease: SOFT_SPRING },
  },
};

/**
 * Hero resolved card entry (slightly longer for emphasis).
 */
export const heroResolvedEntry = {
  initial: { y: DISTANCE.enterY, opacity: 0, scale: 0.97 },
  animate: { y: 0, opacity: 1, scale: 1 },
  // Exit: settle downward into the stack, slight scale-down, fade
  exit: { y: 12, scale: 0.95, opacity: 0 },
  transition: {
    duration: DURATION.expressive,
    ease: [0.22, 1, 0.36, 1], // custom cubic: fast settle, overshoot-free
  },
};

/**
 * Compact expand/collapse configuration.
 * Used by: FeedCard compact mode
 */
export const expandReveal = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: {
    duration: DURATION.micro,
    ease: SOFT_SPRING,
  },
};

/**
 * Chevron rotation for expand/collapse indicators.
 */
export const chevronRotate = {
  transition: {
    duration: DURATION.standard,
    ease: SOFT_SPRING,
  },
};

// =============================================================================
// UTILITY HELPERS
// =============================================================================

/**
 * Get the appropriate stack entry variants based on reduced motion preference.
 */
export function getStackEntryVariants(prefersReducedMotion: boolean | null): Variants {
  return prefersReducedMotion ? stackEntryVariantsReduced : stackEntryVariants;
}

/**
 * Get notice arrival configuration based on reduced motion preference.
 */
export function getNoticeArrival(prefersReducedMotion: boolean | null) {
  return prefersReducedMotion ? noticeArrivalReduced : noticeArrival;
}

/**
 * Get ask response entry configuration based on reduced motion preference.
 */
export function getAskResponseEntry(prefersReducedMotion: boolean | null) {
  return prefersReducedMotion ? askResponseEntryReduced : askResponseEntry;
}

/**
 * Create a transition object with the SourceCheck soft spring.
 */
export function createSoftSpringTransition(duration: number): Transition {
  return {
    duration,
    ease: SOFT_SPRING,
  };
}

/**
 * Reduced motion safe hover configuration.
 * Returns undefined if reduced motion is preferred.
 */
export function getHoverLift(
  prefersReducedMotion: boolean | null,
  isCompact: boolean = false
) {
  if (prefersReducedMotion) return undefined;
  return isCompact ? hoverLiftCompact : hoverLift;
}

/**
 * Reduced motion safe press configuration.
 * Returns undefined if reduced motion is preferred.
 */
export function getPressSettle(prefersReducedMotion: boolean | null) {
  if (prefersReducedMotion) return undefined;
  return pressSettle;
}
