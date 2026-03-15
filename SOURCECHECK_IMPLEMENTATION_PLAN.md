# SOURCECHECK

## Live Cross-Reference Engine for YouTube

Implementation Plan & Build Guide  
Prepared for: MʝM  
March 2026  
Chrome Extension · React · TypeScript · Next.js · Supabase

## 1. Product Overview

### What SourceCheck Is

SourceCheck is a Chrome extension that acts as a live research layer for YouTube. While you watch long-form podcasts, lectures, and educational content, it passively monitors the transcript in real-time, detects claims, references, names, and statistics, and automatically surfaces verified source cards in a side panel without you ever asking.

It is not a chatbot. It is not a video summarizer. It is a live fact-verification and context engine.

### The Core Moment

A podcaster says: "Studies show cold exposure increases dopamine by 250%."

Without you doing anything, SourceCheck surfaces:

CLAIM DETECTED  
"Cold exposure increases dopamine by 250%"  
Source: Šrámek et al., 2000 — European Journal of Applied Physiology  
Supported, but the 250% figure is from a specific protocol (14°C water, 1 hour immersion)

That moment, where the user thinks "I need this on every video," is the install moment. That is what gets shared.

### Target User

- Watches long-form podcasts: Lex Fridman, Huberman, Dwarkesh, Joe Rogan, All-In
- Watches educational content: coding tutorials, science explainers, finance deep dives
- Already pauses and Googles things while watching
- Wants to learn efficiently, not passively consume
- Values accuracy and sourcing over speed

### What Makes This Different from Existing Tools

| Feature | Competitors | SourceCheck |
| --- | --- | --- |
| Core interaction | You ask, it answers | It detects and surfaces automatically |
| Intelligence | Transcript summary | Claim extraction + verification |
| Sourcing | None or generic | Specific papers, articles, links |
| Awareness | Whole video | Real-time position-aware |
| Memory | None | Session history, cross-video recall |

## 2. Technical Architecture

### System Overview

The system has four main components: the Chrome extension (frontend), the Next.js backend (API layer), the Supabase database (persistence), and external AI/search APIs (intelligence).

### Architecture Diagram

```text
┌───────────────────────────────────────────────┐
│          CHROME EXTENSION (MV3)              │
├───────────────┬───────────────┬───────────────┤
│ Content Script│ Service Worker│ Side Panel    │
│               │               │ (React App)   │
│ - Page detect │ - Msg routing │ - Source cards│
│ - Transcript  │ - State sync  │ - Ask box     │
│ - Playback    │ - Auth        │ - Quick chips │
└───────────────┴───────┬───────┴───────────────┘
                        │
                   HTTPS API Calls
                        │
┌───────────────────────┬───────────────────────┐
│    NEXT.JS BACKEND    │ SUPABASE              │
├───────────────────────┼───────────────────────┤
│ /api/analyze-chunk    │ users                 │
│ /api/verify-claim     │ watch_sessions        │
│ /api/search-sources   │ claims + verifications│
│ /api/save-note        │ saved_notes           │
│ /api/session          │ transcript_cache      │
└───────────────────────┴───────────────────────┘
         │
    External APIs
         │
┌─────────┬──────────┬──────────┐
│ Gemini  │ Google   │ Supabase │
│ API     │ Grounding│ (later)  │
└─────────┴──────────┴──────────┘
```

### How the Claim Detection Pipeline Works

This is the core engine of the product. Here is exactly what happens when a user is watching a video:

- Content Script pulls transcript chunks. Every 15–30 seconds, the content script grabs the latest transcript segment from YouTube’s captions API or DOM. It packages this with the current timestamp and video metadata, then sends it to the service worker.
- Service Worker routes the chunk to the backend. The service worker batches these chunks to avoid hammering the API and sends them to your Next.js endpoint at `/api/analyze-chunk`.
- Backend runs Claim Extraction via Gemini. The backend sends the transcript chunk to Gemini with a structured prompt asking it to identify high-value factual claims worth checking.
- Each detected claim triggers a grounded verification pipeline. For each claim, Gemini performs Google Search grounding inside the same request and returns both the verification JSON and the grounded sources it used.
- Gemini synthesizes a Source Card. The grounded response is normalized into a structured source card: the claim text, source attribution, verification status, and a one-line nuance note.
- Source Card is pushed to the Side Panel. The backend responds with the source card JSON. The service worker forwards it to the side panel React app, which renders it as a clean card at the correct timestamp position.

