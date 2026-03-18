# Senior Engineer Audit Report: SourceCheck

## Executive Summary

This report provides a comprehensive audit of the SourceCheck Chrome extension and its backend services. The audit reveals several critical issues that are considered launch blockers. The most severe issues include a backend that fails to build, a release package containing development artifacts (localhost URLs), and security vulnerabilities that could lead to quota exhaustion and service abuse.

While the project has a solid foundation, with good state management and a clear separation of concerns, the identified blockers must be addressed before any public release. The following sections detail these findings, categorized by severity.

## High (Launch Blockers)

### H1) Backend Fails To Build (Duplicate `DEFAULT_MODEL`)

- **File:** [`backend/src/lib/gemini.ts`](backend/src/lib/gemini.ts)
- **Impact:** The backend is not deployable, rendering all API calls non-functional.
- **Details:** The constant `DEFAULT_MODEL` is defined twice within the same file, causing the Next.js build process to fail. This also creates ambiguity in model selection logic. The existing `AUDIT_REPORT.md` points to this issue.

### H2) Release Build (`dist/`) Contains Localhost URLs

- **Files:** [`dist/manifest.json`](dist/manifest.json), `dist/assets/service-worker.ts-*.js`, [`src/manifest.ts`](src/manifest.ts)
- **Impact:** Guaranteed Chrome Web Store rejection. The extension will be non-functional for all users, as it will try to make API calls to `localhost`.
- **Details:** The production build artifacts in the `dist/` directory contain hardcoded references to `http://localhost:3000`. The extension's manifest requests permissions for localhost, which is a critical flaw for a production release. This is caused by an incorrect build process that doesn't replace the development API endpoint with the production one. The logic in `src/manifest.ts` confirms this behavior.

### H3) Remote Font Loading Will Be Blocked by Content Security Policy (CSP)

- **Files:** [`src/sidepanel/styles/globals.css`](src/sidepanel/styles/globals.css), [`dist/manifest.json`](dist/manifest.json)
- **Impact:** Custom fonts will not load in the extension's side panel, leading to a degraded user experience. This also poses a risk for Chrome Web Store rejection, as remote code/resource loading is heavily scrutinized under Manifest V3.
- **Details:** The main stylesheet for the side panel imports fonts directly from `fonts.googleapis.com`. The default Content Security Policy for Manifest V3 extensions blocks requests to remote servers for resources like fonts and scripts. The current `manifest.json` does not specify a relaxed CSP, so these font requests will be blocked by the browser.

### H4) API Key-Like String in Client Bundle

- **Files:** `dist/assets/index.ts-*.js`, [`src/content/transcript.ts`](src/content/transcript.ts)
- **Impact:** High risk of Chrome Web Store rejection. Even if it's a public key, it looks like a leaked secret, which will trigger manual review and likely rejection. This also indicates that the build process is not in sync with the source code.
- **Details:** The `AUDIT_REPORT.md` indicates that a hardcoded string resembling a Google API key (`AIza...`) is present in the bundled content script in the `dist/` directory. The current source code in `src/content/transcript.ts` correctly extracts this key from the YouTube page at runtime. This discrepancy means the `dist/` directory is dangerously out of date and contains what appears to be a leaked secret.

### H5) Backend Auth is Spoofable, Allowing Quota Depletion

- **Files:** [`backend/src/proxy.ts`](backend/src/proxy.ts), [`backend/src/app/api/session/init/route.ts`](backend/src/app/api/session/init/route.ts)
- **Impact:** Critical security vulnerability. Any non-browser client (like a simple script) can forge requests to the backend, mint valid session tokens, and make unlimited API calls. This will lead to rapid depletion of the Gemini API quota, incurring high costs and causing a denial of service for legitimate users.
- **Details:** The backend middleware has a special path for Chrome extension service workers that do not send an `Origin` header. In this case, it trusts the `X-Extension-Id` header. Since the extension ID is public, an attacker can easily make requests without an `Origin` header and provide the public extension ID. The `/api/session/init` endpoint will then issue a valid session token, granting the attacker full access to the API. This vulnerability makes it trivial to abuse the service.

### H6) Rate Limiting is Not Deployable to Production

