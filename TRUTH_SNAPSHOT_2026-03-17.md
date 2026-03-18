# SourceCheck Truth Snapshot — 2026-03-17

**Baseline Commit:** 5185190  
**Snapshot Date:** 2026-03-17  
**Status:** Working, Locked

---

## What Is Working Now

### Core Product Flow
| Feature | Status | Evidence |
|---------|--------|----------|
| YouTube video detection | ✅ Working | Content script page URL checks |
| Side panel opening | ✅ Working | `chrome.sidePanel.open()` on video pages |
| Transcript extraction | ✅ Working | Multiple fallback strategies (window, InnerTube, panel) |
| Real-time claim detection | ✅ Working | `analyze-chunk` API with candidate scoring |
| Claim verification | ✅ Working | `verify-claim` API with Google Search grounding |
| Source card display | ✅ Working | React component with status badges |
| Q&A interface | ✅ Working | `ask-video` API with transcript context |
| Model selection | ✅ Working | BYOK + freemium model options |

### Infrastructure
| Component | Status | Evidence |
|-----------|--------|----------|
| Extension build | ✅ Working | Vite + CRXJS, release dist check passes |
| Backend build | ✅ Working | Next.js 16 + Turbopack |
| Session auth | ✅ Working | Bearer token + extension ID whitelist |
| Rate limiting | ✅ Working | In-memory fallback (Redis Edge-incompatible) |
| Error handling | ✅ Working | Classified errors with retry logic |
| State persistence | ✅ Working | chrome.storage.session + chrome.storage.local |

### Data Pipeline
| Stage | Status | Key Files |
|-------|--------|-----------|
| Content extraction | ✅ Working | `src/content/transcript.ts` (lines 1-1500+) |
| Message routing | ✅ Working | `src/background/service-worker.ts` (reducer pattern) |
| API integration | ✅ Working | `src/background/utils/api.ts` (fetchWithBYOK) |
| Claim analysis | ✅ Working | `backend/src/app/api/analyze-chunk/route.ts` |
| Claim verification | ✅ Working | `backend/src/app/api/verify-claim/route.ts` |
| Q&A answering | ✅ Working | `backend/src/app/api/ask-video/route.ts` |

---

## What Is Active But Lightweight

### Deduplication (Session-Local Only)
| Aspect | Implementation | Limitations |
|--------|---------------|-------------|
| Method | 80% character-length ratio | Not token-based, not semantic |
| Window | 120 seconds (2 minutes) | No cross-video memory |
| Normalization | `toLowerCase()` + `/[^a-z0-9]/g` | Simple regex, no stemming |
| Arrays checked | sourceCards, pendingClaims, verificationQueue | Session-local only |
| File | `src/background/service-worker.ts:1040-1083` | No persistent storage |

### Rate Limiting (In-Memory)
| Aspect | Implementation | Limitations |
|--------|---------------|-------------|
| Store | `InMemoryRateLimitStore` | Process-local, not distributed |
| Fallback | Automatic from Redis | Edge runtime incompatibility |
| Buckets | Map with points + window | No persistence across deploys |
| File | `backend/src/lib/rate-limit-store.ts:40-125` | Not production-grade at scale |

### State Management (Redux-like in SW)
| Aspect | Implementation | Notes |
|--------|---------------|-------|
| Pattern | Canonical reducer + dispatch | All state mutations centralized |
| Persistence | chrome.storage | Session + local with quotas |
| Lifecycle | Finite state machine | Video → Transcript → Analysis → Verification |
| File | `src/background/service-worker.ts:200-600` | ~1800 line file, heavily commented |

---

## What Is Deferred / Not Implemented

### Cross-Video Memory
| Feature | Status | Evidence |
|---------|--------|----------|
| Embedding generation | ❌ Not implemented | No API calls to text-embedding models |
| Vector storage | ❌ Not implemented | No vector DB (Pinecone, Weaviate, etc.) |
| Similarity search | ❌ Not implemented | No cosine similarity calculations |
| `similarClaims` population | ❌ Not implemented | Type only, never populated |
| `relatedClaimIds` population | ❌ Not implemented | Type only, never populated |
| Cross-video recall | ❌ Not implemented | Planned for premium tier |

Types exist as placeholders:
- `shared/types.ts:271-293` (embedding, similarClaims, SimilarClaim interface)

