# Type Drift Analysis
**Status:** 🔴 CRITICAL - Requires Immediate Sync

## Summary
The `AVAILABLE_MODELS` constant is defined in two files with **inconsistent values**:
- `shared/types.ts` (extension source of truth)
- `backend/src/types-shared.ts` (backend source of truth)

This creates UI/runtime mismatches and maintenance burden.

---

## Detailed Diff

### Field: `ModelConfig.speed`

| Model | shared/types.ts | backend/src/types-shared.ts |
|-------|----------------|----------------------------|
| gemini-3.1-flash-lite-preview | `'standard'` | `'fast'` |
| gemini-3-flash-preview | `'deep'` | `'balanced'` |
| gemini-2.5-flash | `'standard'` | `'deep'` |

**Impact:** UI speed badges show different labels depending on which bundle loads the type.

---

### Field: `ModelConfig.label`

| Model | shared/types.ts | backend/src/types-shared.ts |
|-------|----------------|----------------------------|
| gemini-2.5-flash | `'Flash 2.5'` | `'Flash 2.5 Lite'` |

**Impact:** Backend thinks the model is "Lite" variant, extension doesn't.

---

### Field: `ModelConfig.description`

| Model | shared/types.ts | backend/src/types-shared.ts |
|-------|----------------|----------------------------|
| gemini-3-flash-preview | `'Most capable'` | `'Balanced quality'` |

**Impact:** Different user-facing descriptions.

---

### Missing Fields (backend is behind)

**shared/types.ts has these, backend/src/types-shared.ts does NOT:**

1. `ExtractedClaim.embedding?: number[]` - Semantic embedding for cross-video memory
2. `TranscriptFetchDebugEntry.step: 'fetch_aborted'` - Missing step value
3. `ProviderErrorState` interface - Missing entirely
4. `PanelSessionState.lastProviderError` - Missing field
5. `WorkerRuntimeState.lastProviderError` - Missing field

**Impact:** Backend types are stale and missing features implemented in the extension.

---

## Root Cause

The backend file was created as a copy but not kept in sync. Looking at imports:

```typescript
// backend/src/lib/gemini.ts
import { ALLOWED_MODELS, FREEMIUM_MODEL, ... } from '../types-shared';

// src/background/service-worker.ts
import { ... } from '../../shared/types';
```

Both import from "their own" copy, so changes to one don't affect the other.

---

## Sync Strategy Options

### Option 1: Single Source of Truth (Recommended)
Delete `backend/src/types-shared.ts`, have backend import from `shared/types.ts`.

**Pros:**
- Single file to maintain
- No drift possible

**Cons:**
- Requires build system to handle `../../shared/` imports in backend
- May need tsconfig path alias

### Option 2: Build-time Sync
Use a pre-commit hook or build script to copy/sync the files.

**Pros:**
- Keeps current structure
- Automated enforcement

**Cons:**
- More tooling complexity
- Easy to forget/misconfigure

### Option 3: Manual Sync Now + Lint Rule
Sync manually, add a CI check to prevent future drift.

**Pros:**
- Immediate fix
- Low tooling overhead

**Cons:**
- Relies on humans remembering

---

## Recommended Fix (Option 1 + Option 3 hybrid)

### Step 1: Update backend tsconfig.json
Add path alias to resolve shared types:
```json
{
  "compilerOptions": {
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  }
}
```

### Step 2: Update backend imports
Change all `../types-shared` imports to `@shared/types`.

### Step 3: Delete backend/src/types-shared.ts
Remove the duplicate file entirely.

### Step 4: Add CI check
```bash
# Fail build if files are not in sync
if ! diff -q shared/types.ts backend/src/types-shared.ts; then
  echo "ERROR: Type files are out of sync!"
  exit 1
fi
```

---

## Verification Checklist

After sync, verify:
- [ ] `AVAILABLE_MODELS` has identical content in both locations
- [ ] `speed` values are consistent
- [ ] `embedding` field exists in `ExtractedClaim`
- [ ] `ProviderErrorState` interface exists
- [ ] All backend imports resolve correctly
- [ ] Extension builds without type errors
- [ ] Backend builds without type errors

---

## Current Status

**Last verified:** 2026-03-20 02:10 UTC

The drift is actively growing as the other agent adds new features (ProviderErrorState). 

**Action needed before next backend deployment.**
