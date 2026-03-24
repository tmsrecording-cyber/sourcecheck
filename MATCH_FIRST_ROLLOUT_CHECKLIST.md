# Match-First Rollout Checklist

## Purpose
This checklist covers deployment and post-deploy validation for the current SourceCheck match-first verification system.

It assumes the following slices are already implemented:
- canonical claim normalization
- internal truth-aware reuse
- ClaimReview / Fact Check Tools lookup
- short-TTL public verify cache
- conflict resolver V0
- same-video duplicate clustering
- sidepanel provenance mapping
- backend + worker observability

## Required env vars

### Backend required
- `GEMINI_API_KEY`
- `SESSION_SECRET`
- `ALLOWED_EXTENSION_IDS`

### Backend optional but important
- `FACT_CHECK_TOOLS_API_KEY`
- `FACT_CHECK_TOOLS_TIMEOUT_MS`
- `VERIFY_CLAIM_CACHE_TTL_MS`
- `DEBUG_TOKEN`
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or `REDIS_URL`

## Pre-deploy gates
- `npm run typecheck`
- `npm run build`
- `npm --prefix backend run build`
- `npm --prefix backend test`
- targeted UI/unit suites should already be green if local changes touched:
  - provenance UI
  - worker clustering
  - runtime debug metrics

## Deploy order
1. deploy backend
2. verify backend health
3. rebuild/reload extension against the deployed backend
4. validate sidepanel debug mode and backend debug endpoints

## Backend smoke checks

### Health
- `GET /health`
- expect:
  - `status: "ok"`
  - recent timestamp

### Telemetry debug
- dev:
  - `GET /api/debug/telemetry`
- non-dev:
  - `GET /api/debug/telemetry?token=<DEBUG_TOKEN>`

Expect:
- `counts`
- `events`
- no transcript text or other sensitive payloads

### Parse debug
- dev:
  - `GET /api/debug/parse-errors`
- non-dev:
  - `GET /api/debug/parse-errors?token=<DEBUG_TOKEN>`

Use this only for parser reliability debugging.

## Sidepanel validation

Open the sidepanel with:
- `?debug=1`

Validate:
- verification metrics panel is visible
- resolution path counts move as cards resolve
- cluster suppression count increases on repeated same-video claims
- conflict surfaced count increases when a strong prior disagreement is present

## Provenance validation

Check that cards use the correct labels:
- `Earlier in this video`
- `Seen before`
- `Previously fact-checked`
- `Related claim`
- `Verified live`

Rules:
- same-video repeats must not look like cross-video memory
- live-grounded cards with related prior context must not say `Seen before`
- ClaimReview matches must read as `Previously fact-checked`

## Match-path success signals

After deployment, inspect `/api/debug/telemetry` and Vercel logs for:

### Good signals
- `verification_resolution` events appear regularly
- `cached_exact` occurs on repeated public claims
- `claimreview_match` appears on known public claims
- `live_grounded` remains available for real misses
- `fallback` stays rare
- conflict events are present but uncommon

### Worker-side good signals
- `resolutionPathCounts` in sidepanel debug mode are non-zero
- `clusterSuppressions` increases in dense videos
- `verifyConflictSurfaced` is usually low but not impossible

## Failure signals

Investigate if you see:
- almost everything resolving as `live_grounded`
  - likely ClaimReview miss path, low reuse rate, or poor canonicalization
- frequent `fallback`
  - provider instability or verification retries exhausting
- no `claimreview_match` even on obvious public fact-checked claims
  - missing `FACT_CHECK_TOOLS_API_KEY`
  - API timeout too low
  - matching too strict
- no `cached_exact` over repeated usage
  - internal memory lookup or reuse gate issue
- no cluster suppressions in dense videos
  - same-video clustering regression

## First post-deploy review

Review these questions with real data:
1. What share of verify results are `cached_exact`, `claimreview_match`, `live_grounded`, `fallback`?
2. Are verify latencies improving on repeated claims?
3. Are ClaimReview hits meaningful or mostly stale/context-only?
4. Are cluster suppressions reducing noisy repeated cards?
5. Are conflict downgrades rare and explainable?

## If rollout looks healthy
Next likely refinement options:
1. tune quantity/time matching further from real misses
2. tighten ClaimReview query strategy
3. improve dashboard/debug surfacing
4. only then consider deeper fresh-verification decomposition
