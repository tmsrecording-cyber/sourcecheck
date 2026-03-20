# SourceCheck — Full Handoff Document

**Date:** March 19, 2026  
**Current Tag:** `v0.1.0-beta`  
**Status:** Feature-complete, needs verification & hardening

---

## Executive Summary

SourceCheck is a Chrome extension that provides real-time fact-checking for YouTube videos. The app is **functionally working** — transcripts extract, claims verify, cards render. However, the user reports it "feels off" and needs hardening before broader release.

**Do not add new features. Focus on stability, testing, and polish.**

---

## What Works (Verified)

| Feature | Status | Evidence |
|---------|--------|----------|
| Transcript extraction | ✅ | 3-layer fallback (timedtext API, HTML, panel) |
| Panel fallback delivery | ✅ | Fixed today — transcripts now reach analysis |
| Claim verification | ✅ | Cards appear with supported/partial/disputed/inconclusive |
| LIVE/HISTORY tabs | ✅ | Switching works, empty states added |
| TC5 page refresh | ✅ | Grace period + refresh detection implemented |
| Model selection | ✅ | Labels fixed (2.5=Standard, 3.1=Fast, 3=Deep) |
| Accuracy score | ✅ | Shows "78% · 3 of 5 resolved" with context |
| Build | ✅ | `npm run build` passes |
| Backend tests | ✅ | 99/99 passing |

---

## Known Issues (Needs Investigation)

### 1. "Feels Off" — User Report
**Status:** Unconfirmed, needs diagnosis  
**Symptoms:** Working but not smooth, timing feels wrong, visual jank suspected  
**Likely Causes:**
- Race conditions between playback updates and card rendering
- No transition animations (cards snap between states)
- Leash filtering hiding/showing cards abruptly
- Service worker persistence causing UI stutter

**Action:** Run Chrome Performance profile (see "Next Steps")

### 2. E2E Test Status
**Status:** Test written, not run  
**Location:** `tests/e2e/tc5-refresh.spec.ts`  
**Purpose:** Verify cards survive page refresh in real browser  
**Action:** Run and verify (see "Next Steps")

### 3. Performance Unverified
**Status:** Optimizations applied, impact unknown  
**Changes Made:**
- MutationObserver scoped to `#movie_player` (was `document.body`)
- `persistPanelState` debounced 250ms (was immediate)

**Action:** Profile in Chrome DevTools (see "Next Steps")

---

## Architecture Overview

### Data Flow
```
YouTube Page
    ↓ (content script)
transcript.ts — extracts captions (3 methods)
    ↓ (messages)
service-worker.ts — batches, analyzes, verifies
    ↓ (storage + messages)
sidepanel (React) — renders cards
```

### Key Files
| File | Purpose | State |
|------|---------|-------|
| `src/content/transcript.ts` | Extract transcripts | ✅ Fixed panel fallback |
| `src/content/playback.ts` | Track video time | ✅ Observer scoped |
| `src/background/service-worker.ts` | Core logic | ✅ TC5 fix, debouncing |
| `src/background/utils/session-transition.ts` | Refresh detection | ✅ Extracted + tested |
| `src/sidepanel/components/VideoHeader.tsx` | Score display | ✅ Context added |
| `src/sidepanel/components/CardFeed.tsx` | Card list | ✅ Empty states |
| `src/sidepanel/components/SourceCard.tsx` | Individual card | ✅ data-testid added |

---

## Critical Code Paths

### TC5 Refresh Logic
```typescript
// service-worker.ts:2669
if (isSameVideo && hasRestoredState && currentVideoInfo) {
  // Merge metadata instead of reset
  currentVideoInfo = mergeVideoMetadata(currentVideoInfo, nextVideo);
  syncVisibleTimelineState(); // 5s grace period
}
```

### Grace Period (Prevents Leash Filter on Refresh)
```typescript
// service-worker.ts:1132
const isInGracePeriod = hydratedAt && (Date.now() - hydratedAt) < 5000;
sourceCards = (leashCutoff === null || isInGracePeriod)
  ? sortedSourceCards
  : sortedSourceCards.filter(card => card.timestampSeconds <= leashCutoff);
```

### Panel Fallback (Now Working)
```typescript
// content/index.ts:351
TRANSCRIPT_LOADED payload now includes:
  - videoId
  - debug
  - transcript  // ← was missing, now added
```

---

## Testing

### Unit Tests
```bash
cd /Users/mj/Desktop/SourceCheck/backend
npm test  # 99/99 passing
```

