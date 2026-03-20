# SourceCheck Feature Inventory
**Date:** 2026-03-20  
**Version:** 0.1.1-beta

---

## EXECUTIVE SUMMARY

| Category | Status |
|----------|--------|
| Core Claim Pipeline | ✅ Complete |
| Real-time Transcript | ✅ Complete |
| Source Verification | ✅ Complete |
| Side Panel UI | ✅ Complete (polish ongoing) |
| User Accounts | ❌ Not Started |
| Session Persistence | ⚠️ Partial (refresh works, no DB) |
| Cross-Video Memory | ⚠️ Backend ready, UI not built |
| Notes & Bookmarks | ❌ Not Started |

---

## 1. FEATURES IMPLEMENTED ✅

### 1.1 Core Extension Infrastructure

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **Chrome MV3 Extension** | Side panel integration with YouTube | `manifest.json`, `vite.config.ts` | ✅ Complete |
| **Content Script** | YouTube page detection, transcript extraction | `src/content/index.ts`, `transcript.ts` | ✅ Complete |
| **Service Worker** | State machine, API routing, message passing | `src/background/service-worker.ts` | ✅ Complete (~1000+ lines) |
| **Error Boundary** | Catches React errors, prevents crash | `src/sidepanel/components/ErrorBoundary.tsx` | ✅ Complete |

### 1.2 Transcript System

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **3-Layer Transcript Extraction** | window → scripts → panel fallback | `src/content/transcript.ts` | ✅ Complete |
| **Playback Tracking** | Real-time position monitoring | `src/content/playback.ts` | ✅ Complete |
| **Chunking System** | 30-second transcript segments | `src/background/service-worker.ts` | ✅ Complete |
| **Refresh Continuity** | Cards survive page reload | `src/background/session-transition.ts` | ✅ Complete (TC5) |
| **Transcript Retry** | Manual retry on fetch failure | `App.tsx` → `handleRetryTranscript` | ✅ Complete |

### 1.3 Claim Detection & Verification

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **Claim Extraction API** | `/api/analyze-chunk` — detects claims from transcript | `backend/src/app/api/analyze-chunk/route.ts` | ✅ Complete |
| **Claim Verification API** | `/api/verify-claim` — finds sources, verifies | `backend/src/app/api/verify-claim/route.ts` | ✅ Complete |
| **Q&A API** | `/api/ask-video` — answers user questions | `backend/src/app/api/ask-video/route.ts` | ✅ Complete |
| **Session Auth** | `/api/session/init` — extension token issuance | `backend/src/app/api/session/init/route.ts` | ✅ Complete |
| **Quality Filtering** | Backend filter for garbage claims | `analyze-chunk/route.ts:passesQualityFilter()` | ✅ Complete |
| **Anchor Validation** | Verifies quotes exist in transcript | `analyze-chunk/route.ts:findAnchorInWindow()` | ✅ Complete |
| **Duplicate Detection** | Normalized claim deduplication | `service-worker.ts` | ✅ Complete |

### 1.4 AI/LLM Integration

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **Gemini API Client** | Structured JSON extraction | `backend/src/lib/gemini.ts` | ✅ Complete |
| **Google Search Grounding** | Source verification with web search | `backend/src/lib/gemini.ts` | ✅ Complete |
| **Model Selection** | 2.5 Flash / 3.1 Lite / 3 Preview | `shared/types.ts` | ✅ Complete |
| **BYOK Mode** | Bring Your Own API Key | `SettingsPanel.tsx`, `api.ts` | ✅ Complete |
| **Rate Limiting** | Redis/memory-based limiting | `backend/src/lib/rate-limit.ts` | ✅ Complete |
| **Prompt Engineering** | Extraction & verification prompts | `backend/src/lib/prompts.ts` | ✅ Complete |
| **Retry Logic** | Exponential backoff, error classification | `src/background/utils/api.ts` | ✅ Complete |

### 1.5 Side Panel UI Components

| Component | What It Does | Lines of Code | Status |
|-----------|--------------|---------------|--------|
| **App Shell** | Main container, error handling | `App.tsx` (472 lines) | ✅ Complete |
| **VideoHeader** | Title, channel, scan progress, status | `VideoHeader.tsx` (274 lines) | ✅ Complete |
| **CardFeed** | Live claim stream, history, scanner rail | `CardFeed.tsx` (1653 lines) | ✅ Complete |
| **SourceCard** | Individual claim + verification result | `SourceCard.tsx` (184 lines) | ✅ Complete |
| **VerdictBadge** | supported/partial/disputed/unverifiable | `VerdictBadge.tsx` (51 lines) | ✅ Complete |
| **ModelPicker** | Model selection dropdown | `ModelPicker.tsx` (230 lines) | ✅ Complete |
| **AskBox** | User Q&A input | `AskBox.tsx` (109 lines) | ✅ Complete |
| **AskResponseCard** | Q&A answer display | `AskResponseCard.tsx` (98 lines) | ✅ Complete |
| **SettingsPanel** | API key management | `SettingsPanel.tsx` (411 lines) | ✅ Complete |
| **SourceCheckLogo** | Animated logo component | `SourceCheckLogo.tsx` (217 lines) | ✅ Complete |
| **FoldAccordion** | 3D folding animation | `FoldAccordion.tsx` (112 lines) | ✅ Complete |
| **DebugPanels** | Dev/debug info (debug=1) | `DebugPanels.tsx` (86 lines) | ✅ Complete |

