# SourceCheck Pre-Flight Audit Report (MV3 Extension + Next.js Backend)

Generated: 2026-03-16 (America/Los_Angeles)  
Repo state: `git rev-parse --short HEAD` = `72c06b3` (worktree is dirty)  
Scope: `src/` + `dist/` (Chrome extension), `backend/` (Next.js API proxy), `shared/` (types). `node_modules/` excluded.

This report is intentionally ruthless and prioritized for a Chrome Web Store launch.

## Executive Summary (Read This First)

You have multiple launch blockers across both the extension package (`dist/`) and the backend.

Top blockers:

1. Backend does not build: `backend/src/lib/gemini.ts` defines `DEFAULT_MODEL` twice, causing Next.js build failure.
2. Release package is not shippable: `dist/` currently contains `http://localhost:3000` and requests `http://localhost:3000/*` host permission.
3. Extension side panel loads remote Google Fonts via `@import` which will be blocked by MV3 CSP and is a Web Store review risk.
4. The shipped `dist` content-script bundle contains a hard-coded `AIza…` key-like string (YouTube InnerTube key), indicating the artifact is stale/out-of-sync and raising “key leak” red flags.
5. Backend “extension-only” trust is spoofable: any non-extension client can mint session tokens by providing the public extension ID.
6. Production-grade rate limiting is not solved: the Redis rate-limit store uses `ioredis`, which is not Edge runtime compatible (middleware runs on Edge). In-memory limiting won’t hold under real-world abuse/scale.

## High (Launch Blockers)

### H1) Backend Fails To Build (Duplicate `DEFAULT_MODEL`)

Pillars: Security & Financial Hardening, Stability  
Impact: Backend cannot deploy; all API calls are dead.

Evidence:

- `npm --prefix backend run build` fails with: “the name `DEFAULT_MODEL` is defined multiple times”.
- `backend/src/lib/gemini.ts:1` defines `const DEFAULT_MODEL = 'gemini-3-flash-preview';`
- `backend/src/lib/gemini.ts:548` defines `const DEFAULT_MODEL = 'gemini-3.1-flash-lite';`

Notes:

- This also makes model allowlisting ambiguous (two “defaults” and mixed model inventories in the same file).

---

### H2) `dist/` Contains Localhost URLs and Requests Localhost Host Permissions

Pillars: Chrome Web Store Compliance, Security & Financial Hardening  
Impact: Store submission risk and runtime breakage (extension will try to call `localhost` for API).

Evidence:

- Release gate script fails: `npm run check:dist-release` reports:
  - `dist/assets/service-worker.ts-ORCfz_Bh.js` contains `http://localhost`
  - `dist/manifest.json` contains `http://localhost`
- `dist/manifest.json:10-13` includes:
  - `host_permissions: ["https://www.youtube.com/*", "http://localhost:3000/*"]`
- `dist/assets/service-worker.ts-ORCfz_Bh.js:1` includes `http://localhost:3000`.
- Source of behavior: `src/config.ts:1-25` allows localhost when building with `--mode development`.

Notes:

- If you accidentally ship this `dist/` zip, reviewers will see dev host permissions and you will also break all non-dev installs.

---

### H3) Remote Google Fonts Import in Extension UI (MV3 CSP / Remote Resource Risk)

Pillars: Chrome Web Store Compliance, Stability  
Impact: Fonts will not load under MV3 default CSP; can trigger review scrutiny for remote resources; creates noisy console CSP violations.

Evidence:

- `src/sidepanel/styles/globals.css:1`:
  - `@import url('https://fonts.googleapis.com/css2?...')`
- Built artifact ships the same:
  - `dist/assets/sidepanel-q11ybzTJ.css:1` includes `@import "https://fonts.googleapis.com/..."`
- `dist/manifest.json` does not define `content_security_policy`, so extension pages use the MV3 default (`script-src 'self'; object-src 'self'`), which blocks remote style/font loads.