### Data Flow Timing

This entire pipeline needs to complete in under 8–10 seconds to feel live. That means:

- Transcript chunks should be sent every 15–30 seconds, not every sentence
- Claim extraction should be a fast, structured prompt, not a long conversation
- Web search should be a single API call, not multiple
- Source card synthesis should be a short, constrained prompt
- Use streaming responses where possible so cards appear progressively

## 3. Tech Stack (Detailed)

### Frontend — Chrome Extension

| Technology | Purpose | Why This Choice |
| --- | --- | --- |
| Chrome MV3 | Extension framework | Side Panel API is built for this exact UI pattern. MV3 is the current standard. |
| React 18+ | Side panel UI | Component-based, great for card-based UI. You already know it from React Native. |
| TypeScript | Type safety | Catches bugs early. Essential for message passing between extension components. |
| Tailwind CSS | Styling | Utility-first, fast iteration. Dark mode support built in. |
| Vite | Build tool | Fast HMR for extension development. Good Chrome extension plugin ecosystem. |

### Backend

| Technology | Purpose | Why This Choice |
| --- | --- | --- |
| Next.js 14+ | API routes + hosting | App Router, serverless functions, easy Vercel deploy. You’ve already worked with Vercel. |
| Supabase | Auth, DB, storage | Postgres + auth + realtime in one platform. Free tier is generous for MVP. |
| Gemini API | Claim extraction + grounded verification | Single provider for structured extraction and Google-grounded verification. |
| Vercel | Hosting | Zero-config deploy for Next.js. Edge functions for low latency. |

### Why Not These Alternatives

- OpenAI or Anthropic instead of Gemini: possible later, but the current architecture benefits from Gemini's built-in Google grounding to keep verification single-hop.
- Firebase instead of Supabase: Supabase gives you Postgres, which is better for structured claim data, versus Firebase’s NoSQL. Supabase is also more developer-friendly for solo builders.
- Plasmo instead of raw Vite: Plasmo is a Chrome extension framework. It’s fine, but adds abstraction you don’t need yet. Raw Vite + CRXJS plugin gives you more control.

## 4. Project Folder Structure

This is the exact folder structure to start with. Every file listed here is a file you will create.

```text
sourcecheck/
├── extension/
│   ├── manifest.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   ├── src/
│   │   ├── content/
│   │   │   ├── index.ts
│   │   │   ├── transcript.ts
│   │   │   ├── detector.ts
│   │   │   └── playback.ts
│   │   ├── background/
│   │   │   ├── service-worker.ts
│   │   │   ├── router.ts
│   │   │   ├── state.ts
│   │   │   └── api-client.ts
│   │   ├── sidepanel/
│   │   │   ├── index.html
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── components/
│   │   │   │   ├── SourceCard.tsx
│   │   │   │   ├── CardFeed.tsx
│   │   │   │   ├── AskBox.tsx
│   │   │   │   ├── QuickChips.tsx
│   │   │   │   ├── VideoHeader.tsx
│   │   │   │   ├── StatusBar.tsx
│   │   │   │   └── EmptyState.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useExtensionState.ts
│   │   │   │   └── useSourceCards.ts
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   ├── shared/
│   │   │   ├── types.ts
│   │   │   ├── messages.ts
│   │   │   └── constants.ts
│   │   └── assets/
│   │       ├── icon-16.png
│   │       ├── icon-48.png
│   │       └── icon-128.png
│   └── dist/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.js
│   ├── .env.local
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── analyze-chunk/
│   │   │   │   │   └── route.ts
│   │   │   │   ├── verify-claim/
│   │   │   │   │   └── route.ts
│   │   │   │   ├── save-note/
│   │   │   │   │   └── route.ts
│   │   │   │   └── session/
│   │   │   │       └── route.ts
│   │   │   └── layout.tsx
│   │   ├── lib/
│   │   │   ├── gemini.ts
│   │   │   ├── supabase.ts
│   │   │   ├── prompts.ts
│   │   │   └── types.ts
│   │   └── proxy.ts
│   └── supabase/
│       ├── migrations/
│       │   └── 001_initial.sql
│       └── seed.sql
├── shared/
│   ├── types.ts
│   └── constants.ts
└── README.md
```

