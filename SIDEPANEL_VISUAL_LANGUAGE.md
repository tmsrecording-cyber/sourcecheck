# Sidepanel Visual Language

This document locks the motion, surface, and semantic-cue rules for the SourceCheck sidepanel.

The goal is not "more animation". The goal is a UI that feels physically coherent, readable at a glance, and safe to extend without regressions.

## What Already Works

These patterns are already strong and should be treated as the current foundation.

- Card hover lift in [FeedCard.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/FeedCard.tsx#L526)
- Staggered stack entry in [CardFeed.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/CardFeed.tsx#L203)
- Ask response arrival in [AskResponseCard.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/AskResponseCard.tsx#L27)
- Model picker active-state elevation in [ModelPicker.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/ModelPicker.tsx#L89)
- Rail/node/connector hierarchy in [FeedCard.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/FeedCard.tsx#L480)

Why they work:

- The motion is constrained to the active object.
- The distances are small.
- The easing feels weighted, not playful.
- The UI signals hierarchy before the user reads every word.

## External Research

The best references are not flashy demos. They are product systems that treat motion as part of meaning.

### Fluent 2

Source:

- https://fluent2.microsoft.design/motion

Useful ideas:

- Motion should be functional, natural, consistent, and appealing.
- Use elevation to communicate depth and hierarchy.
- Use quick fade transitions at the top level instead of sliding large surfaces around.
- Use container transforms for resize/reposition moments.
- Prefer short stagger offsets and animate important elements first.
- Keep motion constrained to the element in focus.

### Material Design

Sources:

- https://m1.material.io/motion/transforming-material.html
- https://m1.material.io/patterns/navigational-transitions.html
- https://m1.material.io/components/buttons.html

Useful ideas:

- Surfaces should feel like they join, divide, lift, and expand.
- Expansion should often be asymmetric: width starts before height on open, height starts before width on collapse.
- Parent-to-child transitions should lift and expand from the touched origin.
- Sibling-level transitions should avoid artificial elevation changes.
- On desktop, buttons and raised surfaces can gain elevation on hover, then return quickly to resting elevation.

### Carbon

Sources:

- https://carbondesignsystem.com/elements/motion/overview/
- https://carbondesignsystem.com/elements/motion/code/

Useful ideas:

- Separate motion into productive and expressive styles.
- Use productive motion for microinteractions and dense work.
- Reserve expressive motion for significant moments only.
- Avoid bounce, stretch, and sudden stops.
- Use shared motion tokens instead of inventing easing and duration per component.

Carbon is useful as discipline, but SourceCheck should not import Carbon's feel wholesale. The current sidepanel already has a stronger signature in its softer weighted spring.

### Motion.dev

Sources:

- https://motion.dev/docs/react-gestures
- https://motion.dev/docs/react-transitions
- https://motion.dev/docs/hover

Useful ideas:

- `whileHover`, `whileTap`, and layout animation are the right primitives for this UI.
- Hover should be treated as a real gesture, not fake touch hover.
- Use value-specific transitions or named variants when patterns repeat.
- Keep hover/tap behaviors keyboard-safe and reduced-motion-aware.

### Apple Reduced Motion Guidance

Source:

- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria/

Useful ideas:

- Do not remove meaningful motion blindly.
- Replace decorative depth simulation with dissolve, highlight fade, or color shift when reduced motion is requested.
- Re-evaluate motion support every release.

## SourceCheck Motion Model

SourceCheck should use two motion modes.

### Productive Motion

Use for:

- Card hover
- Card press
- Compact expand/collapse
- List entry
- Model picker dropdown
- Notice arrival

Properties:

- Short
- Clear
- Weighted
- Local to one element or one cluster

### Expressive Motion

Use rarely:

- First verified result after a long scan
- Successful Ask answer surfaced to HISTORY
- One-time milestone states if they are genuinely important

Properties:

- Slightly longer
- Slightly brighter
- Still restrained

Do not use expressive motion for routine card hover, tabs, or scrolling.

## Motion Tokens

These are the defaults to lock unless there is a clear reason to override.

### Easing

- `--motion-soft-spring`: `cubic-bezier(0.16, 1, 0.3, 1)`
- `--motion-quick-ease`: `cubic-bezier(0.4, 0, 1, 1)`

### Duration

- `--motion-fast-01`: `70ms`
- `--motion-fast-02`: `120ms`
- `--motion-micro`: `160ms`
- `--motion-standard`: `200ms`
- `--motion-layout`: `220ms`
- `--motion-enter`: `280ms`
- `--motion-tab`: `300ms`
- `--motion-expressive`: `400ms`

### Distances

- `--motion-lift-y`: `-1px`
- `--motion-lift-y-strong`: `-2px`
- `--motion-enter-y`: `8px`
- `--motion-exit-y`: `-6px`
- `--motion-stagger-step`: `30ms`

These values are mirrored in the live sidepanel CSS and Framer Motion token layer. New interaction work should use the shared token vocabulary before introducing another duration or easing.

## Interaction Patterns To Lock

### 1. Hover Lift

Purpose:

- Show the surface is alive and interactive.

Rules:

- Never more than `-2px` translate on hover.
- Scale no higher than `1.006` for cards.
- Pair movement with a subtle border/shadow response.
- Passive cards do not lift.

Current good reference:

- [FeedCard.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/FeedCard.tsx#L535)

### 2. Press Settle

Purpose:

- Confirm intentional interaction.

Rules:

- Use slight scale-down only.
- No rotation for standard app controls.
- Press response should be faster than hover response.

### 3. Stack Entry

Purpose:

- Make list arrival feel structured and readable.

Rules:

- Use stagger for small groups.
- Cap stagger at 4 visible items.
- Use small upward origin and optional slight rotateX only if reduced motion is off.

Current good reference:

- [CardFeed.tsx](/Users/mj/Desktop/SourceCheck/src/sidepanel/components/CardFeed.tsx#L203)

### 4. Expand Reveal

Purpose:

- Show that a compact summary is unfolding into supporting evidence.

Rules:

- Expanded content should feel like it unfolds from the compact shell.
- Prefer asymmetric reveal when we later split shell and body animation.
- Avoid generic accordion motion where the whole card just stretches.

### 5. Notice Arrival

Purpose:

- Surface system status without stealing focus.

Rules:

- Notices enter from the side or lane edge, not from the center of the panel.
- Use productive entrance motion.
- Keep them visually separate from content cards.

## Semantic Cue Roles

Every role should have a fixed cue recipe.

### Verdict

Used for:

- Supported
- Mixed
- Unsupported
- Needs review

Primary cues:

- Status chip
- Rail color
- Leading icon
- Slightly stronger card edge

### Claim Summary

Used for:

- The short, human-readable statement of what the check means

Primary cues:

- Largest body text in a card
- Highest contrast after the title
- No decorative accenting

### Quote

Used for:

- The literal statement pulled from the source or transcript

Primary cues:

- Lower contrast than claim summary
- Distinct quotation formatting
- Slightly smaller than claim summary

### Source

Used for:

- Provenance label and source title

Primary cues:

- Uppercase kicker
- Reduced emphasis
- Stable placement

### Memory

Used for:

- Seen-before information

Primary cues:

- Secondary accent
- Smaller text block
- Never stronger than the source or main verdict

### System Notice

Used for:

- Model changed
- Settings saved
- Answer ready

Primary cues:

- Separate lane
- Compact panel
- Monospace/telemetry-like title
- Not card-like enough to be confused with feed content

## Copy Tone Contract

This is currently the main weak point.

Rules:

- Prefer short editorial phrasing over generic assistant phrasing.
- Avoid "likely" unless uncertainty is the point.
- Avoid filler like "I don’t have enough context to answer" if a more direct explanation exists.
- Distinguish system copy from evidence copy.
- Keep verdict copy human, plain, and specific.

Examples:

- Better: `Needs an official source.`
- Worse: `This likely needs a paper, dataset, or official record.`

- Better: `See HISTORY for the answer.`
- Worse: `Open HISTORY to view the response.`

- Better: `Key saved.`
- Worse: `Your API key is ready for the next checks.`

We should gradually move all user-facing strings toward this style.

## Reduced Motion Contract

If reduced motion is on:

- Remove 3D tilt and rotateX.
- Replace lift with border/highlight changes.
- Keep fades and opacity shifts if they convey state.
- Preserve hierarchy changes, but flatten the physics.

## What To Add Next

These are the best next improvements.

### Tier 1

- Move repeated transition/easing values into shared motion tokens.
- Standardize hover and press behavior for cards, buttons, and picker triggers.
- Tighten robotic copy in card verdicts and notices.

### Tier 2

- Introduce asymmetric expand/collapse for compact cards.
- Add subtle rail/intensity response on hover for interactive compact rows.
- Differentiate quote text and source provenance more clearly.

### Tier 3

- Add one expressive milestone motion for "first solid result" or similar.
- Add animated numeric summary only if it improves comprehension, not decoration.

## What To Avoid

- 3D gimmicks
- Parallax
- Long springs
- Bounce on routine interactions
- Full-panel sliding transitions
- Using color as the only meaning carrier
- Different hover behaviors for equivalent objects

## Engineering Rules

- No new motion pattern lands without a semantic reason.
- Every new motion pattern must have a reduced-motion fallback.
- Every repeated animation should be tokenized after the second use.
- Every new user-facing system string should be checked against the copy tone contract.
- When a pattern is judged "right", add a small regression test or checklist item for it.

## Implementation Status

### Implemented in M3.5

**Motion Token System (`src/sidepanel/styles/motionTokens.ts`)**:
- `SOFT_SPRING` — SourceCheck signature easing `[0.16, 1, 0.3, 1]`
- `PRODUCTIVE` — Carbon-inspired easings for snappier interactions
- `DURATION` — Semantic duration constants
- `DISTANCE` — Movement and scale values
- Semantic presets: `hoverLift`, `pressSettle`, `stackEntryVariants`, `noticeArrival`, `askResponseEntry`, `expandReveal`
- Reduced-motion variants for all presets
- Helper functions: `getStackEntryVariants()`, `getNoticeArrival()`, `getHoverLift()`, `getPressSettle()`

**Migrated Components**:
- `FeedCard.tsx` — Uses motion tokens for hover, press, expand, entry
- `CardFeed.tsx` — Uses motion tokens for stack entry, hero transitions
- `AskResponseCard.tsx` — Uses motion tokens for entry animation
- `NoticeStack.tsx` — Uses motion tokens for arrival animation and press feedback
- `ModelPicker.tsx` — Added press feedback
- `App.tsx` — Added press feedback to tabs and settings button

**CSS Reduced Motion**:
- Enhanced `@media (prefers-reduced-motion: reduce)` with specific rules for sidepanel interactions
- Preserved essential state transitions for accessibility
- Removed transform-based hover effects for reduced motion users

**Copy Tone Tightening**:
- `notices.ts` — Shortened messages ("API key ready.", "Answer in HISTORY.")
- `FeedCard.tsx` — Tightened thinking status copy
- `AskResponseCard.tsx` — Shortened "Sourced from" to "Sources"

### Engineering Rules Applied

- ✅ Shared motion tokens exist and replace repeated ad hoc timings
- ✅ Interactive surfaces use consistent hover and press behavior
- ✅ Reduced-motion behavior is consistent across JS and CSS
- ✅ System copy follows documented tone contract
- ✅ Every new motion pattern has a reduced-motion fallback
- ✅ Tokenized after second use: all motion values now use tokens

### Intentional Exceptions

- **FoldAccordion** — Not part of the active sidepanel runtime. If it is reintroduced later, it must either be declared the single expressive 3D exception or flattened into the productive motion language before shipping.
- **Tab indicator** — Uses CSS transitions for opacity/scale; not migrated to Framer Motion to avoid unnecessary JS overhead for a decorative cue.
