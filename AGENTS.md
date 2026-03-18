# SourceCheck — Agent Guide

## Project Overview

SourceCheck is a Chrome browser extension that provides real-time fact-checking for YouTube videos. It extracts transcript text from YouTube videos, identifies factual claims using Google's Gemini AI, verifies those claims against web sources, and surfaces verified source cards in a side panel while the user watches.

**Key Differentiator**: Unlike chat-based tools where users must ask questions, SourceCheck automatically detects and verifies claims as the video plays.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHROME EXTENSION (MV3)                       │
├─────────────────┬───────────────────┬───────────────────────────┤
│ Content Script  │ Service Worker    │ Side Panel (React)        │
│ (src/content/)  │ (src/background/) │ (src/sidepanel/)          │
├─────────────────┼───────────────────┼───────────────────────────┤
│ - Page detect   │ - Message routing │ - Source cards UI         │
│ - Transcript    │ - State machine   │ - Q&A interface           │
│   extraction    │ - API calls       │ - Model picker            │
│ - Playback sync │ - Session auth    │ - Debug panels            │
└─────────────────┴───────────────────┴───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              NEXT.JS BACKEND (backend/)                         │
├─────────────────────────────────────────────────────────────────┤
│ API Routes:                                                     │
│   POST /api/analyze-chunk    → Extract claims from transcript   │
│   POST /api/verify-claim     → Verify claim with web sources    │
│   POST /api/ask-video        → Answer user question             │
│   POST /api/session/init     → Issue session token              │
├─────────────────────────────────────────────────────────────────┤
│ Lib:                                                            │
│   - gemini.ts      → Gemini API wrapper (extraction/search)     │
│   - prompts.ts     → All LLM prompts (core IP)                  │
│   - rate-limit-store.ts → Rate limiting (Redis or memory)       │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │   Google Gemini API   │
              │   + Search Grounding  │
              └───────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| Extension Frontend | React 18, TypeScript, Tailwind CSS, Framer Motion, Lucide Icons |
| Extension Build | Vite 7 + @crxjs/vite-plugin (Chrome MV3) |
| Backend | Next.js 16 (App Router), TypeScript |
| Backend Test | Vitest |
| AI/LLM | Google Gemini API with Search Grounding |
| Rate Limiting | ioredis (production) / in-memory (dev) |
| Shared Types | `shared/types.ts` (used by both ext + backend) |

## Directory Structure

```
/
├── src/                          # Chrome Extension source
│   ├── background/
│   │   └── service-worker.ts     # MV3 service worker (state machine + API)
│   ├── content/
│   │   ├── index.ts              # Content script entry (page detection)
│   │   ├── transcript.ts         # Transcript extraction logic
│   │   └── playback.ts           # Video playback tracking
│   ├── sidepanel/
│   │   ├── App.tsx               # Side panel React app
│   │   ├── components/           # UI components
│   │   │   ├── SettingsPanel.tsx # API key configuration UI
│   │   │   ├── ModelPicker.tsx   # Model selection dropdown
│   │   │   └── ...
│   │   ├── hooks/                # React hooks
│   │   └── styles/               # Tailwind + custom CSS
│   ├── manifest.ts               # MV3 manifest generator
│   └── config.ts                 # Extension config (API_BASE, etc.)
│
├── backend/                      # Next.js backend
│   ├── src/
│   │   ├── app/api/*/route.ts    # API route handlers
│   │   ├── lib/
│   │   │   ├── gemini.ts         # Gemini API client
│   │   │   ├── prompts.ts        # LLM prompts
│   │   │   └── rate-limit-store.ts
│   │   └── types/shared.ts       # Re-exports from shared/
│   ├── __tests__/                # Vitest tests
│   └── middleware.ts             # CORS + rate limiting middleware
│
├── shared/
│   └── types.ts                  # Shared TypeScript types
│
├── tests/
│   └── e2e/                      # Playwright E2E tests
│
└── scripts/                      # Build/release scripts
    ├── check-release-dist.mjs    # Validates no localhost in dist
    └── check-release-secrets.mjs # Validates no .env files in git
```

## Build & Development Commands

### Extension (Root)

```bash
# Development server (Vite dev mode)
npm run dev

# Build for release (requires VITE_API_BASE env var)
npm run build

# Build for development (allows localhost)
npm run build:dev

# Validate dist has no localhost URLs
npm run check:dist-release

# Validate no secrets in git
npm run check:release-secrets

# Run E2E smoke test
npm run test:e2e:smoke

# Full release gate (build + backend build/test + checks + e2e)
npm run release:gate
```

