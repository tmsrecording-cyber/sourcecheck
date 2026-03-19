# SourceCheck Progress Summary — March 19, 2026

## Tag
**v0.1.0-beta** — Core functionality complete

---

## What Was Fixed Today

### 1. Panel Fallback Transcript Delivery 🔴 CRITICAL
**Problem:** Panel fallback extracted 84 chunks but analysis never started.
**Root Cause:** `TRANSCRIPT_LOADED` message only sent `videoId`/`debug`, expecting data in `pendingTranscriptBuffer`. But panel fallback bypasses batching.
**Fix:** 
- Include transcript directly in `TRANSCRIPT_LOADED` message
- Service worker accepts direct transcript when buffer is empty
- Normalizes chunk format (startMs/durationMs vs startTime/duration)

**Status:** ✅ FIXED — Cards now appear after panel fallback

### 2. TC5 Page Refresh State Preservation 🔴 CRITICAL  
**Problem:** Cards disappeared on page refresh (F5).
**Root Cause:** 
- `VIDEO_CHANGED` handler treated refresh as new session → wiped state
- `syncVisibleTimelineState` cleared cards when transcript temporarily unavailable
- `allPendingClaims` not persisted

**Fix:**
- Added refresh detection in `VIDEO_CHANGED` (same videoId + restored state = merge, don't reset)
- Added 5-second grace period after hydration (skip leash filtering)
- Persist `allPendingClaims` to session storage
- Extracted logic to `session-transition.ts` with unit tests

**Status:** ✅ FIXED — Cards survive refresh

### 3. Performance Optimizations (Track A) 🟡 HIGH
**Problems:**
- Full-body MutationObserver watching entire DOM
- `persistPanelState` called 35+ times per lifecycle (no debouncing)

**Fix:**
- Scoped MutationObserver to `#movie_player` or `#player` container
- Added 250ms debounce to `persistPanelState` (batches rapid changes)
- Estimated 10x reduction in storage writes

**Status:** ✅ IMPLEMENTED

### 4. TC5 E2E Test (Track B) 🟡 HIGH
**Added:** `tests/e2e/tc5-refresh.spec.ts`
- Tests cards survive page refresh
- Tests hydration completes within 5 seconds
- Added `data-testid="source-card"` for testability

**Status:** ✅ ADDED

---

## Current State

| Component | Status |
|-----------|--------|
| Transcript extraction | ✅ Working (3-layer fallback) |
| Panel fallback delivery | ✅ Fixed |
| Claim verification | ✅ Working |
| LIVE/HISTORY tabs | ✅ Working |
| TC5 page refresh | ✅ Fixed |
| Performance optimizations | ✅ Implemented |
| E2E refresh test | ✅ Added |

---

## Remaining Work (Next Steps)

### Track A: Performance (In Progress)
- [x] MutationObserver optimization
- [x] Persistence debouncing
- [ ] Set performance budget
- [ ] Measure actual impact

### Track B: Refresh Continuity (In Progress)
- [x] TC5 fix implemented
- [x] Unit tests added
- [x] E2E test added
- [ ] Run E2E test in CI

### Track C: Truth Metrics (Pending)
- [ ] Fix accuracy score to include unresolved claims
- [ ] Fix model picker labels ("Flash 2.5 Lite" ≠ "DEEP")
- [ ] Change "Reading near" to "Checking at"

### Track D: UX Polish (Pending)
- [ ] Empty state placeholders
- [ ] Remove redundant "MONITORING + LIVE" labels
- [ ] Settings panel improvements

---

## Files Modified Today

| File | Changes |
|------|---------|
| `src/content/index.ts` | Include transcript in TRANSCRIPT_LOADED |
| `src/content/playback.ts` | Scope MutationObserver to player container |
| `src/background/service-worker.ts` | Refresh detection, grace period, debouncing |
| `src/background/utils/session-transition.ts` | NEW: Extracted refresh logic |
| `tests/unit/session-refresh-regression.spec.ts` | NEW: Unit tests for refresh |
| `tests/e2e/tc5-refresh.spec.ts` | NEW: E2E refresh test |
| `src/sidepanel/components/SourceCard.tsx` | Added data-testid |
| `NEXT_STEPS.md` | NEW: Priority roadmap |
| `PROGRESS_SUMMARY.md` | NEW: This file |

---

## Git History (Today)

```
69ce8bf test(track-b): add TC5 page refresh E2E test
92e0026 perf(track-a): optimize mutation observer and persistence
2ce146c fix(transcript): include transcript in TRANSCRIPT_LOADED
afe8e14 refactor(tc5): extract session transition logic
ebd0e30 fix(tc5): preserve state on page refresh
55b3bb5 fix(hydration): preserve cards during worker restart
f1891c8 baseline: pre-test-matrix checkpoint
```

---

## Verification

### Build Status
```bash
npm run build          # ✅ PASSING
npm --prefix backend test  # ✅ 99/99 PASSING
```

### Functionality Status
- Transcript extraction: ✅ Working
- Cards appearing: ✅ Working  
- Refresh survival: ✅ Working (needs E2E verification)
- Performance: ✅ Optimized (needs profiling)

---

## Next Immediate Actions

1. **Profile performance** — Run Chrome DevTools Performance tab with panel open
2. **Run E2E test** — `npm run test:e2e` (requires manual verification)
3. **Fix accuracy score** — Include unresolved in denominator (Track C)

---

## Summary

**The app is working.** Core functionality (transcript → claims → cards) is stable. Today's work fixed the two critical blockers (panel delivery + refresh) and added performance optimizations. Remaining work is polish and testing.
