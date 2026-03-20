# Full System Sweep Findings

## Summary

Completed a comprehensive sweep of the entire codebase looking for bugs, type mismatches, and funky patterns. Found **6 confirmed bugs**, **2 type drift issues**, and **2 code quality issues**.

---

## 🔴 CONFIRMED BUGS (Need Fixing)

### 1. Trust Guard Overrides "partial" to "unverifiable" (MISMATCH WITH PROMPT)

**Location:** `backend/src/app/api/verify-claim/route.ts` lines 584-588

**Issue:** The Trust Guard forces status to 'unverifiable' when `hasQualityGrounding` is false (no URL extracted), BUT the prompt explicitly allows "partial" for canonical facts with weak sources.

**Code:**
```typescript
const hasQualityGrounding = bestSourceUrl !== '';
const status: VerificationStatus = hasQualityGrounding ? parsedStatus : 'unverifiable';
```

**Prompt says:** (lines 265-271 of prompts.ts)
> "partial": directionally true but the specifics are off, missing context, OR the claim is widely reported but primary source is unclear
> CRITICAL: Use "partial" liberally. If the claim is commonly discussed but you can't find the exact statistic, use "partial"

**Impact:** Canonical facts that the model correctly identifies as "partial" get downgraded to "unverifiable", confusing users.

**Fix Options:**
- Option A: Remove the Trust Guard override entirely and trust the model
- Option B: Only override "supported" → "partial", preserve "partial" as-is
- Option C: Only apply override when category is NOT 'needs_primary_source'

---

### 2. TranscriptFetchFailureReason Missing 'fetch_aborted'

**Location:** `src/content/transcript.ts` lines 254-270

**Issue:** The type definition doesn't include 'fetch_aborted' as a valid failure reason, but the code at line 2184 emits this step.

**Current Type:**
```typescript
type TranscriptFetchFailureReason = Extract<
  TranscriptDebugReason,
  | 'fetch-failed'
  | 'fetch-non-ok'
  | ...
  // MISSING: 'fetch_aborted'
>;
```

**Impact:** Type safety hole - if someone tries to handle 'fetch_aborted' as a failure reason, TypeScript will complain.

**Fix:** Add 'fetch_aborted' to the Extract union.

---

### 3. Type Drift: shared/types.ts vs backend/src/types-shared.ts

**Location:** Both files claim to be synchronized but have drifted

**Issues Found:**

| Field | shared/types.ts | backend/src/types-shared.ts |
|-------|-----------------|---------------------------|
| AVAILABLE_MODELS order | gemini-2.5-flash first | Different order |
| Speed values | 'fast'/'standard'/'quality' | 'fast'/'balanced'/'quality' |
| Model descriptions | "Balanced speed & accuracy" | "Standard quality" |
| ProviderErrorState interface | ✅ Present | ❌ MISSING |
| embedding in ExtractedClaim | ✅ Present | ❌ MISSING |
| lastProviderError in PanelSessionState | ✅ Present | ❌ MISSING |
| TranscriptFetchDebugEntry 'fetch_aborted' | ✅ Present | ❌ MISSING |

**Impact:** Runtime errors possible if backend expects different shapes than frontend sends. Type checking passes but actual behavior differs.

**Fix:** Run the sync script or manually copy shared/types.ts → backend/src/types-shared.ts

---

### 4. Missing Debug Fields in bestFailure (lines 2086-2095, 2139-2148)

**Location:** `src/content/transcript.ts` lines 2086-2095 and 2139-2148

**Issue:** Some failure objects don't include the debug fields (`lastStatus`, `lastContentType`, `lastBodyLength`) even when they're available in scope.

**Example at line 2086:**
```typescript
const failure: TranscriptFetchAttemptResult = {
  chunks: null,
  reason: 'parse-threw',
  format: candidate.format,
  detail: `parse-threw: ${...}`,
  // MISSING: lastStatus, lastContentType, lastBodyLength
};
```

**Impact:** Incomplete debug information when parse errors occur.

**Fix:** Add the debug fields where available.

---

### 5. bestFailure Update Missing in catch Block (lines 2150-2175)

**Location:** `src/content/transcript.ts` lines 2150-2175

**Issue:** The outer catch block doesn't update `bestFailure` before continuing, losing error context.