- **Files:** [`backend/src/lib/rate-limit-store.ts`](backend/src/lib/rate-limit-store.ts), [`backend/src/proxy.ts`](backend/src/proxy.ts)
- **Impact:** The application cannot be deployed with effective, production-grade rate limiting. This leaves the backend vulnerable to denial-of-service attacks and quota depletion.
- **Details:** The rate-limiting mechanism is designed to use Redis in production. However, it is implemented in Next.js middleware, which is intended to run in an Edge environment. The Redis client library used, `ioredis`, is not compatible with the Edge runtime because it relies on Node.js-specific APIs. While there is a fallback to an in-memory store, this is not suitable for a production environment as it cannot be shared across multiple instances and does not persist.

## Medium (Fix Before Scaling)

### M1) Session Token Acquisition Can “Sticky-Fail”

- **File:** [`src/background/service-worker.ts`](src/background/service-worker.ts)
- **Impact:** A single transient network error during the initial session token request can permanently disable all subsequent API calls for the user's entire browser session. This will appear as a persistent, unrecoverable failure of the extension.
- **Details:** The logic for fetching a session token in the service worker does not include a retry mechanism. If the initial call to `/api/session/init` fails for any reason (e.g., a temporary network blip), the `cachedSessionToken` is set to an empty string, and no further attempts are made to acquire a token until the service worker is fully restarted.

### M2) Privacy Policy Mismatch with Chrome Storage Behavior

- **Files:** [`PRIVACY.md`](PRIVACY.md), [`src/background/service-worker.ts`](src/background/service-worker.ts)
- **Impact:** Risk of Chrome Web Store rejection due to an inaccurate privacy policy. Misleading users about data handling can erode trust.
- **Details:** The `PRIVACY.md` file inaccurately describes the data storage lifecycle. For instance, it claims `chrome.storage.session` data is cleared on tab closure, when it actually persists until the browser is closed. The policy also doesn't fully account for the use of `chrome.storage.local` (for transcript caching) and `chrome.storage.sync` (for model selection), which have longer data persistence.

### M3) Sensitive Debug Information Stored in Session Storage

- **Files:** [`src/content/index.ts`](src/content/index.ts), [`src/content/transcript.ts`](src/content/transcript.ts), [`src/background/service-worker.ts`](src/background/service-worker.ts)
- **Impact:** Storing potentially sensitive data (like signed transcript URLs) in session storage is a privacy risk and could attract negative attention during a security review.
- **Details:** The content script logs debug information, including full, signed transcript URLs and response previews, which are then persisted to `chrome.storage.session` by the service worker. This data is not essential for the extension's core functionality and unnecessarily increases the amount of user data being stored.

### M4) Inconsistent Model Inventory

- **Files:** [`shared/types.ts`](shared/types.ts), [`backend/src/lib/gemini.ts`](backend/src/lib/gemini.ts), API route files
- **Impact:** This can lead to a confusing user experience, unexpected behavior (e.g., server-side fallbacks to default models), and an increased risk of accidentally enabling more expensive, non-freemium models.
- **Details:** The list of available Gemini models is not consistent across the different parts of the application. The UI might display models that the backend does not actually allow, leading to failed requests or silent fallbacks.

### M5) Overly Broad Host Permissions

- **File:** [`src/manifest.ts`](src/manifest.ts)
- **Impact:** Requesting broader permissions than necessary can cause friction during the Chrome Web Store review. It also violates the principle of least privilege.
- **Details:** The content script is configured to run on `*://*.youtube.com/watch*`, but the host permissions in the manifest only request access to `https://www.youtube.com/*`. This is a mismatch that could cause issues on non-`www` YouTube subdomains and is likely to be flagged during review.

### M6) Unnecessary `tabs` Permission

- **File:** [`src/manifest.ts`](src/manifest.ts)
- **Impact:** Requesting the `tabs` permission when `activeTab` might suffice can lead to questions from the Chrome Web Store review team.
- **Details:** The extension requests the broad `tabs` permission, but it appears to be used only in a "Retry transcript" flow. It's possible this could be achieved with the more limited `activeTab` permission, adhering better to the principle of least privilege.

### M7) Unnecessary `web_accessible_resources`

