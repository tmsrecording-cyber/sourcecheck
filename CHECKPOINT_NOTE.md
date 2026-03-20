# Checkpoint: sidepanel-m3-lock-in-progress

**Date:** 2026-03-20  
**Status:** Baseline locked  
**Tag:** baseline-2026-03-20-sidepanel-lock

## Current Verified State

### Automated gates
- ✅ Extension unit tests: `75/75`
- ✅ Backend unit tests: `105/105`
- ✅ Extension build: `npm run build`
- ✅ Extension smoke e2e: `npm run test:e2e:smoke`

### Product state confirmed in code
- ✅ Unified `FeedCard` system is the single live/history card primitive
- ✅ Managed model path is hard-locked to `gemini-2.5-flash`
- ✅ BYOK model selection is preserved only when a valid stored key exists
- ✅ Cross-video memory UI renders in hero and compact cards
- ✅ Global Ask focus shortcut works from the sidepanel shell
- ✅ Sidepanel notice layer exists for settings save, model change, and transcript fallback

## What Changed Since The 2026-03-17 Recovery Baseline

1. **Model policy hardening**
   - Freemium/managed mode now snaps back to `gemini-2.5-flash`
   - Stale saved BYOK models no longer leak into managed sessions
   - UI shows effective model, not stale sync state

2. **Sidepanel architecture cleanup**
   - `CardFeed.tsx` reduced from the old multi-path legacy structure to the current lean feed shell
   - Dead live-strip/checking/history-row code removed
   - Loading, empty, hero, verifying, scanning, and compact states all render through `FeedCard`

3. **Trust and memory improvements**
   - Similar-claim memory is wired end-to-end from backend to UI
   - Cached/memory wording is normalized for user-facing trust copy
   - Legacy truth-score UI is removed from active UI and dead CSS cleaned up

4. **Shell interaction hardening**
   - Ask shortcut supports `/` and `Cmd+K` / `Ctrl+K`
   - App listeners use safer live-ref patterns
   - Transcript retry display state no longer relies on the older effect-driven double render pattern

## Manual Evidence Captured This Pass

These are supported by current UI validation during this pass:
- ✅ Live scan hero card
- ✅ Verified hero card
- ✅ Mixed / unresolved compact history rows
- ✅ Cross-video memory surfaced as `Seen before`
- ✅ Managed model picker showing `2.5` while managed usage stays on Flash 2.5

## Manual Baseline Checklist

These were the final human baseline checks used to validate the lock:
- [ ] Live YouTube scan from empty state through first verified card
- [ ] Source card expansion/collapse in a real browsing session
- [ ] Ask flow submission and answer rendering in live mode
- [ ] Refresh continuity on an active video
- [ ] BYOK save, reload, remove-key reset back to managed model

## Known Remaining Work

### Product-safe next steps
1. Add a small App-shell regression layer if a React component test harness is introduced later.
2. Treat sidepanel visual/interaction changes as regression-sensitive from this point forward.
3. Keep the baseline tag as the rollback point for future UI work.

### Things not to misstate
- This is **not** “production scaling complete.”
- Transcript extraction is still resilient-but-fragile because YouTube DOM and player-response shapes can drift.
- A formal baseline tag should not be created until these changes are committed cleanly.

## Current Risk Read

**Low** on current sidepanel regressions due to unit/build/smoke coverage.  
**Medium** on transcript extraction durability because it depends on YouTube internals and selector fallbacks.
