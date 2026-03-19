# SourceCheck — Next Steps & Priorities

## Executive Summary

The app is **functionally working** (transcript extraction, claim verification, cards rendering). 

The remaining work is **performance optimization, trust/UX polish, and test coverage** — not core functionality.

---

## Priority Tracks (Engineering + UX)

### 🔴 TRACK A: Performance & Runtime Stability
**Goal:** App feels responsive with panel open

| Issue | Location | Action |
|-------|----------|--------|
| Full-body DOM observation | `playback.ts:15` | Profile MutationObserver, throttle or scope to video element only |
| Frequent worker persistence | `service-worker.ts:1789` | Batch persistence (debounce 500ms), reduce storage writes |
| Animation-heavy rendering | `CardFeed.tsx:836`, `globals.css:175` | Set performance budget, reduce motion, use CSS containment |

**Success Metric:** Panel open for 10 minutes, no jank, <5% CPU in Chrome Task Manager

---

### 🔴 TRACK B: Refresh Continuity (TC5 Completion)
**Goal:** Cards survive page refresh reliably

| Issue | Current State | Fix |
|-------|---------------|-----|
| Helper logic exists | `session-transition.ts` ✅ | Working |
| Leash filtering hides restored cards | `service-worker.ts:1115` | Completed (grace period added) |
| VIDEO_CHANGED reset on refresh | `service-worker.ts:2669` | Completed (refresh detection) |
| Missing E2E coverage | `extension-smoke.spec.ts` | **TODO:** Add real page-refresh test |

**Remaining Work:** Browser-level E2E test that proves cards survive reload

---

### 🟡 TRACK C: Truth Metrics & Trust Language
**Goal:** Score accurately reflects verification state

| Issue | Current | Problem | Fix |
|-------|---------|---------|-----|
| Accuracy score excludes unresolved | `VideoHeader.tsx:103` | Shows 100% when unresolved exist | Include all claims in denominator, or show "X verified, Y pending" |
| "[From memory]" prefix visible | Cached claims | Users see internal caching language | Strip prefix (already fixed in code, verify in UI) |
| "Flash 2.5 Lite" = "DEEP" | Model picker | Contradictory labels | Fix labels: 2.5 = "Balanced", 3.1 = "Fast", 3 = "Deep" |
| "Reading near" jargon | VideoHeader | Developer-speak | Change to "Checking at" or "Verified at" |

---

### 🟡 TRACK D: UX Polish (Empty States, Navigation)
**Goal:** First-time users understand app state

| Issue | Current | Fix |
|-------|---------|-----|
| Empty body looks like crash | HISTORY tab = void | Add placeholder: "Claims appear here as video is checked" |
| Redundant status (MONITORING + LIVE) | Two elements, same meaning | Remove one or differentiate (badge = mode, label = timestamp) |
| Settings feels like different app | Full-screen modal | Slide-over panel or inline expansion |
| Ask box disappears on HISTORY | Hidden when `activeTab !== 'live'` | Keep visible or add explanation |
| No transition animation | Cards snap between states | Add subtle fade/slide for hero card changes |

---

## Implementation Order

### Week 1: Performance (Track A)
```
Day 1-2: Profile MutationObserver in playback.ts
Day 3-4: Debounce service worker persistence
Day 5: Set performance budget, measure baseline
```

### Week 2: Refresh Continuity (Track B)
```
Day 1-2: Write E2E test for page refresh (Playwright)
Day 3-4: Verify TC5 passes consistently
Day 5: Document refresh behavior
```

### Week 3: Trust & Metrics (Track C)
```
Day 1: Fix accuracy score calculation
Day 2: Fix model picker labels
Day 3: Update "Reading near" language
Day 4-5: Verify "[From memory]" stripped in UI
```

### Week 4: UX Polish (Track D)
```
Day 1-2: Empty state placeholders
Day 3: Remove redundant status labels
Day 4-5: Settings panel UX improvements
```

---

## Immediate Next Step

**Before any of the above:** Tag current working state.

```bash
# Current state: functionally working, needs polish
git tag -a v0.1.0-beta -m "Beta: Core functionality working

Working:
- Transcript extraction (3-layer fallback)
- Claim detection and verification
- LIVE/HISTORY tabs
- TC5 refresh with grace period
- Panel fallback transcript delivery

Known issues:
- Performance not profiled
- UX polish needed (empty states, labels)
- E2E refresh test missing
"
```

Then proceed with Track A (performance).

---

## Decision Points

| Question | Recommendation |
|----------|----------------|
| Fix UX or performance first? | **Performance** — if app feels slow, UX polish doesn't matter |
| Keep "[From memory]" for transparency? | **No** — users don't understand caching; strip it |
| Settings as modal or inline? | **Inline slide-over** — preserves context |
| Empty state placeholder? | **"Claims appear here as the video is checked"** + animated indicator |

---

## Files to Modify (Ranked by Impact)

### High Impact
1. `src/content/playback.ts` — MutationObserver throttling
2. `src/background/service-worker.ts` — Persistence debouncing
3. `src/sidepanel/components/VideoHeader.tsx` — Score calculation, labels

### Medium Impact
4. `src/sidepanel/components/CardFeed.tsx` — Empty states, transitions
5. `src/sidepanel/App.tsx` — Settings navigation UX
6. `tests/e2e/extension-smoke.spec.ts` — Refresh E2E test

### Low Impact (Polish)
7. `src/sidepanel/components/ModelPicker.tsx` — Label fixes
8. `src/sidepanel/styles/globals.css` — Animation performance

---

## Summary

**The app works.** Now make it:
1. Fast (Track A)
2. Reliable on refresh (Track B)
3. Trustworthy (Track C)
4. Clear to first-time users (Track D)

**Recommended start:** Performance profiling (Track A) while the app is in a known working state.