---

### H4) API Key-Like String Shipped in Client Bundle (`dist`), and `dist` Is Out Of Sync With `src`

Pillars: Security & Financial Hardening, Chrome Web Store Compliance  
Impact: Key leak red flag in store review; operational fragility (key may be revoked); indicates you are not shipping what you think you are shipping.

Evidence:

- `dist/assets/index.ts-DHVdTxUW.js:2` contains:
  - `AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`
- Current source does **not** hardcode a key and instead extracts from YouTube page config:
  - `src/content/transcript.ts:623-641` reads `INNERTUBE_API_KEY` from `window.yt.config_` / `ytcfg.data_` and fails closed if missing.
- `rg "AIza" src` returns no matches, but `rg "AIza" dist` matches the key above.

Notes:

- Even if this is “just a YouTube InnerTube key”, it looks exactly like a Google API key leak and is not something you want in a Web Store submission.

---

### H5) Backend “Extension-Only” Auth Can Be Spoofed (Session Tokens Minted by Anyone Who Knows the Extension ID)

Pillars: Security & Financial Hardening (Wallet Check)  
Impact: Anyone can mint valid session tokens and burn your Gemini quota; CORS does not protect against non-browser clients; extension ID is public once listed.

Evidence:

- Middleware treats requests with **no** `Origin` but with `X-Extension-Id` as extension service-worker requests:
  - `backend/src/proxy.ts:205-210`
- Service-worker authorization path trusts `extensionId` allowlist + bearer token (and session/init is token-issuance point):
  - `backend/src/proxy.ts:245-265`
- Token issuance endpoint accepts `extensionId` in JSON body and returns a signed token:
  - `backend/src/app/api/session/init/route.ts:13-33`
- Extension service worker requests a token using only the public `chrome.runtime.id`:
  - `src/background/service-worker.ts:453-463`

Why this matters:

- A curl script can set `X-Extension-Id: <your_extension_id>` and call `/api/session/init`, then call the other API routes with the returned bearer token.

---

### H6) Durable Rate Limiting Is Not Actually Deployable (Redis Adapter Uses `ioredis` in Edge Middleware)

Pillars: Security & Financial Hardening (Wallet Check)  
Impact: If you set `REDIS_URL` expecting production-grade limits, the middleware is likely to fail at runtime (Edge runtime incompatibility). If you do not set it, in-memory limits are trivial to bypass at scale.

Evidence:

- Rate limit store attempts to use `ioredis` (Node-centric client):
  - `backend/src/lib/rate-limit-store.ts:5-7` explicitly notes Edge incompatibility.
  - `backend/src/lib/rate-limit-store.ts:141-154` dynamically imports `ioredis`.
- Proxy middleware uses this store:
  - `backend/src/proxy.ts:37-46` chooses Redis store when `REDIS_URL` is set.
  - `backend/middleware.ts:1-6` installs proxy as Next.js middleware (Edge runtime).

Notes:

- Middleware is Edge runtime in Next.js. TCP socket Redis clients typically do not work there. You need an Edge-compatible store (HTTP-based Redis/KV) or move rate limiting to a Node runtime boundary.

## Medium (Fix Before Scaling)

### M1) Session Token Acquisition Can “Sticky-Fail” Until the Service Worker Restarts

Pillars: Stability  
Impact: One transient `/api/session/init` failure can permanently disable tokens for the rest of the browser session; may cause all subsequent API calls to 403 in production.

Evidence:

- `src/background/service-worker.ts:431-485` caches token.
- On failure it sets `cachedSessionToken = ''` and never retries:
  - `src/background/service-worker.ts:479-480`

---

### M2) Privacy Policy Storage Lifecycle Mismatches Actual Chrome Storage Semantics

Pillars: Chrome Web Store Compliance (Privacy), Stability  
Impact: Your privacy policy could be rejected or create user trust issues if it contradicts behavior.

