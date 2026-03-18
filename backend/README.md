# SourceCheck Backend — Quick Setup

## 1. Install dependencies
```bash
cd backend
npm install
```

## 2. Set up environment
```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

To try Gemini 2.5 Pro, add this line to `.env.local` and restart the backend:

```bash
GEMINI_MODEL=gemini-2.5-pro
```

If `GEMINI_MODEL` is unset, the backend falls back to the current fast default in code.

If you deploy the backend anywhere other than `localhost`, set:

- `ALLOWED_EXTENSION_IDS` (comma-separated list of permitted extension IDs)
- `SESSION_SECRET` (enables backend-issued bearer session tokens)
- `REDIS_URL` (recommended for durable rate limits across restarts/instances)
- `TRUSTED_PROXY_COUNT` (number of trusted proxy hops; required for accurate per-IP rate limiting behind CDNs/proxies)

The extension must be built with `VITE_API_BASE` pointing at the deployed API origin so the
manifest `host_permissions` line up with runtime requests.

Session auth flow (production):

1. Extension calls `POST /api/session/init` with `X-Extension-Id` and `{ extensionId }`.
2. Backend returns `{ token }` signed with `SESSION_SECRET`.
3. Extension includes `Authorization: Bearer <token>` on subsequent API calls.

Local dev notes:

- On `localhost`, requests can run without a token when `SESSION_SECRET` is unset.
- When `SESSION_SECRET` is set, localhost requests also require a bearer token (except `/api/session/init`).

## 3. Run the dev server
```bash
npm run dev
# Server starts at http://localhost:3000
```

For the extension, copy the root `.env.example` to `.env` and set `VITE_API_BASE`
before running `npm run build`.

## 4. Test the pipeline (before wiring to the extension)
```bash
npm run test:pipeline
# Sends a fake Huberman transcript through the full pipeline
# You should see claims extracted and source cards generated
```

## 5. Deploy to Vercel
```bash
npx vercel
# Follow the prompts, add your env vars in the Vercel dashboard
```

## File Overview

```
src/
├── app/api/
│   ├── analyze-chunk/route.ts   ← Claim extraction endpoint
│   ├── ask-video/route.ts       ← Video Q&A endpoint
│   └── verify-claim/route.ts    ← Source card generation endpoint
├── lib/
│   ├── gemini.ts                ← Gemini API wrapper
│   ├── prompts.ts               ← ALL prompts (core IP, don't scatter)
│   └── observability.ts         ← Structured telemetry logging
├── proxy.ts                      ← CORS + request gating for the extension
scripts/
└── test-pipeline.ts             ← Test without the extension
shared/
└── types.ts                     ← Types shared with extension
```

## Observability

The backend includes a minimal, privacy-conscious observability layer in `src/lib/observability.ts`.

### What is logged

Structured events are logged to console for critical failure paths:
- `session_init_failure` — Session token issuance failures
- `route_failure` — API route failures (auth, rate limit, validation)
- `provider_error` — Gemini/BYOK provider errors (auth, quota, rate limit, parse errors)

### What is NOT logged

- No transcript text
- No user questions
- No API keys or tokens
- No raw signed URLs
- No PII or user behavior analytics

### Log format

Events are logged as structured JSON prefixed with `[sourcecheck.telemetry]`:

```json
{
  "name": "route_failure",
  "timestamp": 1712345678901,
  "route": "/api/verify-claim",
  "category": "rate_limited",
  "statusCode": 429,
  "retryable": true,
  "context": "retryAfter=60"
}
```

### Failure categories

- `auth_error` — Authentication/authorization failures
- `quota_exhausted` — Provider API quota exhausted
- `rate_limited` — Rate limit hit (server or provider)
- `upstream_timeout` — Provider timeout/overloaded
- `upstream_error` — Provider API error
- `upstream_parse_error` — Failed to parse provider response
- `internal_error` — Internal server error
- `validation_error` — Request validation failed

### Viewing logs

In development, logs appear in the terminal. On Vercel, view function logs in the dashboard.
