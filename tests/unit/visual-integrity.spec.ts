/**
 * Visual Integrity Lock
 *
 * Guards the design system rules that were deliberately established and must not
 * silently regress. Each assertion documents *why* the rule exists so future
 * engineers understand what they are changing if they touch these files.
 *
 * Failures here mean a visual regression, not a logic bug — investigate before
 * reverting. Update the test only when the design is intentionally changed.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const CSS_PATH = resolve(__dirname, '../../src/sidepanel/styles/globals.css');
const FEED_CARD_PATH = resolve(__dirname, '../../src/sidepanel/components/FeedCard.tsx');

const css = readFileSync(CSS_PATH, 'utf8');
const feedCard = readFileSync(FEED_CARD_PATH, 'utf8');

// ── Verifying card ─────────────────────────────────────────────────────────
// The verifying card shows an elapsed time counter (honest, real signal)
// instead of a fake step trace. No decorative fake progress steps.

describe('verifying operation trace', () => {
  it('verifying card uses elapsed timer, not fake step trace', () => {
    expect(feedCard).toContain('elapsed');
    expect(feedCard).toContain('status-badge-live');
    expect(feedCard).not.toContain('verify-trace-step');
    expect(feedCard).not.toContain('verifying-pips');
    expect(feedCard).not.toContain('verifying-nodes');
  });
});

// ── Rail line: model color + scan animation ────────────────────────────────
// The vertical left rail uses the selected model's accent colour throughout,
// making it a live indicator of which model is running. Scanning cards get
// a travelling bright segment (railScanFlow). Verifying cards get a strong
// static glow that pulses. Hero/state cards use the verdict colour inline.

describe('rail line model color', () => {
  it('scanning rail class uses model-accent-rgb CSS variable', () => {
    const block = css.match(/\.rail-line-scan\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('model-accent-rgb');
  });

  it('scanning rail has the railScanFlow animation', () => {
    const block = css.match(/\.rail-line-scan\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('railScanFlow');
  });

  it('verifying rail class uses model-accent-rgb CSS variable', () => {
    const block = css.match(/\.rail-line-verify\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('model-accent-rgb');
  });

  it('live-tab-rail background thread is the single spine (no per-card rail-line rendered)', () => {
    // Architecture: live-tab-rail::before is the sole vertical line.
    // Per-card rail-line spans were removed to eliminate the double-line artifact.
    // The CSS classes still exist (for possible future use) but FeedCard does not render them.
    expect(feedCard).not.toContain("rail-line-scan");
    expect(feedCard).not.toContain("rail-line-verify");
    // The background thread lives in CSS
    expect(css).toContain('live-tab-rail::before');
    expect(css).toContain('railScanFlow');
  });

  it('base rail-line has no hardcoded opacity that would suppress the colour', () => {
    // The old opacity: 0.3 was killing the rail visibility.
    // Gradient stops must control transparency, not a blanket opacity.
    const railBlock = css.match(/^\.rail-line\s*\{[^}]+\}/ms)?.[0] ?? '';
    expect(railBlock).not.toContain('opacity: 0.3');
  });
});

// ── Verdict-tinted card hover glow ────────────────────────────────────────
// Hero cards gain a status-coloured border glow on hover so the verdict
// is communicated through colour before the user reads the text.

describe('verdict-tinted card hover glow', () => {
  it('applies supported-coloured hover glow', () => {
    const block = css.match(/\.feed-card\[data-status="supported"\]:hover\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-supported-rgb');
  });

  it('applies partial-coloured hover glow', () => {
    const block = css.match(/\.feed-card\[data-status="partial"\]:hover\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-partial-rgb');
  });

  it('applies disputed-coloured hover glow', () => {
    const block = css.match(/\.feed-card\[data-status="disputed"\]:hover\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-disputed-rgb');
  });

  it('applies neutral hover glow for unverifiable', () => {
    const block = css.match(/\.feed-card\[data-status="unverifiable"\]:hover\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-neutral-rgb');
  });
});

// ── Status icon character ──────────────────────────────────────────────────
// Each verdict icon must carry deliberate visual meaning:
//   supported  — heavier checkmark (strokeWidth ≥ 2)
//   partial    — two offset parallel lines (mixed-signal metaphor)
//   disputed   — bold X
//   unverifiable — dashed circle + slash (null/void symbol, not a plain dot)

describe('status icon visual character', () => {
  it('partial icon has two path elements (two offset lines)', () => {
    // Two separate <path> elements inside the partial icon svg
    const partialBlock = feedCard.match(/partial:\s*\(\s*<svg[^>]*>[\s\S]*?<\/svg>\s*\)/)?.[0] ?? '';
    const pathCount = (partialBlock.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(2);
  });

  it('unverifiable icon has a circle and a slash, not just a filled dot', () => {
    const uvBlock = feedCard.match(/unverifiable:\s*\(\s*<svg[^>]*>[\s\S]*?<\/svg>\s*\)/)?.[0] ?? '';
    // Must have a circle element (the dashed ring)
    expect(uvBlock).toContain('<circle');
    // Must have a path element (the diagonal slash)
    expect(uvBlock).toContain('<path');
    // Must NOT be a plain filled circle (fill="currentColor" with no stroke)
    expect(uvBlock).not.toMatch(/<circle[^>]+fill="currentColor"[^>]*\/>/);
  });

  it('supported icon uses a heavier stroke than the old baseline', () => {
    const supportedBlock = feedCard.match(/supported:\s*\(\s*<svg[^>]*>[\s\S]*?<\/svg>\s*\)/)?.[0] ?? '';
    const swMatch = supportedBlock.match(/strokeWidth=\{([^}]+)\}/);
    // sw is a variable (sw), not a literal — check that sw is derived from size
    // and the formula yields ≥ 2 for normal size
    expect(supportedBlock).toContain('strokeWidth={sw}');
    // Verify sw is defined as ≥ 2 for normal size
    expect(feedCard).toMatch(/const sw = size === 'small' \? 1\.\d+ : 2\.\d+/);
  });
});

// ── Scanning card hover ────────────────────────────────────────────────────
// The scanning card participates in hover lift like hero/verifying cards.
// It uses the compact (subtler) lift preset since it is not tappable.

describe('scanning card hover', () => {
  it('scanning size is not classified as a passive card', () => {
    // isPassiveCard must not include 'scanning'
    const passiveCardLine = feedCard.match(/const isPassiveCard = [^;]+;/)?.[0] ?? '';
    expect(passiveCardLine).not.toContain("'scanning'");
  });

  it('scanning card gets the compact hover lift preset', () => {
    // The whileHover branch must route scanning to hoverLiftCompact
    const hoverBlock = feedCard.match(/whileHover=\{[\s\S]*?whileTap=/)?.[0] ?? '';
    expect(hoverBlock).toContain('isScanning');
    expect(hoverBlock).toContain('hoverLiftCompact');
  });
});

// ── Adversarial pipeline always on ────────────────────────────────────────
// Model picker was removed — adversarial (advocate + challenger) verification
// is always used. No UI toggle exists. Locks against re-introducing a toggle.

describe('adversarial pipeline always on', () => {
  it('ModelPicker component does not exist', () => {
    const { existsSync } = require('fs');
    const pickerPath = resolve(__dirname, '../../src/sidepanel/components/ModelPicker.tsx');
    expect(existsSync(pickerPath)).toBe(false);
  });

  it('FeedCard does not reference ModelPicker', () => {
    expect(feedCard).not.toContain('ModelPicker');
  });

  it('FeedCard contains adversarial strip with FOR and AGAINST agents', () => {
    expect(feedCard).toContain('adversarial-strip');
    expect(feedCard).toContain('adversarial-node-for');
    expect(feedCard).toContain('adversarial-node-against');
    expect(feedCard).toContain('adversarial-agent-label-for');
    expect(feedCard).toContain('adversarial-agent-label-against');
  });

  it('adversarial strip CSS defines both FOR and AGAINST node colours', () => {
    expect(css).toContain('.adversarial-node-for');
    expect(css).toContain('.adversarial-node-against');
  });
});

// ── Adversarial strip: no clipping ────────────────────────────────────────
// The strip must NOT have overflow:hidden — that was clipping the FOR dot's
// pulse animation at the left edge of the card.

describe('adversarial strip overflow', () => {
  it('adversarial-strip does not have overflow: hidden', () => {
    const block = css.match(/\.adversarial-strip\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).not.toContain('overflow: hidden');
    expect(block).not.toContain('overflow:hidden');
  });
});

// ── Live stage shell: hover-safe overflow ─────────────────────────────────
// The live-stage-shell must NOT use overflow:hidden — that was clipping the
// card's top border/glow when the hover-lift translateY(-2px) animation fired.

describe('live stage shell overflow', () => {
  it('live-stage-shell does not clip with overflow: hidden', () => {
    const block = css.match(/\.live-stage-shell\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).not.toContain('overflow: hidden');
    expect(block).not.toContain('overflow:hidden');
  });
});

// ── Debate block: FOR / AGAINST expansion ─────────────────────────────────
// When advocate and challenger return distinct findings, the expanded compact
// card shows a FOR / AGAINST block. Both sides must be styled independently.

describe('debate block visual structure', () => {
  it('CSS defines debate-block container', () => {
    expect(css).toContain('.debate-block');
  });

  it('CSS defines distinct tints for FOR and AGAINST sides', () => {
    const forBlock = css.match(/\.debate-side-for\s*\{[^}]+\}/s)?.[0] ?? '';
    const againstBlock = css.match(/\.debate-side-against\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(forBlock).toBeTruthy();
    expect(againstBlock).toBeTruthy();
    // FOR uses teal; AGAINST uses steel-blue — must be different colours
    expect(forBlock).not.toEqual(againstBlock);
  });

  it('FeedCard renders debate block when both nuance fields are present', () => {
    expect(feedCard).toContain('advocateNuance');
    expect(feedCard).toContain('challengerNuance');
    expect(feedCard).toContain('debate-block');
  });
});

// ── Rail data-stream direction ─────────────────────────────────────────────
// The rail scan flow keyframe must travel downward (positive Y) to match
// the natural top-to-bottom timeline reading direction.

describe('rail data-stream direction', () => {
  it('railScanFlow keyframe uses positive Y (downward flow)', () => {
    // The 100% stop must end at a positive Y position — negative Y means upward.
    // Extract the @keyframes railScanFlow block by finding its 100% stop.
    const idx = css.indexOf('@keyframes railScanFlow');
    const block = idx >= 0 ? css.slice(idx, idx + 300) : '';
    // "0 112px" = downward travel endpoint. Must exist; "-112px" must not.
    expect(block).toContain('112px');
    expect(block).not.toContain('-112px');
  });
});

// ── Seen-before memory badge ───────────────────────────────────────────────
// The memory badge is metadata, not live state. It must stay semantically
// stable and must not inherit the current model accent or verdict colour.

describe('seen-before memory badge', () => {
  it('compact memory chip does not use model-accent-rgb', () => {
    const block = css.match(/\.compact-memory-chip\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).not.toContain('model-accent-rgb');
  });

  it('compact memory chip uses neutral surface and border tokens', () => {
    const block = css.match(/\.compact-memory-chip\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-border-rgb');
    expect(block).toContain('sc-surface-1-rgb');
    expect(block).toContain('sc-surface-0-rgb');
  });
});

// ── M6: Scanning card activity pulse bar ─────────────────────────────────
// The scanning card uses animated pulse bars to visualize data-stream activity.
// Each bar represents a segment being processed. This is the "alive" signal.

describe('scanning card activity visualization', () => {
  it('FeedCard contains ScanPulseBar component with pulse segments', () => {
    expect(feedCard).toContain('scan-pulse-bar');
    expect(feedCard).toContain('scan-pulse-segment');
  });

  it('CSS defines scanPulseWave keyframe animation', () => {
    expect(css).toContain('@keyframes scanPulseWave');
    expect(css).toContain('.scan-pulse-segment');
  });

  it('scanPulseWave uses scaleY (compositor-only) not height (layout-triggering)', () => {
    const keyframeBlock = css.match(/@keyframes scanPulseWave\s*\{[^}]+\}/s)?.[0] ?? '';
    // Must use transform: scaleY — height animation triggers layout + paint on every frame
    expect(keyframeBlock).toContain('scaleY');
    expect(keyframeBlock).not.toMatch(/\bheight\b/);
  });

  it('pulse bar has an active variant for VERIFYING state', () => {
    expect(css).toContain('.scan-pulse-bar-active');
    expect(feedCard).toContain('scan-pulse-bar-active');
  });
});

// ── M6: Verdict-tinted compact card backgrounds ──────────────────────────
// Compact cards carry a subtle background tint from their verdict colour.
// This creates a colour-coded hierarchy when scanning multiple cards.

describe('verdict-tinted compact card backgrounds', () => {
  it('supported compact cards have a green-tinted background', () => {
    const block = css.match(/\.feed-card-compact\[data-status="supported"\]\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-supported-rgb');
  });

  it('partial compact cards have a yellow-tinted background', () => {
    const block = css.match(/\.feed-card-compact\[data-status="partial"\]\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-partial-rgb');
  });

  it('disputed compact cards have a red-tinted background', () => {
    const block = css.match(/\.feed-card-compact\[data-status="disputed"\]\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('sc-disputed-rgb');
  });
});

// ── M6: Section label structural anchoring ───────────────────────────────
// Section labels ("Live Check", "Recent checks") have a horizontal rule
// prefix that visually connects them to the rail system.

describe('section label anchoring', () => {
  it('CSS defines stage-section-rule structural element', () => {
    const block = css.match(/\.stage-section-rule\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('width');
    expect(block).toContain('height');
  });

  it('CSS defines stage-section-row flex container', () => {
    const block = css.match(/\.stage-section-row\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('display');
    expect(block).toContain('flex');
  });
});

// ── M6: Ambient heartbeat animation ──────────────────────────────────────
// The idle/waiting state shows a breathing heartbeat animation so the panel
// never looks dead when monitoring is active but no claim is being checked.

describe('ambient heartbeat animation', () => {
  it('CSS defines ambientHeartbeat keyframe', () => {
    expect(css).toContain('@keyframes ambientHeartbeat');
  });

  it('CSS defines animate-heartbeat utility class', () => {
    expect(css).toContain('.animate-heartbeat');
  });
});

// ── M6: Rail node baseline glow ──────────────────────────────────────────
// All rail nodes have a subtle baseline glow so they are visible on the
// dark background without requiring the glow variant.

describe('rail node visibility', () => {
  it('rail nodes scale on card hover', () => {
    expect(css).toContain('.feed-card-wrapper:hover .rail-node');
    // B4: Updated to 1.2x scale (was 1.15) for more visible hover feedback
    expect(css).toContain('scale(1.2)');
  });

  it('verifying card rail node has expanding ring pulse', () => {
    // B4: Active verification communicated via expanding ring on the rail node
    expect(css).toContain('.rail-node-active');
    expect(css).toContain('@keyframes railNodeRingPulse');
  });
});

// ── Phase B: Source chip ──────────────────────────────────────────────────
// Compact cards show a source type icon + domain chip when a URL is present.
// This enables quick source identification at a glance.

describe('source chip on compact cards', () => {
  it('source chip link class is defined in CSS', () => {
    expect(css).toContain('.compact-source-chip-link');
  });

  it('FeedCard references source chip link class', () => {
    expect(feedCard).toContain('compact-source-chip-link');
  });

  it('source type icon map covers all source types', () => {
    // All sourceType values must have an icon entry
    expect(feedCard).toContain('academic_paper');
    expect(feedCard).toContain('news_article');
    expect(feedCard).toContain('official_source');
    expect(feedCard).toContain('wikipedia');
  });
});

// ── Phase B: Glassmorphism compact cards ──────────────────────────────────
// Compact cards use inner glass highlight for visual depth.

describe('glassmorphism card depth', () => {
  it('compact card has inner glass highlight', () => {
    const block = css.match(/\.feed-card-compact\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('inset 0 1px 0');
  });

  it('hero card has deeper shadow with inner highlight', () => {
    const block = css.match(/\.feed-card-hero\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(block).toContain('inset 0 1px 0');
  });
});

// ── Phase A: Unverifiable category chip ──────────────────────────────────
// Unverifiable cards show a category chip explaining why ("Missing details",
// "Not found", etc.) directly in the meta row for quick scanning.

describe('unverifiable category chip', () => {
  it('category chip class is defined in CSS', () => {
    expect(css).toContain('.compact-unverifiable-category');
  });

  it('FeedCard renders category chip for unverifiable cards', () => {
    expect(feedCard).toContain('compact-unverifiable-category');
    expect(feedCard).toContain('isUnverifiable');
  });
});
