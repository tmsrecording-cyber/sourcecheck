# SourceCheck Recovery Baseline — 2026-03-17

**Status:** Working, Stable, Baseline Locked  
**Commit:** 5185190  
**Tag:** baseline-2026-03-17-recovery

---

## What Was Broken

1. **Transcript Extraction Failures**
   - YouTube SPA stale state causing transcript fetch to return HTML instead of captions
   - Unicode escape sequences (`\u0026`) in caption URLs causing fetch failures
   - Missing InnerTube API key fallback for transcript extraction
   - Race conditions in transcript batch processing

2. **Claim Detection Pipeline Issues**
   - False positives in claim extraction (vague claims passing through)
   - No candidate ranking by verifiability × value
   - Missing context transcript for verification

3. **Service Worker State Management**
   - Unbounded array growth causing storage quota issues
   - Missing state persistence for transcript recovery
   - Model selection drift between worker and backend

4. **Rate Limiting & Error Handling**
   - Redis incompatibility with Edge runtime
   - Missing quota exhaustion detection
   - Inadequate error classification for retries

---

## What Was Repaired

### Transcript Pipeline (Critical)
- ✅ InnerTube API direct player response fetch (anti-SPA-stale)
- ✅ `ytcfg?.get?.('INNERTUBE_API_KEY')` fallback for transcript extraction
- ✅ Unicode ampersand decode patch (`\u0026` → `&`) in caption track URLs
- ✅ Transcript batch buffering with pending buffer persistence
- ✅ Proper transcript snapshot cleanup on failure

### Claim Quality Improvements
- ✅ Candidate scoring by verifiability × value × speaker_confidence
- ✅ Filter candidates with verifiability < 0.6
- ✅ Context transcript gathering (30s window) for verification
- ✅ Trust guard for unverifiable claims (no false certainty)

### Service Worker Hardening
- ✅ Worker runtime state reducer with canonical lifecycle
- ✅ Bounded arrays (MAX_SOURCE_CARDS=20, MAX_PENDING_CLAIMS=100, MAX_VERIFICATION_QUEUE=50)
- ✅ Storage quota protection (4MB local, 512KB session limits)
- ✅ Model sync/persistence via MODEL_CHANGED + chrome.storage.sync
- ✅ Unified error classification with retry logic

### Backend Reliability
- ✅ Graceful degradation to in-memory rate limiting
- ✅ Provider error classification (RATE_LIMITED, QUOTA_EXHAUSTED, OVERLOADED, AUTH_ERROR)
- ✅ Session token authentication for production
- ✅ BYOK (Bring Your Own Key) support

---

## What Is Now Confirmed Working

### Core Functionality
- ✅ YouTube video detection and panel opening
- ✅ Transcript extraction (multiple fallback strategies)
- ✅ Real-time claim detection from transcript
- ✅ Claim verification with web search grounding
- ✅ Source card display in side panel
- ✅ Q&A interface with transcript context

### Build & Test Gates
- ✅ Extension build: `npm run build` → Release dist check passed
- ✅ Backend build: `npm run build` (Next.js 16 + Turbopack)
- ✅ Backend tests: 98 tests passing
- ✅ TypeScript: `tsc --noEmit` clean on both extension and backend

### Data Flow
- ✅ Content script → Service Worker message passing
- ✅ Service Worker → Backend API calls with session auth
- ✅ State persistence to chrome.storage
- ✅ Error telemetry and logging

---

## What Is Still Intentionally Deferred

### Not Implemented (Planned for Future)
1. **Embedding-based Cross-Video Memory**
   - Type placeholders exist (`embedding?: number[]`, `similarClaims`)
   - No vector generation or similarity search implemented
   - Planned for premium tier

2. **Persistent Claim History**
   - Current deduplication is session-local only (80% length heuristic)
   - No cross-session claim recall

3. **Advanced Rate Limiting**
   - Redis implementation exists but Edge-incompatible
   - Currently using in-memory fallback

4. **Live Monitoring Quality Enhancements**
   - Speaker diarization
   - Better entity co-reference across chunks
   - Claim chaining for multi-part arguments

---

## Gates That Must Pass Before Any Release

```bash
# Extension
cd /Users/mj/Desktop/SourceCheck
npm run build                    # Must pass release dist check

# Backend
cd /Users/mj/Desktop/SourceCheck/backend
npm run build                    # Must compile without errors
npm test                         # All 98 tests must pass

# Type Check (both)
npx tsc --noEmit                 # Must be clean
```

---

## Next Recommended Product Pass

**Recommended:** Claim Quality / Extraction Precision

**Rationale:**
1. Current system is stable but claim precision is the biggest user-visible quality issue
2. False positives still slip through (vague claims, opinions)
3. High-value STEM claims sometimes missed
4. Better extraction = better user trust

**Scope:**
- Improve EXTRACTION_SYSTEM_PROMPT specificity
- Better candidate ranking for STEM vs opinion content
- Claim de-duplication improvements (token-based vs current 80% length heuristic)
- Add speaker attribution where possible

**Avoid:**
- UI polish (save for later)
- Architecture changes
- New features (memory, embeddings)
- Package/config changes

---

## Recovery Instructions

If you need to return to this baseline:

```bash
git checkout baseline-2026-03-17-recovery

# Verify gates
npm run build
cd backend && npm run build && npm test
```

---

*This baseline represents the working state after the 2-day recovery pass. Do not modify without creating a new safety checkpoint first.*