Evidence:

- Privacy policy claims:
  - `PRIVACY.md:27-29` says `chrome.storage.session` is cleared when “Browser tab is closed”.
- Actual code / Chrome semantics:
  - Service worker comment: `src/background/service-worker.ts:423-425` says session is cleared when the **browser closes**.
  - Transcript is persisted in `chrome.storage.local`:
    - `src/background/service-worker.ts:766-781`
  - `chrome.storage.sync` is used for model selection:
    - `src/sidepanel/App.tsx:270`
    - `src/background/service-worker.ts:2016`

Notes:

- `chrome.storage.local` can persist across browser restarts. If a tab closes/crashes before sending `VIDEO_CLEARED`, transcript snapshots may persist longer than the policy implies.

---

### M3) Transcript Debug Logging Stores Full Caption URLs and Response Previews in Session Storage

Pillars: Chrome Web Store Compliance (Privacy), Stability  
Impact: Session storage may contain signed transcript URLs and response previews. This is extra “user data” beyond what is needed for core functionality.

Evidence:

- Content script sends debug entries during every extraction attempt:
  - `src/content/index.ts:579-585` calls `deliverTranscriptFetchDebug(...)`
- Debug messages include full URLs:
  - `src/content/transcript.ts:1488-1526` logs `candidate.url` and response preview.
- Service worker persists the log to `chrome.storage.session`:
  - `src/background/service-worker.ts:1819-1833`
  - `src/background/service-worker.ts:1149-1166` (`persistPanelDiagnostics`)

---

### M4) Model Inventory Is Inconsistent Across UI, Shared Types, and Backend Allowlist

Pillars: Security & Financial Hardening, Stability  
Impact: Confusing UX, unexpected server-side fallback to defaults, and increased chance of accidentally enabling expensive models.

Evidence:

- UI/shared “available models” include `gemini-3-flash`:
  - `shared/types.ts:5-36`
- API routes accept `body.model` from clients and forward it to Gemini adapter:
  - `backend/src/app/api/analyze-chunk/route.ts:246-251`
  - `backend/src/app/api/ask-video/route.ts:204-209`
  - `backend/src/app/api/verify-claim/route.ts:259-260`
- Backend allowlist (when it compiles) does not include `gemini-3-flash`:
  - `backend/src/lib/gemini.ts:541-566`

---

### M5) Host Permission Scope Mismatch and Potential Over-Permissioning

Pillars: Chrome Web Store Compliance  
Impact: Review friction and functional gaps on non-`www` YouTube subdomains.

Evidence:

- Content script matches:
  - `src/manifest.ts:56-61` matches `*://*.youtube.com/watch*`
- Host permissions:
  - `src/manifest.ts:48-51` includes `https://www.youtube.com/*` (not `*://*.youtube.com/*`)
  - `dist/manifest.json:10-13` includes the same pattern.

---

### M6) `tabs` Permission Might Be Justifiable but Is Narrowly Used

Pillars: Chrome Web Store Compliance (Least Privilege)  
Impact: Store reviewers may ask why `tabs` is required; it is broader than `activeTab`.

Evidence:

- Requested:
  - `src/manifest.ts:47` (`permissions: ['sidePanel', 'storage', 'tabs']`)
  - `dist/manifest.json:5-9`
- Used only for “Retry transcript” flow:
  - `src/background/service-worker.ts:2049-2063`

---

### M7) `web_accessible_resources` Exposes the Content Script Bundle

Pillars: Chrome Web Store Compliance, Security  
Impact: Increases attack surface and review questions; likely unnecessary for a content script.

Evidence:

- `dist/manifest.json:34-44` exposes `assets/index.ts-DHVdTxUW.js` to `*://*.youtube.com/*`.

---

### M8) Potential `chrome.storage.local` Quota Risk for Long Transcripts