### 1.6 State Management

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **Worker State Machine** | Canonical reducer pattern | `service-worker.ts` dispatch/compute | ✅ Complete |
| **Storage Sync** | chrome.storage.session/local | `useExtensionStorage.ts` | ✅ Complete |
| **Panel Hydration** | Restore state on refresh | `service-worker.ts:restoreFromStorage()` | ✅ Complete |
| **State Persistence** | Debounced save to storage | `service-worker.ts:persistPanelState()` | ✅ Complete |

### 1.7 Theming & Styling

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **Semantic Color System** | Google-derived palette | `docs/COLOR_SPEC.md` | ✅ Complete |
| **Model Color Tokens** | Blue/Green/Yellow mapping | `src/sidepanel/styles/modelTheme.ts` | ✅ Complete |
| **Dark Theme CSS** | Google-dark neutrals | `src/sidepanel/styles/globals.css` | ✅ Complete |
| **Tailwind Config** | sc-* color utilities | `tailwind.config.js` | ✅ Complete |
| **Glass Morphism** | Backdrop blur, inner glow | `globals.css` utilities | ✅ Complete |
| **Scanner Animations** | Rail pulse, scan head sweep | `globals.css` @keyframes | ✅ Complete |
| **Card Animations** | Slide-in, fold, 3D hinge | `FoldAccordion.tsx`, `globals.css` | ✅ Complete |

### 1.8 Testing & Observability

| Feature | What It Does | File Location | Status |
|---------|--------------|---------------|--------|
| **Pipeline E2E Test** | Full claim extraction → verification | `backend/scripts/test-pipeline.ts` | ✅ Complete |
| **Unit Tests** | Rate limiting, stale transcript | `backend/__tests__/*.test.ts` | ✅ Complete (101 passing) |
| **E2E Smoke Test** | Extension load basic flow | `tests/e2e/extension-smoke.spec.ts` | ✅ Complete |
| **Parse Evidence Logging** | Debug API for parse failures | `backend/src/app/api/debug/parse-errors/route.ts` | ✅ Complete |
| **Error Telemetry** | Provider error tracking | `src/background/telemetry.ts` | ✅ Complete |
| **Remote Logger** | Content script log forwarding | `src/content/remote-logger.ts` | ✅ Complete |

---

## 2. FEATURES MISSING ❌ (From Implementation Plan)

### 2.1 Database & User Accounts

| Feature | What It Should Do | Planned In | Status |
|---------|-------------------|------------|--------|
| **Supabase Auth** | Google OAuth sign-in | Step 10 | ❌ Not Started |
| **User Table** | Store user accounts, plans | Schema section | ❌ Not Started |
| **Watch Sessions Table** | Persist video sessions | Schema section | ❌ Not Started |
| **Claims Table** | Store all claims with verification | Schema section | ❌ Not Started |
| **Saved Notes Table** | User notes on claims | Schema section | ❌ Not Started |

### 2.2 Planned API Endpoints (Not Built)

| Endpoint | Purpose | Location | Status |
|----------|---------|----------|--------|
| `/api/save-note` | Save user notes on claims | `backend/src/app/api/save-note/` | ❌ Not Started |

### 2.3 Planned UI Components (Not Built)

| Component | Purpose | Planned In | Status |
|-----------|---------|------------|--------|
| **QuickChips** | Suggested questions | Step 9 | ❌ Not Started |
| **StatusBar** | Global status indicator | Step 9 | ❌ Not Started |
| **EmptyState** | Placeholder for empty history | Step 9 | ❌ Not Started |
| **History View** | Past sessions list | Step 10 | ❌ Not Started |
| **Notes UI** | Add/view claim notes | Step 10 | ❌ Not Started |

---

## 3. PARTIALLY IMPLEMENTED ⚠️

### 3.1 Cross-Video Memory

| Aspect | Status | Notes |
|--------|--------|-------|
| Backend embedding generation | ✅ | `generateEmbedding()` in `gemini.ts` |
| Vector similarity search | ✅ | `findSimilarClaim()` in `vector-store.ts` |
| Similar claims in verify response | ✅ | `similarClaims` field exists |
| **UI for similar claims** | ❌ | Type exists but not displayed |
| **Cross-video UI** | ❌ | No "you've seen this before" indicator |