- **File:** [`dist/manifest.json`](dist/manifest.json)
- **Impact:** Exposing internal extension resources to web pages increases the attack surface and may trigger security concerns during the store review.
- **Details:** The generated `manifest.json` declares the content script bundle as a web accessible resource. This is generally not necessary for content scripts that operate in an isolated world and should be avoided unless explicitly required.

### M8) Potential for Exceeding `chrome.storage.local` Quota

- **File:** [`src/background/service-worker.ts`](src/background/service-worker.ts)
- **Impact:** For very long videos (e.g., multi-hour podcasts), the full transcript could exceed the 5MB limit of `chrome.storage.local`, causing errors and unexpected behavior.
- **Details:** The entire transcript is cached in `chrome.storage.local`. While convenient for session restoration, this approach does not account for Chrome's storage limitations, which can be easily reached with long-form content.

## Low (Tech Debt)

### L1) Manifest Missing Store-Ready Metadata

- **File:** [`src/manifest.ts`](src/manifest.ts)
- **Impact:** While not a blocker, a missing description and icons will result in a lower-quality, less professional listing in the Chrome Web Store.
- **Details:** The `manifest.ts` file is missing key metadata fields such as `description` and a full set of `icons`, which are required for a complete and appealing store listing.

### L2) Unused "Bring Your Own Key" (BYOK) Code

- **Files:** [`src/sidepanel/hooks/useExtensionStorage.ts`](src/sidepanel/hooks/useExtensionStorage.ts), [`src/sidepanel/components/SettingsPanel.tsx`](src/sidepanel/components/SettingsPanel.tsx)
- **Impact:** Dead or incomplete code can be confusing for future developers and increases the risk of bugs when new features are built on top of it.
- **Details:** There are several pieces of code related to a "Bring Your Own Key" feature for the Gemini API, including UI components and storage hooks. However, this feature is not fully implemented or wired into the application.

### L3) Mismatched Message Shape for Model Picker

- **Files:** [`src/sidepanel/components/ModelPicker.tsx`](src/sidepanel/components/ModelPicker.tsx), [`src/background/service-worker.ts`](src/background/service-worker.ts)
- **Impact:** If the standalone model picker component is used in the future, model switching will silently fail.
- **Details:** The message sent by the `ModelPickerStandalone` component has a different shape (`{ payload: { model } }`) than what the service worker expects (`{ model }`).

### L4) `.DS_Store` File in Source Tree

- **File:** `src/sidepanel/.DS_Store`
- **Impact:** This is a minor release hygiene issue, but it's best practice to exclude OS-specific files from the source tree.
- **Details:** A `.DS_Store` file, which is created by macOS, is present in the repository. This should be added to the `.gitignore` file.

## Positive Findings

Despite the critical issues identified, the audit also revealed several positive aspects of the project that indicate a solid foundation.

- **Well-Defined Architecture:** The project benefits from a clear and logical architecture, with a well-defined separation of concerns between the Chrome extension frontend and the Next.js backend. The monorepo structure is suitable for managing this relationship.

- **Robust State Management:** The extension's service worker employs a canonical reducer pattern for state management. Persisting the runtime state to `chrome.storage.session` is a good approach to handle the non-persistent nature of service workers.

- **Centralized Prompt Engineering:** All prompts for the Gemini API are centralized in `backend/src/lib/prompts.ts`. This is a critical best practice, as it treats the prompts as a core part of the application's intellectual property and makes them easy to manage and version.

- **Security and UX Considerations:** The project shows evidence of thoughtful design in several areas:
  - Prompts are kept on the server-side, preventing easy extraction or modification from the client.
  - The `ask-video` endpoint sanitizes its sources, which is a good security measure.
  - The UI gracefully handles cases where a transcript is not available.
  - Network requests have timeouts to prevent the UI from hanging.

- **Good Code Quality:** The codebase generally adheres to high standards, including:
  - The use of TypeScript in strict mode.
  - A clean and well-organized directory structure.
  - Good use of modern React hooks and patterns.
  - Comprehensive test suites for backend logic.

- **Excellent Documentation:** The [`AGENTS.md`](AGENTS.md) file provides an exemplary level of detail, making it easy for new engineers to understand the project's architecture, conventions, and goals.