## 5. Database Schema

These are the Supabase/Postgres tables you need for MVP. Keep it minimal. You can always add columns later.

### users

Managed by Supabase Auth.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | From Supabase Auth |
| email | text | From auth provider |
| plan | text | free \| pro |
| created_at | timestamptz | Auto-set |

### watch_sessions

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | Generated |
| user_id | uuid (FK) | References users.id |
| video_id | text | YouTube video ID |
| video_title | text | Cached title |
| channel_name | text | Cached channel |
| started_at | timestamptz | Session start |
| last_active_at | timestamptz | Updated on activity |

### claims

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | Generated |
| session_id | uuid (FK) | References watch_sessions.id |
| claim_text | text | The extracted claim |
| claim_type | text | statistic \| reference \| entity \| term |
| timestamp_seconds | integer | Video position when claim was detected |
| transcript_chunk | text | The raw transcript this came from |
| verification_status | text | supported \| partial \| disputed \| unverifiable |
| verification_summary | text | One-line nuance note |
| sources | jsonb | Array of source objects |
| created_at | timestamptz | Auto-set |

### saved_notes

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | Generated |
| user_id | uuid (FK) | References users.id |
| session_id | uuid (FK) | References watch_sessions.id |
| claim_id | uuid (FK) | Optional, links to a specific claim |
| note_text | text | User’s note |
| timestamp_seconds | integer | Video position |
| created_at | timestamptz | Auto-set |

## 6. The 10 Build Steps

Follow these in order. Each step produces something testable. Do not skip ahead.

### Step 1: Scaffold the Chrome Extension

Goal: Get a Chrome extension loading in your browser with a side panel that says "Hello World."

What to do:

- Create the `extension/` folder with `manifest.json` (MV3)
- Set up Vite with the CRXJS plugin for hot-reload Chrome extension development
- Create a minimal side panel HTML file with a React root
- Create a minimal service worker that opens the side panel
- Load the unpacked extension in Chrome and verify the side panel opens

Key `manifest.json` permissions you need: `sidePanel`, `activeTab`, `scripting`, `tabs`, `storage`

Done when: You click the extension icon and a side panel opens showing "SourceCheck" with a dark background.

### Step 2: Build the Content Script (YouTube Detection)

Goal: Detect when the user is on a YouTube video page and extract the video ID, title, and channel.

What to do:

- Create the content script that runs on `youtube.com/*`
- Detect navigation to a video page. YouTube is a SPA, so you need `MutationObserver` or `yt-navigate-finish`
- Extract video ID from the URL, title from the page, channel name from the page
- Send this data to the service worker via `chrome.runtime.sendMessage`
- Service worker forwards it to the side panel

Gotcha: YouTube is a single-page app. The content script loads once but the page changes without a full reload. You must listen for YouTube’s custom navigation events.

Done when: You navigate to any YouTube video and the side panel updates to show the video title and channel.

### Step 3: Extract the Transcript

Goal: Pull the captions/transcript for the current video and segment it into timed chunks.

What to do:

- Fetch the transcript using YouTube’s timedtext API or page data
- Parse the XML response into an array of `{ text, startTime, duration }` objects
- Group these into 30-second chunks with combined text
- Store the full transcript in extension state
- Display a simple transcript view in the side panel to verify it works

Approach: You can fetch the transcript from the page’s `ytInitialPlayerResponse` or from the timedtext endpoint. The content script has access to the page context to find this.

