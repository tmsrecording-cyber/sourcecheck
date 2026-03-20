# API Contract Analysis
**Scope:** BYOK vs. Freemium paths, error handling consistency

## Endpoint Summary

### POST /api/analyze-chunk

**Headers:**
```
Content-Type: application/json
X-Extension-Id: <extension-id>
Authorization: Bearer <session-token>  # Optional for localhost
X-Custom-Api-Key: <user-api-key>       # BYOK only
X-Custom-Model: <model-name>           # BYOK only (optional)
```

**Request Body:**
```typescript
{
  videoId: string;
  videoTitle: string;
  channelName: string;
  chunks: TranscriptChunk[];
  currentTimestamp: number;
  model?: GeminiModelOption;  # Ignored for freemium, validated for BYOK
}
```

**Model Resolution Logic:**
```typescript
// Route: analyze-chunk/route.ts:665
const effectiveModel = hasCustomKey && headerModel ? headerModel : parsedBody.model;

// Then in gemini.ts:getEffectiveModel()
if (!customApiKey) {
  return FREEMIUM_MODEL;  # Hard lock to gemini-2.5-flash
}
return normalizeModel(requestedModel);
```

**✅ Consistent:** All routes use same pattern.

---

### POST /api/verify-claim

**Headers:** Same as analyze-chunk

**Request Body:**
```typescript
{
  claim: ExtractedClaim;
  videoId: string;
  videoTitle: string;
  channelName: string;
  model?: GeminiModelOption;
  contextTranscript?: string;  # NEW - not in analyze-chunk
}
```

**Model Resolution:** Same pattern (line 438)

**⚠️ Inconsistency Found:** `contextTranscript` field exists here but not in `shared/types.ts` `VerifyClaimRequest` interface?

*Need to verify if this causes runtime issues...*

---

### POST /api/ask-video

**Headers:** Same as analyze-chunk

**Request Body:**
```typescript
{
  question: string;
  videoTitle: string;
  channelName: string;
  currentTime?: number | null;
  transcriptContext: TranscriptChunk[];
  sourceCards: SourceCard[];
  model?: GeminiModelOption;
}
```

**Model Resolution:** Same pattern (line 275)

---

## Error Code Taxonomy

### Backend Error Codes (GeminiErrorCode)
```typescript
// backend/src/lib/gemini.ts
export type GeminiErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'OVERLOADED'
  | 'API_ERROR'
  | 'PARSE_ERROR';
```

### Frontend Error Codes (CanonicalErrorCode)
```typescript
// src/background/utils/api.ts
export type CanonicalErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'INVALID_API_KEY'      # Backend doesn't emit this!
  | 'PROVIDER_OVERLOADED'  # Maps to 'OVERLOADED'
  | 'NETWORK_ERROR'        # Frontend-only
  | 'UPSTREAM_ERROR'       # Frontend-only
  | 'UNKNOWN_ERROR';
```

### ⚠️ Mismatches Found

| Backend | Frontend | Status |
|---------|----------|--------|
| `'OVERLOADED'` | `'PROVIDER_OVERLOADED'` | ⚠️ Different names |
| (none) | `'INVALID_API_KEY'` | ✅ Frontend maps from 401 |
| (none) | `'NETWORK_ERROR'` | ✅ Frontend-only |
| (none) | `'UPSTREAM_ERROR'` | ✅ Frontend-only |

**Root cause:** Frontend classifies errors more granularly than backend emits them. This is by design but creates confusion.

---

## Error Response Shapes

### Backend Error Response
```typescript
// Consistent across all routes
{
  error: string;           # Human-readable message
  errorCode?: string;      # GeminiErrorCode (optional)
  retryable?: boolean;     # Hint for frontend (optional)
}
```

**Status codes used:**
- 400: Validation error
- 401: Auth error (BYOK invalid key)
- 429: Rate limited or quota exhausted
- 500: Server error
- 502: Upstream error
- 503: Overloaded

### Frontend Error Handling
```typescript
// classifyError() in api.ts returns:
{
  code: CanonicalErrorCode;
  message: string;
  retryable: boolean;
  showSettings: boolean;   # UI behavior flag
  clearSession: boolean;   # Session behavior flag
}
```

**✅ Well-designed:** Frontend enriches backend errors with UX context.

---

## BYOK vs. Freemium Path Differences