### Backend

```bash
cd backend

# Development server
npm run dev          # Runs on http://localhost:3000

# Production build
npm run build

# Run tests
npm run test

# Test pipeline manually
npm run test:pipeline
```

## Environment Configuration

### Extension (`/.env` or `/.env.local`)

```bash
# Required: Backend API base URL
# For dev: http://localhost:3000
# For release: Must be a deployed HTTPS URL
VITE_API_BASE=http://localhost:3000

# Optional: Request timeout (ms)
VITE_REQUEST_TIMEOUT_MS=20000
```

### Backend (`/backend/.env.local` - NEVER COMMIT)

```bash
# Required
GEMINI_API_KEY=your_key_here

# Optional: Model selection
GEMINI_MODEL=gemini-2.5-flash        # Default freemium model
# GEMINI_MODEL=gemini-3.1-flash-lite-preview  # BYOK alternative

# Required for deployed backends
SESSION_SECRET=openssl_rand_hex_32
ALLOWED_EXTENSION_IDS=ext_id_1,ext_id_2

# Optional: Rate limiting
REDIS_URL=redis://host:port
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_POINTS=80
```

## Key Code Patterns

### State Management (Service Worker)

The service worker uses a **canonical reducer pattern** for state management:

```typescript
// All state mutations go through dispatch()
dispatch({ type: 'VIDEO_CHANGED', videoId, title, channel });
dispatch({ type: 'TRANSCRIPT_LOADED', chunkCount });
dispatch({ type: 'ANALYZE_COMPLETED', claimCount });

// State is synced to chrome.storage.session for UI access
```

Key files:
- `src/background/service-worker.ts` - Main state machine (~1000+ lines)
- `shared/types.ts` - `WorkerRuntimeState`, `WorkerLifecycle`, event types

### Claim Detection Pipeline

1. **Content Script** extracts transcript chunks from YouTube page
2. **Service Worker** batches chunks and sends to backend
3. **Backend** (`/api/analyze-chunk`) prompts Gemini for claim extraction
4. **Service Worker** queues claims for verification
5. **Backend** (`/api/verify-claim`) verifies with Google Search grounding
6. **Side Panel** receives `SOURCE_CARD` messages and renders cards

### API Call Pattern (Extension)

```typescript
// Service worker makes authenticated API calls
const response = await fetchWithTimeout(
  `${API_BASE}/api/analyze-chunk`,
  {
    method: 'POST',
    body: JSON.stringify({ videoId, chunks, ... }),
  }
);

// Session tokens are auto-acquired via /api/session/init
```

### Prompt Engineering

All prompts are in `backend/src/lib/prompts.ts`. This is the **core IP** of the product.

Key prompts:
- `EXTRACTION_SYSTEM_PROMPT` - Guides claim extraction from transcript
- `buildGroundedVerificationPrompt()` - Verifies claims with search
- `ASK_SYSTEM_PROMPT` - Powers the Q&A feature

## Testing Strategy

| Test Type | Location | Command | Purpose |
|-----------|----------|---------|---------|
| Unit | `backend/__tests__/` | `npm --prefix backend test` | Test Gemini parsing, rate limits |
| E2E | `tests/e2e/` | `npm run test:e2e:smoke` | Extension load + basic flow |
| Pipeline | `backend/scripts/test-pipeline.ts` | `npm run test:pipeline` | End-to-end claim extraction |
| Release | `scripts/` | `npm run release:gate` | Pre-flight checks |

## Security Considerations

### API Keys
- **NEVER** commit `GEMINI_API_KEY` to git
- Backend uses `SESSION_SECRET` to sign session tokens
- Extension ID whitelist (`ALLOWED_EXTENSION_IDS`) restricts API access

### Extension Security
- Content script runs in **isolated world** (no page script injection)
- `web_accessible_resources` is explicitly empty in manifest
- No hardcoded API keys in extension bundle

### Release Checklist
1. Set `VITE_API_BASE` to production URL before building
2. Run `npm run check:dist-release` - must pass
3. Run `npm run check:release-secrets` - must pass
4. Ensure `dist/` contains no localhost URLs
5. Ensure no `.env.local` files are in git

## Code Style Guidelines

### TypeScript
- Strict mode enabled (`tsconfig.json`)
- No `any` types - use proper typing
- Prefer `type` over `interface` for simple unions
- Use shared types from `shared/types.ts` for cross-boundary contracts

### Naming Conventions
- React components: PascalCase (`VideoHeader.tsx`)
- Hooks: camelCase starting with `use` (`useExtensionStorage.ts`)
- Utilities: camelCase (`formatTime.ts`)
- Constants: UPPER_SNAKE_CASE for module-level constants