**Code:**
```typescript
catch (error) {  // Line 2150 - outer catch
  // ... logging ...
  bestFailure = getFailurePriority('parse-error') >= ...  // Line 2166
    ? { chunks: null, reason: 'parse-error', format, detail }
    : bestFailure;  // Keeps old bestFailure even on lower priority!
  // The fallback to bestFailure when priority is lower loses the current error
}
```

**Impact:** If a parse error has lower priority than current bestFailure, the error details are lost.

**Fix:** Always capture the error, only compare for returning the "best" one.

---

### 6. Race Condition in Verification Queue (from earlier audit)

**Location:** `src/background/service-worker.ts` verification queue processing

**Issue:** Multiple claims can be verified in parallel with overlapping ranges, potentially causing duplicate API calls for the same claim text.

**Impact:** Wasted API quota, potential race conditions in state updates.

**Fix:** Add deduplication check before processing each claim.

---

## 🟡 TYPE DRIFT ISSUES

### 7. ALLOWED_MODELS Constant Redundancy

**Location:** Multiple files define similar model lists

**Files:**
- `shared/types.ts`: `ALLOWED_MODELS`, `AVAILABLE_MODELS`
- `backend/src/types-shared.ts`: `ALLOWED_MODELS` (out of sync)
- `src/background/providers/types.ts`: `GEMINI_MODELS`

**Issue:** Three different places to update when adding a new model. Easy to miss one.

**Fix:** Consolidate to single source of truth in shared/types.ts, re-export elsewhere.

---

### 8. ProviderError Type Mismatch Between Extension and Backend

**Location:** Extension vs Backend error handling

**Extension (`src/background/providers/types.ts`):**
```typescript
export type ProviderErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'NOT_SUPPORTED';
```

**Backend (`backend/src/lib/gemini.ts`):**
```typescript
export type GeminiErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'API_ERROR'
  | 'PARSE_ERROR'
  | 'QUOTA_EXHAUSTED'
  | 'UNKNOWN_ERROR';
```

**Issue:** Different error codes between frontend and backend. Backend sends 'QUOTA_EXHAUSTED' but extension doesn't define it in ProviderErrorCode.

**Impact:** Error classification may fail for quota exhaustion.

**Fix:** Sync error codes between frontend and backend.

---

## 🔵 CODE QUALITY ISSUES

### 9. Duplicate Error Classification Logic

**Location:** 
- `src/background/utils/api.ts`: `classifyError()` function
- `src/background/service-worker.ts`: Inline error classification

**Issue:** Error classification logic is duplicated and may drift.

**Fix:** Consolidate to single utility function.

---

### 10. Debug Console.log Statements in Production Code

**Location:** `src/content/transcript.ts` (multiple locations)

**Pattern:** Lines like:
```typescript
console.log(`[SourceCheck][HARD DEBUG] Transcript fetch:`, {...});
console.log(`[SourceCheck][TRACK DEBUG] ...`);
```

**Issue:** These log on every transcript fetch, potentially spamming the console.

**Impact:** Performance and noise in production.

**Fix:** Gate behind debug flags or remove for production builds.

---

## 📊 Severity Summary

| Severity | Count | Issues |
|----------|-------|--------|
| 🔴 High | 2 | #1 (Trust Guard), #3 (Type Drift) |
| 🟡 Medium | 4 | #2, #4, #5, #8 |
| 🔵 Low | 4 | #6, #7, #9, #10 |

---

## 🎯 Recommended Priority Order

1. **Fix #1 (Trust Guard)** - User-facing bug affecting canonical fact display
2. **Fix #3 (Type Drift)** - Prevents runtime errors
3. **Fix #8 (Error Codes)** - Ensures proper error handling
4. **Fix #2 (fetch_aborted type)** - Type safety
5. **Fix #4, #5 (bestFailure)** - Better debugging
6. **Fix #6 (Race Condition)** - Efficiency
7. **Fix #7, #9, #10** - Code quality

---

## Files Requiring Changes

### High Priority
- `backend/src/app/api/verify-claim/route.ts`
- `backend/src/types-shared.ts`
- `shared/types.ts`

### Medium Priority  
- `src/content/transcript.ts`
- `src/background/providers/types.ts`
- `backend/src/lib/gemini.ts`

### Low Priority
- `src/background/service-worker.ts`
- `src/background/utils/api.ts`