### Header Behavior

| Header | Freemium | BYOK |
|--------|----------|------|
| `X-Custom-Api-Key` | Absent or empty | Required |
| `X-Custom-Model` | Ignored | Optional (falls back to body) |

### Rate Limiting

| Mode | Rate Limit | Store |
|------|-----------|-------|
| Freemium | Yes (80 pts/min) | Redis or InMemory |
| BYOK | Skipped entirely | N/A |

### Error Messages

**Freemium AUTH_ERROR (500):**
```
"Server configuration error. Contact support."
```

**BYOK AUTH_ERROR (401):**
```
"The supplied Google AI Studio key was rejected. Update it in settings and try again."
```

**✅ Good UX:** Different messages for different contexts.

---

## Cross-Route Consistency Check

### ✅ Consistent
- All three routes check `customApiKey && headerModel` pattern
- All use `getEffectiveModel()` for final resolution
- All return CORS headers via `jsonWithCors()` or manual set
- All validate client secret auth

### ⚠️ Minor Inconsistencies

**1. Header reading style varies:**
```typescript
// analyze-chunk: consistent
const customApiKey = request.headers.get('x-custom-api-key')?.trim();
const headerModel = request.headers.get('x-custom-model')?.trim();

// verify-claim: same (line 292-294)
// ask-video: same (line 212-214)
```
✅ Actually consistent - no issue here.

**2. Error logging granularity:**
```typescript
// analyze-chunk logs model:
logProviderError({
  category,
  route: '/api/analyze-chunk',
  model: body?.model,  # <-- Logs requested model
  ...
});

// verify-claim logs model:
logProviderError({
  category,
  route: '/api/verify-claim',
  model: body?.model,  # <-- Same
  ...
});

// ask-video: same pattern
```
✅ Consistent.

**3. Schema enforcement on retry:**
```typescript
// verify-claim route (lines 504-513):
const retryResult = await askGeminiJSONWithSearch<RawVerification>(
  prompt + '\n\nReturn ONLY valid JSON...',
  1800,
  undefined,  # <-- No schema on retry!
  effectiveModel,
  customApiKey,
  '/api/verify-claim'
);

// analyze-chunk: Does it skip schema on retry?
// ❌ NO RETRY LOGIC in analyze-chunk!
```

⚠️ **verify-claim has retry with no schema, analyze-chunk has no retry.**

---

## Recommendations

### 1. Unify Model Resolution (Low Priority)
Create shared helper:
```typescript
// shared/api-helpers.ts
export function resolveEffectiveModel(
  bodyModel: string | undefined,
  headerModel: string | undefined,
  customApiKey: string | undefined
): GeminiModelOption {
  if (customApiKey && headerModel) {
    return normalizeModel(headerModel);
  }
  if (!customApiKey) {
    return FREEMIUM_MODEL;
  }
  return normalizeModel(bodyModel);
}
```

### 2. Document Error Code Mapping
Add to AGENTS.md:
```markdown
| Backend Error | Frontend Canonical | UX Behavior |
|--------------|-------------------|-------------|
| AUTH_ERROR | AUTH_ERROR | Show settings, clear session |
| QUOTA_EXHAUSTED | QUOTA_EXHAUSTED | Show settings |
| RATE_LIMITED | RATE_LIMITED | Auto-retry with backoff |
| OVERLOADED | PROVIDER_OVERLOADED | Auto-retry |
```

### 3. Add Retry to analyze-chunk (If Needed)
Currently analyze-chunk has no retry logic, while verify-claim does. 
**Question:** Is this intentional? Transient failures in extraction are less critical than verification failures?

---

## Contract Stability

| Aspect | Stability | Notes |
|--------|-----------|-------|
| Request shape | ✅ Stable | No breaking changes |
| Response shape | ✅ Stable | Added optional fields only |
| Error codes | ⚠️ Evolving | New codes added (INVALID_API_KEY) |
| Headers | ✅ Stable | X-Custom-* pattern working |
| Rate limiting | ✅ Stable | BYOK skip is intentional |

---

## Open Questions

1. Should analyze-chunk have retry logic like verify-claim?
2. Should the backend emit 'INVALID_API_KEY' directly instead of frontend inferring?
3. Is the contextTranscript field in verify-claim fully typed in shared types?

**Last verified:** 2026-03-20 02:15 UTC