### Error Handling
- Use custom error classes (e.g., `GeminiError`)
- Always include context in error messages
- Network calls use `fetchWithTimeout` with proper abort handling

### CSS/Styling
- Tailwind CSS for styling
- Custom design tokens in `tailwind.config.js` (sc-* colors)
- Component-specific styles in `src/sidepanel/styles/`

### Settings Panel (API Key Management)

The settings panel (`SettingsPanel.tsx`) provides UI for users to configure their own Google AI Studio API key:

**Key Features:**
- **Status-aware UI**: Shows different states (missing/present/invalid/quota_exhausted) with color-coded indicators
- **Show/hide toggle**: Eye icon to reveal/mask the API key input
- **Inline validation**: Validates key format (must start with "AIza", minimum length)
- **Key management**: Displays saved key (last 4 digits) with option to remove/update
- **Auto-open on errors**: Settings panel automatically opens when AUTH_ERROR or QUOTA_EXHAUSTED errors occur
- **Contextual help**: Shows troubleshooting tips specific to the current error state

**User States:**
1. **Missing key**: Yellow indicator, prompts to add key, shows setup instructions
2. **Key present**: Green indicator, shows "API key configured", allows updating
3. **Invalid key**: Red indicator, explains key may be expired, suggests waiting 2-3 min for activation
4. **Quota exhausted**: Red indicator, explains free tier limits, suggests waiting or creating new project

**Integration Points:**
- Accessed via "Key" button in header (next to ModelPicker)
- Service worker broadcasts `PROVIDER_ERROR` messages to auto-open on auth/quota issues
- Settings stored in `chrome.storage.local` under `PROVIDER_SETTINGS_KEY`

## Common Tasks

### Adding a New API Endpoint

1. Create `backend/src/app/api/my-endpoint/route.ts`
2. Export `POST` (or `GET`) handler function
3. Add request/response types to `shared/types.ts`
4. Call from extension via `fetchWithTimeout()`

### Model Policy (Hard-Locked)

The Gemini model configuration is **hard-locked** to prevent drift and ensure consistent behavior:

**Allowed Models (canonical):**
- `gemini-2.5-flash` — Freemium/trial/managed default
- `gemini-3.1-flash-lite-preview` — BYOK alternative  
- `gemini-3-flash-preview` — BYOK alternative

**Policy Rules:**
1. Freemium/trial/managed tier → ONLY `gemini-2.5-flash` (enforced server-side)
2. BYOK (Bring Your Own Key) mode → User can select any of the 3 allowed models
3. Stale/invalid saved model names are normalized to the freemium default via `normalizeModel()`

**Source of Truth:**
- Shared types: `shared/types.ts` exports `ALLOWED_MODELS`, `FREEMIUM_MODEL`, `BYOK_DEFAULT_MODEL`
- Backend: Imports from `backend/src/types-shared.ts` (re-exports from shared)
- Extension: Imports from `shared/types.ts`

**Adding a New Model (requires explicit approval):**
1. Add to `ALLOWED_MODELS` in `shared/types.ts` (and `backend/src/types-shared.ts`)
2. Add to `AVAILABLE_MODELS` in shared types for UI display
3. Update `GEMINI_MODELS` in `src/background/providers/types.ts`
4. Update tier enforcement logic in `backend/src/lib/gemini.ts:getEffectiveModel()`
5. Update model labels in `SettingsPanel.tsx` and icons in `ModelPicker.tsx`

### Modifying the State Machine

1. Add event type to `WorkerEvent` union in `service-worker.ts`
2. Add case to `computeNextLifecycle()` for lifecycle transitions
3. Add case to `computeNextDebugStage()` for debug tracking
4. Add case to `buildEventSummary()` for logging
5. Handle the event in message listeners

## Debugging

### Extension Debug Mode
Add `?debug=1` to the side panel URL to show debug panels:
```
chrome-extension://<id>/src/sidepanel.html?debug=1
```

### Service Worker Logs
- Open `chrome://extensions`
- Enable "Developer mode"
- Click "service worker" link under SourceCheck
- View console logs

### Backend Logs
- Development: Logs print to terminal
- Vercel: Check function logs in dashboard

## Documentation Files

- `SOURCECHECK_IMPLEMENTATION_PLAN.md` - Detailed architecture & product spec
- `AUDIT_REPORT.md` - Security audit findings (read before release)
- `PRIVACY.md` - Privacy policy
- `backend/README.md` - Backend setup instructions