Pillars: Stability  
Impact: Very long transcripts may exceed storage quotas, causing persistence errors and weird resume behavior.

Evidence:

- Full transcript array is stored:
  - `src/background/service-worker.ts:766-781`

## Low (Tech Debt)

### L1) Manifest Missing Common Store-Ready Metadata (Icons/Description)

Pillars: Chrome Web Store Compliance (Release Readiness)  
Impact: Lower-quality listing and potentially extra store submission friction.

Evidence:

- `src/manifest.ts:43-68` lacks `icons`, `description`, `action.default_icon`.
- `dist/manifest.json` also lacks these fields.

---

### L2) BYOK Settings Code Exists but Is Unwired / Incomplete

Pillars: Stability, Product Readiness  
Impact: Confusing or dead code paths; increases future change risk.

Evidence:

- `src/sidepanel/hooks/useExtensionStorage.ts:74-94` reads `userApiKey` but does not return it and never updates it on storage changes.
- `src/sidepanel/components/SettingsPanel.tsx` stores `providerSettings` but is not referenced anywhere (unused UI).
- `src/background/providers/types.ts` defines adapter interfaces but there is no implementation.

---

### L3) `ModelPickerStandalone` Message Shape Does Not Match Service Worker Handler

Pillars: Stability  
Impact: If used later, model switching will silently fail.

Evidence:

- Standalone sender uses `payload: { model }`:
  - `src/sidepanel/components/ModelPicker.tsx:151-158`
- Service worker reads `message.model`:
  - `src/background/service-worker.ts:2014-2018`

---

### L4) `.DS_Store` Present in Source Tree

Pillars: Release Hygiene  
Impact: Risk of accidentally packaging junk files into the Web Store zip.

Evidence:

- `src/sidepanel/.DS_Store`

## Positive Findings (Keep These)

- No `eval(` or `new Function(` found in `dist/` (good for MV3/CSP).
- MV3 service-worker hibernation is mostly handled correctly: runtime state is persisted to `chrome.storage.session`, the full transcript snapshot to `chrome.storage.local`, and the worker hydrates on message receipt:
  - `src/background/service-worker.ts:1095-1186` (persist + hydrate)
  - `src/background/service-worker.ts:1771-1774` (hydrates at start of message handling)
- React-side listeners are cleaned up (no obvious long-lived listener leak in the side panel):
  - `src/sidepanel/hooks/useExtensionStorage.ts:144-149` adds/removes `chrome.storage.onChanged` listener.
- Backend request-size limiting exists in middleware:
  - `backend/src/proxy.ts:149-169`
- Rate limiting is per-IP (meets your requirement), though the store/backing implementation needs work:
  - `backend/src/proxy.ts:546-568`
- Prompt surfaces are server-side and centralized (harder for clients to bypass “system prompts”):
  - `backend/src/lib/prompts.ts:1-71` (extraction)
  - `backend/src/lib/prompts.ts:164-219` (Q&A)
- Ask-video endpoint sanitizes sources by matching against already verified cards:
  - `backend/src/app/api/ask-video/route.ts:133-181`
- Graceful “no transcript” degradation exists with a user-visible retry action:
  - `src/sidepanel/components/CardFeed.tsx:1261-1273`
  - `src/sidepanel/components/VideoHeader.tsx:48-52`
- Network timeouts are handled with `AbortController` so the UI should not hang indefinitely on slow backend calls:
  - `src/background/service-worker.ts:501-551` (`fetchWithTimeout`)
  - `src/background/service-worker.ts:1601-1605` (ask-video uses an extended timeout)
- No obvious “import the whole icon set” bloat: `lucide-react` is imported by named icons:
  - `src/sidepanel/App.tsx:3`
  - `src/sidepanel/components/ModelPicker.tsx:2`
- Bundle size is currently reasonable for a Web Store extension (from `dist/` artifacts): total ~452 KB; sidepanel JS ~320 KB; content script ~36 KB; service worker ~32 KB.