Done when: You open the side panel on any YouTube video with captions and see the full transcript text.

### Step 4: Track Playback Position

Goal: Know exactly what’s being said right now in the video.

What to do:

- Use the content script to monitor the video player’s `currentTime`
- Send periodic updates every 5 seconds to the service worker
- Map the current time to the transcript chunk that’s currently playing
- Highlight the current chunk in the side panel
- Build a "What was just said" display showing the last 30 seconds of transcript

Done when: As you watch a video, the side panel shows the current transcript segment and updates in real-time.

### Step 5: Set Up the Backend (Next.js + Supabase)

Goal: A working API that the extension can call, with a database behind it.

What to do:

- Create the `backend/` Next.js project
- Set up Supabase and run the initial migration SQL
- Create `/api/analyze-chunk` endpoint as a stub that returns a mock claim for now
- Create `/api/verify-claim` endpoint as a stub
- Set up CORS to allow requests from the Chrome extension
- Add basic API key auth
- Deploy to Vercel to get a live URL

Done when: Your extension can call your Vercel-hosted API and get a mock claim response back.

### Step 6: Build the Claim Extraction Pipeline

Goal: Send a transcript chunk to the backend and get back a list of detected claims.

This is the hard part. This is the core product.

What to do:

- Set up the Gemini API client in your backend
- Write the claim extraction prompt. It should return structured JSON with claim text, claim type, and the exact quote from the transcript
- Wire `/api/analyze-chunk` to call the LLM and parse the structured response
- Add error handling for garbage responses or empty responses
- Test with real transcript chunks from Huberman, Lex Fridman, and similar videos

Critical prompt engineering tip: Be very specific about what counts as a claim. You do not want opinions or filler. You want verifiable factual assertions, specific numbers/statistics, named study references, and first mentions of domain-specific terms.

Done when: You can send a transcript chunk from a Huberman episode and get back 1–3 real, verifiable claims in structured JSON.

### Step 7: Build the Verification Pipeline

Goal: Take a detected claim and find real sources that support or contradict it.

What to do:

- Use Gemini grounding for verification
- Feed each claim directly to Gemini with a verification prompt
- Parse the grounded response and keep the best matching grounded source URL
- The verification prompt should return verification status, source attribution, one-line nuance note, and a link to the best source
- Wire this into `/api/verify-claim`

The output structure for a source card should be:

```json
{
  "claim": "Cold exposure increases dopamine by 250%",
  "status": "partial",
  "source_title": "Sramek et al., 2000",
  "source_url": "https://pubmed.ncbi.nlm.nih.gov/...",
  "source_type": "academic_paper",
  "nuance": "The 250% figure is specific to 14C water immersion for 1 hour",
  "timestamp_seconds": 743
}
```

Done when: A claim goes in, a complete source card comes out with a real link to a real source.

### Step 8: Wire It All Together (The Live Loop)

Goal: As a video plays, claims are automatically detected and source cards appear in the side panel.

What to do:

- Connect the playback tracker to the claim pipeline
- Every 30 seconds, send the current transcript chunk to `/api/analyze-chunk`
- For each claim returned, call `/api/verify-claim`
- Push the resulting source cards to the side panel via the service worker
- Render source cards in the `CardFeed` component as they arrive
- Add a loading indicator while claims are being processed
- Add deduplication so chunks are not re-analyzed

Done when: You press play on a Huberman episode and source cards start appearing in the side panel automatically as topics come up.

### Step 9: Build the Side Panel UI (For Real)

Goal: Make the side panel look and feel premium.

Design principles:

- Dark mode first
- Source cards should be the hero
- Minimal controls
- Generous spacing, clean typography, no clutter

Components to build:

- `VideoHeader`
- `CardFeed`
- `SourceCard`
- `QuickChips`
- `AskBox`
- `StatusBar`

Design references: Linear, Perplexity, Raycast, Arc. Controlled, not flashy.

Done when: The side panel looks like a product you’d pay for.

### Step 10: Add User Accounts + Session Saving