### Advanced Deduplication
| Feature | Status | Evidence |
|---------|--------|----------|
| Token-based Jaccard | ❌ Not implemented | No `claimTokenJaccard` function exists |
| `normalizeClaimForDedup` | ❌ Not implemented | Function never existed in codebase |
| Session claim memory | ❌ Not implemented | Only simple 80% heuristic exists |

### Persistent Storage
| Feature | Status | Evidence |
|---------|--------|----------|
| Cross-session claim history | ❌ Not implemented | `allSourceCards` reset per session |
| User preference persistence | ⚠️ Partial | chrome.storage.sync for model selection |
| Analytics/telemetry storage | ❌ Not implemented | Only console logging |

---

## What Is Risky / Fragile

### High Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| YouTube transcript extraction | YouTube changes break extraction | 3 fallback strategies (window, InnerTube, panel) |
| Service Worker state machine | 1800-line file is complex | Reducer pattern, heavy logging, bounded arrays |
| Gemini API quota/availability | Rate limits, downtime | Error classification, retry logic, BYOK fallback |

### Medium Risk
| Component | Risk | Mitigation |
|-----------|------|------------|
| In-memory rate limiting | Not distributed, falls back | Acceptable for current scale |
| Model name drift | Worker/backend mismatch | `normalizeModel()` function |
| Storage quotas | chrome.storage limits | Size enforcement, bounded arrays |

### Low Risk / Technical Debt
| Component | Issue | Impact |
|-----------|-------|--------|
| Type duplication | `shared/types.ts` + `backend/src/types-shared.ts` | Maintenance overhead |
| Test coverage | Some edge cases not covered | Manual testing required |
| Prompt versioning | Prompts in code, not versioned | A/B testing difficult |

---

## File Size Reality Check

| File | Lines | Risk Level |
|------|-------|------------|
| `src/background/service-worker.ts` | ~1800 | 🔴 High - critical, complex |
| `src/content/transcript.ts` | ~1500 | 🔴 High - critical, many fallbacks |
| `backend/src/lib/gemini.ts` | ~850 | 🟡 Medium - provider logic |
| `backend/src/lib/prompts.ts` | ~350 | 🟢 Low - static strings |
| `src/sidepanel/components/CardFeed.tsx` | ~1000 | 🟡 Medium - UI complexity |

---

## API Surface

### Backend Endpoints
| Endpoint | Status | Purpose |
|----------|--------|---------|
| `POST /api/analyze-chunk` | ✅ Working | Extract claims from transcript |
| `POST /api/verify-claim` | ✅ Working | Verify claim with search grounding |
| `POST /api/ask-video` | ✅ Working | Answer user question |
| `POST /api/session/init` | ✅ Working | Issue session token |

### Chrome APIs Used
| API | Purpose |
|-----|---------|
| `chrome.sidePanel` | Open side panel |
| `chrome.storage.local` | Persist cards, settings |
| `chrome.storage.session` | Runtime state |
| `chrome.storage.sync` | User model preference |
| `chrome.runtime` | Messaging, extension lifecycle |
| `chrome.declarativeNetRequest` | Header injection for captions |

---

## Test Status

| Test Suite | Count | Status |
|------------|-------|--------|
| Backend unit tests | 98 | ✅ All passing |
| E2E smoke tests | Unknown | Not run in baseline pass |
| Extension unit tests | None | No test framework configured |

---

## Dependencies (Key)

### Extension
- `react` / `react-dom` ^18.x
- `vite` ^7.x + `@crxjs/vite-plugin`
- `typescript` ^5.x
- `tailwindcss` ^3.x

### Backend
- `next` ^16.x
- `@google/genai` (Gemini API)
- `ioredis` (Redis client - Edge incompatible)
- `vitest` (testing)

---

## Model Configuration

### Allowed Models
| Model | Tier | Status |
|-------|------|--------|
| `gemini-2.5-flash-lite` | Freemium | Default |
| `gemini-3.1-flash-lite` | BYOK | Optional |
| `gemini-3-flash` | BYOK | Optional |

### Model Selection Flow
1. User selects model in UI (saved to chrome.storage.sync)
2. Service worker reads selection
3. Backend enforces tier restrictions (`getEffectiveModel()`)
4. BYOK users can override with custom API key

---

*This snapshot is a factual inventory of the codebase at baseline 5185190. No guesses, no aspirations.*
