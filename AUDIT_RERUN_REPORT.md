# SourceCheck Audit Rerun Report

## 1. EXECUTIVE SUMMARY

The audit identified one high-severity and one medium-severity issue. The most critical finding is a backend authentication vulnerability that allows a non-extension client to mint session tokens, enabling API abuse and quota exhaustion. The second finding is a rate-limiting implementation detail that would cause it to fail open or provide inconsistent protection in a serverless deployment. No secrets were found in build artifacts. Two other potential issues were investigated and found to be false positives. The priority is to fix the authentication vulnerability, then the rate-limiting configuration.

## 2. CONFIRMED FINDINGS

### Finding 1: Backend Auth Bypass via Spoofed Origin

- **Title**: Backend allows non-extension clients to mint session tokens.
- **Severity**: High
- **Confidence**: Confirmed
- **Evidence**: The backend's authorization logic in `isAuthorizedRequest` (`backend/src/proxy.ts`) and `isAllowedOrigin` (`backend/src/lib/cors.ts`) trusts the `Origin` and `X-Extension-Id` headers to identify the client as a valid Chrome extension. These headers can be spoofed by any non-browser client.
- **Exact files/functions**:
  - `backend/src/proxy.ts`: `isAuthorizedRequest`, `isAllowedExtensionOrigin`
  - `backend/src/lib/cors.ts`: `isAllowedOrigin`
  - `backend/src/app/api/session/init/route.ts`: `POST` handler
- **Exploit/failure path**:
  1. Attacker identifies a whitelisted extension ID from the extension's store page or other source.
  2. Attacker crafts a POST request to `/api/session/init` using a tool like `curl`.
  3. Attacker sets the `Origin` header to `chrome-extension://<allowed_extension_id>`.
  4. Attacker sets the `X-Extension-Id` header to `<allowed_extension_id>`.
  5. The backend, trusting the headers, issues a valid session token.
  6. Attacker uses the session token to make authenticated API calls, consuming quota.
- **Real impact**: Denial of service for legitimate users due to quota exhaustion. Potential for other API abuse if the API has destructive capabilities (it currently does not).
- **Minimal fix direction**: Introduce a shared secret between the extension and the backend. The extension would include a hash of this secret in the `/api/session/init` request, which the backend would verify.

### Finding 2: Rate Limiting Degrades in Serverless Environment

- **Title**: Rate limiting falls back to in-memory store in Edge runtime, leading to inconsistent enforcement.
- **Severity**: Medium
- **Confidence**: Confirmed
- **Evidence**: The `RedisRateLimitStore` in `backend/src/lib/rate-limit-store.ts` uses `ioredis`, a Node.js-specific library. API routes that do not explicitly specify the `nodejs` runtime (e.g., `verify-claim`, `ask-video`) will likely run in an Edge environment on platforms like Vercel. In this environment, the `ioredis` import will fail, and the rate limiter will silently fall back to `InMemoryRateLimitStore`. This provides process-local, non-durable rate limiting.
- **Exact files/functions**:
  - `backend/src/lib/rate-limit-store.ts`: `RedisRateLimitStore`, `loadIoRedis`
  - `backend/src/app/api/verify-claim/route.ts`
  - `backend/src/app/api/ask-video/route.ts`
- **Exploit/failure path**:
  1. Backend is deployed to a Vercel-like platform.
  2. Attacker sends a high volume of requests to the `/api/verify-claim` or `/api/ask-video` endpoints.
  3. The requests are distributed across multiple serverless function instances.
  4. Each instance has its own in-memory rate limiter, so the global rate limit is not enforced.
  5. The attacker is able to bypass the intended rate limit.
- **Real impact**: The rate limiting control is significantly weakened, making the backend more susceptible to denial-of-service attacks.
- **Minimal fix direction**: Add `export const runtime = 'nodejs';` to all API route files that utilize rate limiting, ensuring they all run in an environment where Redis is accessible.

## 3. FALSE POSITIVES / NO LONGER APPLICABLE

- **Secrets in Build Artifacts**: The codebase correctly accesses secrets via `process.env`. Searches of the built frontend and backend code found no embedded secret values. The `scripts/check-release-secrets.mjs` script provides an additional control against accidentally packaging `.env` files.
- **Session Token Resilience**: The session token logic in `src/background/utils/api.ts` (specifically `getSessionToken`) includes a retry mechanism. A transient failure to get a token from `/api/session/init` will be retried. The impact of a sticky failure is limited to the user's current session. This is considered minor and not a significant resilience issue at this stage.
- **Manifest/Build Consistency**: The manifest generation in `src/manifest.ts` correctly uses the `VITE_API_BASE` variable to set `host_permissions`. The build process ensures this is set correctly for release builds. The `web_accessible_resources` is explicitly and correctly set to an empty array.

## 4. NEEDS MANUAL VERIFICATION

None at this time. The findings are confirmed from the source code.

## 5. PRIORITY ORDER

1.  **Backend Auth Bypass via Spoofed Origin (High)**: This is the most critical issue and should be addressed first.
2.  **Rate Limiting Degrades in Serverless Environment (Medium)**: This is a significant weakening of a key protection and should be addressed after the auth bypass.