## Data Sent To Backend (For Privacy Policy Alignment)

All requests are sent from the extension service worker with `X-Extension-Id` and usually `Authorization: Bearer <sessionToken>` once acquired.

| Endpoint | Sender evidence | Payload fields (high level) |
|---|---|---|
| `POST /api/session/init` | `src/background/service-worker.ts:453-463` | `{ extensionId }` |
| `POST /api/analyze-chunk` | `src/background/service-worker.ts:1675-1684` | `{ videoId, videoTitle, channelName, chunks: [{text,startTime,duration,index}], currentTimestamp, model }` |
| `POST /api/verify-claim` | `src/background/service-worker.ts:1387-1394` | `{ claim, videoTitle, channelName, model }` |
| `POST /api/ask-video` | `src/background/service-worker.ts:1586-1594` | `{ question, videoTitle, channelName, currentTime, transcriptContext, sourceCards, model }` |

Backend-side receivers:

- `backend/src/app/api/analyze-chunk/route.ts:218-343`
- `backend/src/app/api/verify-claim/route.ts` (model forwarded at `:259-260`)
- `backend/src/app/api/ask-video/route.ts:183-220`

## Plan (Requested): Premium BYOK API Key Entry + Freemium Tier (Flash 2.5 Only, No Embeddings/Memory)

This is a plan only, not implementation.

### Goal

- Free (freemium): runs on **Gemini Flash 2.5** only, no embeddings/memory, strict weekly usage cap (example: “10 verified claims per week” or “1 hour of scanning per week”).
- Premium: user can bring their own Gemini API key (BYOK) for higher limits and/or faster models, without costing your backend wallet.

### Design Decisions You Must Lock In First

1. Do you want premium to be “BYOK only” (no payments) or “subscription” (payments + license checks)?
2. Do you want prompts to remain server-side (your “core IP”) or is it acceptable to ship prompts into the extension for BYOK calls?

### Recommended Architecture (Pragmatic)

1. Server-enforced freemium quotas (cannot trust the client).
   - Enforce model = `gemini-2.5-flash` (FREEMIUM_MODEL) server-side for free tier regardless of `body.model`.
   - Add a weekly quota bucket:
     - Key candidates:
       - Minimum: `ip` only (simple, weakest, may throttle shared networks).
       - Better: `ip + installId` where `installId` is a random UUID stored in `chrome.storage.local` and sent to backend (must be disclosed as a persistent identifier).
   - Quota units:
     - “facts” = count of `/api/verify-claim` calls (most expensive).
     - “scan time” approximation = cap `/api/analyze-chunk` calls or total transcript characters processed.

2. Premium BYOK implementation options:
   - Option A (best for your wallet and user security): **Direct-to-Gemini from extension**.
     - Store key in `chrome.storage.local`.
     - Add `host_permissions` for `https://generativelanguage.googleapis.com/*` only for BYOK users (or always, but that’s a review question).
     - Downside: prompts must live client-side or be fetchable, which exposes your prompt IP.
   - Option B (keeps prompts server-side): **BYOK via backend relay**.
     - Extension sends API key to backend per request (never store it server-side; scrub logs).
     - Backend uses user key for Gemini calls.
     - Downside: backend becomes a sensitive secret relay; harder to guarantee you never log the key.

3. Model gating rules:
   - Free: hard force `gemini-2.5-flash` (FREEMIUM_MODEL constant).
   - Premium: allow list expands (maybe `gemini-3.1-flash-lite`), still server-side allowlisted.
   - Remove any “custom model override” capability for free users.

4. “No embeddings / no memory”:
   - Today: embeddings/memory aren’t implemented beyond type placeholders (`shared/types.ts:216-238`), so you’re already compliant.
   - When you add memory later: gate all embedding-generation and storage behind premium and explicitly disclose in privacy policy.
