# Checkpoint: transcript-pipeline-recovery-working

## Active Transcript Fixes Now Present

1. **INNERTUBE_API_KEY fallback** (`src/content/transcript.ts:619-631`)
   - Multiple extraction paths: `ytcfg?.get`, `yt.config_`, `ytcfg.data_`
   - Validates key starts with 'AIza' before use

2. **InnerTube API direct fetch** (`src/content/transcript.ts:642-691`)
   - Bypasses stale ytInitialPlayerResponse on SPA navigation
   - Uses proper X-Youtube-Client headers

3. **Unicode ampersand decode** (`src/content/transcript.ts:891-897`)
   - Fixes `\u0026` → `&` and `\` → `"` in caption track baseUrl

4. **DNR/Header injection** (`src/manifest.ts`, `src/background/providers/`)
   - Declarative Net Request rules for caption fetch headers

5. **Anti-bot fetch headers** (`src/content/transcript.ts:656-679`)
   - Proper Content-Type, X-Youtube-Client-Name/Version headers

## Model Sync/Persistence Fix Present

1. **Worker** (`src/background/service-worker.ts:184`)
   - `INITIAL_RUNTIME_STATE.selectedModel = 'gemini-3.1-flash-lite'`
   - `MODEL_CHANGED` handler persists to `chrome.storage.sync` (line 2020-2027)
   - Hydration restores from session + sync storage (line 1186, 1232-1234)

2. **UI** (`src/sidepanel/App.tsx:95-107`)
   - Syncs from runtimeState.selectedModel
   - Persists to sync storage on change
   - Sends MODEL_CHANGED message to worker

3. **Backend** (`backend/src/lib/gemini.ts:2,543-567`)
   - `FREEMIUM_MODEL = 'gemini-2.5-flash'` (synced with worker via shared types)
   - `ALLOWED_MODELS` whitelist security check
   - Dynamic model selection from client requests

## Exact Files Recently Touched

```
src/content/transcript.ts              # INNERTUBE_API_KEY, unicode fix
src/background/service-worker.ts       # Model persistence, reducer, hydration
src/sidepanel/App.tsx                  # Model picker integration
src/sidepanel/components/ModelPicker.tsx # Model selection UI
backend/src/lib/gemini.ts              # Model whitelist, parsing fixes
backend/src/app/api/analyze-chunk/route.ts   # Model pass-through
backend/src/app/api/verify-claim/route.ts    # Model pass-through
backend/src/app/api/ask-video/route.ts       # Model pass-through
shared/types.ts                        # Model types, WorkerRuntimeState
src/manifest.ts                        # DNR rules
```

## Known Unverified Risks Still Remaining

| Risk | Location | Impact | Verification Plan |
|------|----------|--------|-------------------|
| Model default drift | Worker vs Backend defaults differ | Model mismatch UI vs API | Test case #7 |
| MODEL_CHANGED persistence | service-worker.ts:2020-2027 | Model not persisting across reloads | Test case #7 |
| Transcript snapshot logic | service-worker.ts:766-782 | Stale transcript on video switch | Test case #4, #5 |
| Runtime state hydration | service-worker.ts:1173-1294 | State corruption on extension restart | Test case #5 |
| Dead helpers | gemini.ts various | Code bloat | Post-test audit |
| Duplicate constants | Multiple files | Maintenance burden | Post-test audit |

## Test Status

- [ ] Test matrix executed
- [ ] Failures captured
- [ ] Fixes applied
- [ ] Cleanup completed

## Pass/FAIL Gate

PASS only when:
- 8-case matrix executed with evidence
- Model selection consistent across UI/worker/persistence/backend
- Transcript path works on normal + auto-captioned videos
- Seek/switch/reload do not corrupt state