Goal: Users can sign up, and their watch sessions plus source cards are saved.

What to do:

- Implement Supabase Auth, Google OAuth is the easiest for a Chrome extension
- On first install, prompt the user to sign in
- Create a `watch_session` record when a video is detected
- Save all claims and verifications to the `claims` table
- Build a simple History view in the side panel showing past sessions
- Allow users to save notes on specific claims

Done when: A user can sign in, watch a video, come back later, and see all the source cards from that session.

## 7. API Cost Estimates

This matters because the claim pipeline has real per-user costs.

### Per-Video Breakdown (30-minute video)

| Operation | Calls | Est. Cost | Notes |
| --- | --- | --- | --- |
| Claim extraction | ~60 chunks | Variable | Gemini structured JSON extraction |
| Claim verification | ~15 claims | Variable | Gemini grounded verification |
| Total per video |  | Variable | Depends on chosen Gemini model and token usage |

The exact per-video cost depends on the Gemini model you choose and the volume of grounded verification calls. Track real token usage before locking pricing.

### Cost Optimization Strategies

- Cache transcript analysis so another user watching the same video can reuse claim extraction results
- Use Gemini Flash or Flash-Lite for simple extraction, and move up-model only if quality requires it
- Batch chunk analysis: send 3–4 chunks at once instead of one at a time
- Skip chunks with no substantive content
- Rate limit free users to 3 videos/day

## 8. Monetization Strategy

Recommended: Freemium

| Feature | Free | Pro ($7–$10/mo) |
| --- | --- | --- |
| Manual Q&A | 5 questions/day | Unlimited |
| Live claim detection | No | Yes |
| Source cards | Manual only | Auto-generated |
| Session history | Last 3 sessions | Unlimited |
| Notes & highlights | No | Yes |
| Cross-video memory | No | Yes (future) |

This naturally gates the expensive feature behind the paywall, while the free tier is still useful enough to get installs and word-of-mouth.

## 9. Realistic Timeline

Assuming solo build, heavy AI tooling, and 4–6 focused hours/day:

| Week | Focus | Deliverable |
| --- | --- | --- |
| 1 | Steps 1–2: Extension scaffold + YouTube detection | Side panel shows current video info |
| 2 | Steps 3–4: Transcript extraction + playback tracking | Live transcript view in side panel |
| 3 | Step 5: Backend setup + Supabase | Working API on Vercel |
| 4–5 | Steps 6–7: Claim extraction + verification pipeline | Claims detected, sources found |
| 6 | Step 8: Wire the live loop | Auto source cards while watching |
| 7–8 | Step 9: Premium UI | Polished, professional side panel |
| 9 | Step 10: Auth + session saving | User accounts, history |
| 10 | Testing, bug fixes, Chrome Web Store prep | Ready for beta launch |

That is roughly 10 weeks to a testable beta.

## 10. What Not to Build (Yet)

These are all good ideas that will kill momentum if chased now:

- Support for non-YouTube platforms
- Desktop audio capture / universal transcription
- Mobile app version
- Multi-language transcript support
- Social features
- Full research agent that autonomously follows rabbit holes
- Browser-wide AI assistant
- Semantic search across all past sessions
- AI-generated summaries posted to social media

The only thing that matters right now is whether live cross-referencing on YouTube works well enough that someone tells a friend about it.

## 11. Working Name

The document uses "SourceCheck" as a working name. It is descriptive and communicates what the product does.

Other options:

- SourceLayer
- VerifyTube
- SideSource
- ClaimCheck

Do not overthink naming. Pick one, ship, rename later if needed.

## Next Steps

You have everything you need to start. Here’s what to do right now:

- Set up a new GitHub repo called `sourcecheck` or your chosen name with the folder structure from Section 4
- Start Step 1. Get a Chrome extension loading with a side panel
- Sign up for API keys: Gemini API, Supabase project
- Do not design the UI first. Get the pipeline working with ugly HTML. Make it pretty in Step 9

Build the engine first. Polish second. Ship before perfect.