### E2E Test (Not Run)
```bash
cd /Users/mj/Desktop/SourceCheck
npx playwright test tests/e2e/tc5-refresh.spec.ts --headed
```
**Expected:** Cards survive page refresh

### Manual Testing Checklist
- [ ] Navigate to YouTube video with captions
- [ ] Wait for "Monitoring" status
- [ ] Cards appear within 60 seconds
- [ ] Press F5 (refresh)
- [ ] Cards restore within 3 seconds
- [ ] Switch to HISTORY tab — shows "Checked so far"
- [ ] Accuracy score shows "X% · Y of Z resolved"

---

## Next Steps (In Priority Order)

### Step 1: Diagnose "Feels Off"
**Priority:** CRITICAL  
**How:**
1. Load extension in Chrome
2. Open DevTools → Performance tab
3. Click record (circle button)
4. Use app for 30 seconds (scroll, switch tabs, let cards appear)
5. Stop recording
6. Screenshot the graph
7. Look for:
   - CPU spikes (red blocks)
   - Long tasks (>50ms)
   - Memory climbing (leak)

**What to fix based on findings:**
- CPU spikes in `playback.ts` → Throttle time updates
- Spikes in service worker → Reduce persistence frequency
- Long frames → Add `requestAnimationFrame` batching

### Step 2: Run E2E Test
**Priority:** HIGH  
**Command:**
```bash
npm run test:e2e
# or specifically:
npx playwright test tests/e2e/tc5-refresh.spec.ts --headed
```
**Expected:** Test passes, cards survive refresh

### Step 3: Add Transition Animations (Optional)
**Priority:** LOW  
**Issue:** Cards snap between states (hero → list)  
**Files:** `CardFeed.tsx`, `SourceCard.tsx`  
**Approach:** Add CSS transitions or Framer Motion

### Step 4: Settings Panel UX (Optional)
**Priority:** LOW  
**Issue:** Settings replaces entire view, feels jarring  
**Approach:** Slide-over panel instead of full replacement

---

## Git History (Last 10 Commits)

```
8ea24ba fix(ux): show resolved/total context in accuracy score
38bf949 fix(ux): model labels, status cleanup, empty states (Tracks C & D)
2df939a docs: add progress summary and next steps
69ce8bf test(track-b): add TC5 page refresh E2E test
92e0026 perf(track-a): optimize mutation observer and persistence
d297c6e fix(tc5): add grace period after refresh to prevent leash filtering
2ce146c fix(transcript): include transcript in TRANSCRIPT_LOADED for panel fallback
afe8e14 refactor(tc5): extract session transition logic with tests
ebd0e30 fix(tc5): preserve state on page refresh
55b3bb5 fix(hydration): preserve cards during worker restart
```

---

## Environment

### Build
```bash
npm run build          # Extension
npm --prefix backend test  # Backend tests
```

### Dev Server
```bash
cd backend && npm run dev  # localhost:3000
```

### Load Extension
1. `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked → `/Users/mj/Desktop/SourceCheck/dist`

---

## Key Decisions (Don't Change Without Discussion)

1. **Accuracy Score:** Only scores resolved claims. Shows "X of Y resolved" for context. Don't change the math.

2. **Model Policy:** Hard-locked to 3 models. Freemium = 2.5-flash only. Don't add models.

3. **TC5 Grace Period:** 5 seconds after refresh where all cards visible. Don't reduce this.

4. **Leash Window:** 15 seconds behind playhead. Cards outside this are hidden in LIVE tab.

---

## Files to Know

| File | What It Does |
|------|--------------|
| `PROGRESS_SUMMARY.md` | What was fixed today |
| `NEXT_STEPS.md` | Priority roadmap (Tracks A-D) |
| `AUDIT_RECONCILIATION.md` | Known technical debt |
| `AGENTS.md` | Project architecture guide |

---

## Contact/Context

**User Feedback:** "Works but feels off" — likely timing, animations, or race conditions. Needs hardening, not features.

**Success Criteria:**
- E2E test passes
- Performance profile shows <5% CPU with panel open
- No visual jank (smooth 60fps scrolling)

**Do NOT:**
- Add new features
- Change core architecture
- Modify model policy
- Add more logging

**DO:**
- Fix race conditions
- Add animations/transitions
- Optimize hot paths
- Verify with tests

---

## Quick Commands

```bash
# Build everything
npm run build && cd backend && npm run build

# Run all tests
npm --prefix backend test && npm run test:e2e

# Check git status
git log --oneline -10
git status

# Tag current state
git tag -a v0.1.0-rc1 -m "Release candidate 1"
```

---

**End of Handoff**