### 3.2 Session Persistence

| Aspect | Status | Notes |
|--------|--------|-------|
| Refresh continuity | ✅ | TC5 working, cards survive reload |
| chrome.storage backup | ✅ | `persistPanelState()` saves to extension storage |
| **Database persistence** | ❌ | No Supabase integration |
| **Cross-device sync** | ❌ | No user accounts |
| **Session history beyond refresh** | ❌ | HISTORY tab shows current session only |

### 3.3 Rate Limiting & Monetization

| Aspect | Status | Notes |
|--------|--------|-------|
| Rate limiting (memory/Redis) | ✅ | `rate-limit.ts` working |
| Freemium model enforcement | ✅ | Server-side model restriction |
| **Subscription tiers** | ❌ | Only TODO comment: `gemini.ts:665` |
| **Usage tracking per user** | ❌ | No user system |
| **Paywall UI** | ❌ | Not built |

---

## 4. TECHNICAL DEBT & INCOMPLETE WORK

### 4.1 Known Issues (From NEXT_STEPS.md)

| Issue | Location | Severity | Fix Status |
|-------|----------|----------|------------|
| MutationObserver performance | `playback.ts:15` | Medium | 🔴 Not started |
| Worker persistence batching | `service-worker.ts:1789` | Medium | 🔴 Not started |
| Animation performance budget | `CardFeed.tsx`, `globals.css` | Low | 🔴 Not started |
| Accuracy score calculation | `VideoHeader.tsx:103` | Low | 🟡 Fixed? |
| "[From memory]" prefix | Cached claims | Low | 🟡 Fixed in code |
| Model picker labels | `ModelPicker.tsx` | Low | 🟢 Fixed (2.5/3.1/3) |
| "Reading near" language | `VideoHeader.tsx` | Low | 🔴 Not started |
| Empty state placeholder | `CardFeed.tsx` | Low | 🔴 Not started |
| Settings UX | `SettingsPanel.tsx` | Low | 🟡 Recently refactored |
| E2E refresh test | `extension-smoke.spec.ts` | Medium | 🔴 Not started |

### 4.2 Single TODO in Codebase

```typescript
// backend/src/lib/gemini.ts:665
// TODO: Integrate with actual subscription/auth system
```
This is the only remaining TODO. Everything else is either complete or tracked in docs.

---

## 5. FEATURE GAPS ANALYSIS

### What The Implementation Plan Promised vs Reality

| Planned Feature | Status | Gap |
|-----------------|--------|-----|
| User signup/sign-in | ❌ | Entire auth system missing |
| Session history (database) | ❌ | Only in-memory + chrome.storage |
| Notes on claims | ❌ | No UI, no API endpoint |
| Cross-video memory UI | ❌ | Backend ready, UI not built |
| QuickChips | ❌ | Planned but not built |
| Pro tier paywall | ❌ | Free-only currently |

### What Works That Wasn't Explicitly Planned

| Feature | Value |
|---------|-------|
| Refresh continuity (TC5) | Major UX win |
| BYOK mode | Power user feature |
| 3-layer transcript fallback | Robustness |
| Debug panels | Developer experience |
| Parse evidence logging | Debugging production issues |
| Mechanical fold animations | Premium feel |
| Semantic color system | Maintainable theming |

---

## 6. RECOMMENDATION

### Current State: "Beta-Complete"

The app is **functionally complete** for a solo developer beta:
- Core claim detection works
- Verification with real sources works
- UI is polished and theme-consistent
- Refresh continuity works
- BYOK mode works

### What's Needed for Public Launch

**Must Have:**
1. User accounts (Supabase Auth)
2. Database persistence (claims, sessions)
3. Usage limits & paywall
4. Empty states and better first-time UX

**Nice to Have:**
1. Cross-video memory UI
2. Notes on claims
3. QuickChips
4. Session history beyond current video

**Performance:**
1. MutationObserver profiling
2. Worker persistence debouncing
3. Animation performance budget

---

## 7. FILE SIZE SUMMARY

| Component | Lines | Complexity |
|-----------|-------|------------|
| `CardFeed.tsx` | 1,653 | High (feed logic, animations) |
| `service-worker.ts` | ~1,000+ | High (state machine, pipeline) |
| `SettingsPanel.tsx` | 411 | Medium |
| `VideoHeader.tsx` | 274 | Medium |
| `ModelPicker.tsx` | 230 | Low-Medium |
| `SourceCheckLogo.tsx` | 217 | Low (SVG animation) |
| `SourceCard.tsx` | 184 | Low |
| **Total UI** | ~4,025 | |

---

**Bottom Line:** The core product is complete and working. The remaining work is infrastructure (auth, DB, billing) and polish, not core functionality.
