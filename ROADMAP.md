# SourceCheck Roadmap — Trust-First, Hard-Gated, No Regression

## Summary
SourceCheck's near-term job is not to become a generic AI app. It is to become a **trusted ambient verification layer for spoken public content**, starting with YouTube and expanding only after the current product is trustworthy, stable, and adapter-ready.

**Execution mode locked in:**
- **Priority:** Trust First
- **Style:** Hard Gates
- **Rule:** Only one milestone is active at a time. No new lane starts until the current milestone fully passes code, test, and manual acceptance.

## Hard Rules
- No large dependency additions unless directly required by the active milestone.
- No store-release push until Milestones 1–4 are complete.
- No `tabCapture`, offscreen audio, Zoom, auth system, billing, or DB work before Milestone 5.
- Any new idea goes into the backlog; it does not interrupt the current milestone.
- Every milestone ends with:
  - `npm run build`
  - `npm --prefix backend run build`
  - `npm --prefix backend test`
  - `npm run test:unit`
  - `npm run test:e2e:smoke`

## Product Direction
**What the app should do**
- Detect high-value factual claims in live spoken content.
- Verify them quickly and show clear evidence.
- Stay quiet when nothing meaningful is happening.
- Preserve trust through accurate state language and visible provenance.

**What the app should not do**
- Become a generic chatbot.
- Expand to meetings before privacy/session rules exist.
- Hide uncertainty behind misleading metrics.
- Add feature clutter faster than trust/stability improve.

## Important Interface and Type Changes
These are the planned contract changes across milestones.

### Milestone 1
- Replace misleading header "truth score" usage with an explicit verification summary in UI state.
- Add secure storage handling for BYOK state by restricting storage access to trusted extension contexts.
- No backend API contract changes required.

### Milestone 3
- Extend shared `SourceCard` presentation data to support a visible "seen before" / similar-claim summary using existing backend `similarClaims`.
- If needed, extend `AskQuestionResponse` only for UI clarity, not markdown-rich formatting.

### Milestone 4
- Add source metadata to shared transcript/runtime contracts:
  - `TranscriptSourceType = 'youtube' | 'meet'`
  - `TranscriptSourceVisibility = 'public' | 'private'`
  - `TranscriptSourceContext { type, visibility, sourceId, sourceLabel }`
- Worker/runtime state must carry current transcript source context.
- No behavioral change in claim-verification APIs; they remain transcript-source-agnostic.

### Milestone 5
- Add meeting-specific extraction mode/profile selection to `analyze-chunk` request handling.
- Add private-session policy flag so meeting-derived transcript data is not persisted or added to cross-video memory by default.

## Milestone 0 — Baseline Lock
**Goal:** Freeze a known-good baseline so later work cannot quietly regress.

**Scope**
- Capture current baseline behavior and current known issues.
- Tag the baseline after tests pass.
- Record current UX/trust bugs as the official starting defect list.

**Checklist**
- [ ] Baseline test suite passes.
- [ ] Known issues list is frozen from verified code, not memory.
- [ ] Baseline tag created after passing checks.
- [ ] Manual baseline recorded for:
  - live YouTube scan
  - source card rendering
  - Ask flow
  - refresh continuity
  - BYOK save/load

## Milestone 1 — Trust Surface Overhaul
**Goal:** Remove misleading trust signals and harden user-facing credibility.

**Why first**
The product's core value is trust. Anything misleading in the header, wording, or key handling is a product defect, not polish.

**Implementation**
- Remove the current misleading "accuracy/truth score" percentage from the header.
- Replace it with an explicit verification summary:
  - `Supported N`
  - `Mixed N`
  - `Unsupported N`
  - `Unresolved N`
- Keep unresolved in view at all times; never hide pending uncertainty behind 100%.
- Verify and enforce removal of any `[From memory]` prefix from user-visible copy.
- Normalize jargon:
  - replace "Reading near" with `Checking at`
  - replace internal/cache wording with user language
- Harden BYOK storage:
  - restrict `chrome.storage.local` access to trusted extension contexts
  - review whether any sensitive runtime-only state should move to `storage.session`
- Tighten settings/error copy so auth/quota/model issues read like product states, not debug leftovers.

**Key files**
- `src/sidepanel/components/VideoHeader.tsx`
- `src/sidepanel/components/SettingsPanel.tsx`
- `src/background/utils/api.ts`
- `src/background/service-worker.ts`
- `backend/src/app/api/verify-claim/route.ts`

**Exit Criteria**
- [ ] Header never implies certainty when unresolved claims exist.
- [ ] Cached claims never show `[From memory]` anywhere in UI.
- [ ] BYOK storage access level is hardened.
- [ ] Manual QA covers supported, mixed, unsupported, unresolved, cached-claim, invalid-key, and quota-exhausted states.
- [ ] No regressions to current YouTube flow.

## Milestone 2 — Reliability and Runtime Hardening
**Goal:** Make the current YouTube product stable enough to trust during long sessions.

**Implementation**
- Profile and narrow any remaining heavy DOM observation in playback/transcript flow.
- Reduce unnecessary persistence churn in the worker.
- Establish a panel performance budget:
  - target low visible jank in a 10-minute live session
  - avoid runaway storage writes
- Add/finish browser-level refresh continuity coverage beyond the current smoke path.
- Verify transcript unavailable/retry flows do not leave stale UI.

**Key files**
- `src/content/playback.ts`
- `src/content/index.ts`
- `src/background/service-worker.ts`
- `tests/e2e/extension-smoke.spec.ts`
- `backend/__tests__/stale-transcript.test.ts`

**Exit Criteria**
- [ ] Refresh continuity is covered by a real reload E2E test.
- [ ] No stale transcript after failure.
- [ ] Worker persistence writes are measurably reduced from baseline.
- [ ] 10-minute manual session shows no obvious panel degradation.
- [ ] Existing smoke and unit coverage remain green.

## Milestone 3 — YouTube Product Strengthening
**Goal:** Deliver visible, meaningful product progress on the current platform before expansion.

**Implementation**
- Surface existing cross-video memory in UI as a trust/product feature:
  - show `Seen before` / similar-claim context when backend returns `similarClaims`
  - do not overclaim identity; frame it as a possible prior match
- Improve empty/history states so the panel never reads like a crash or dead zone.
- Fix mixed-mode HISTORY behavior:
  - HISTORY must not render live transcript, tracking, or active scan strips
  - HISTORY should behave like an archive of checked claims and Q&A only
  - any active scanning state belongs exclusively to LIVE
- Keep Ask focused:
  - add keyboard shortcut to focus Ask
  - improve refusal and no-context states
  - do not add markdown rendering yet
- Add lightweight toast/notices only for minor non-blocking events:
  - settings saved
  - fallback transcript path used
  - model changed
- Do not add React Query, virtualization, or generic UI-library churn in this milestone.

**Key files**
- `src/sidepanel/components/SourceCard.tsx`
- `src/sidepanel/components/CardFeed.tsx`
- `src/sidepanel/components/AskBox.tsx`
- `src/sidepanel/components/AskResponseCard.tsx`
- `src/sidepanel/App.tsx`

**Exit Criteria**
- [ ] Similar-claim UI is visible and correctly caveated.
- [ ] Ask can be focused by keyboard shortcut.
- [ ] Empty/history states are product-quality.
- [ ] HISTORY no longer shows live transcript or active scanning states.
- [ ] Non-blocking events use lightweight notices instead of heavy UI takeovers.
- [ ] No expansion work has started yet.

## Milestone 3.5 — Sidepanel Interaction Language Lock
**Goal:** Freeze the sidepanel's motion, cue hierarchy, and copy tone so future work reuses a system instead of adding one-off polish.

**Why now**
The current YouTube product already contains several strong interaction patterns. They feel good because they are local, weighted, and readable. If we move to Milestone 4 without systematizing them, transcript-adapter work will multiply inconsistency across states and sources.

This milestone is a lock-and-systematize pass on the current sidepanel lane, not a new product direction.

**Implementation**
- Capture the sidepanel interaction language in a repo artifact:
  - motion tokens
  - semantic visual-cue roles
  - copy tone contract
  - reduced-motion contract
- Consolidate repeated motion values into shared tokens while preserving the current SourceCheck feel.
- Standardize hover and press behavior across:
  - feed cards
  - ask responses
  - tabs
  - model picker
  - notices
- Audit CSS transitions and either:
  - align them with shared motion tokens
  - or remove strays that conflict with JS-driven motion
- Decide whether any remaining expressive 3D fold behavior is an intentional exception or should be flattened.
- Tighten robotic system/cue copy where it weakens trust or clarity.
- Add regression guardrails for:
  - hover lift
  - press settle
  - stack entry
  - expand/reveal
  - notice arrival
  - reduced-motion fallback

**Key files**
- `SIDEPANEL_VISUAL_LANGUAGE.md`
- `src/sidepanel/components/FeedCard.tsx`
- `src/sidepanel/components/CardFeed.tsx`
- `src/sidepanel/components/AskResponseCard.tsx`
- `src/sidepanel/components/ModelPicker.tsx`
- `src/sidepanel/components/NoticeStack.tsx`
- `src/sidepanel/styles/globals.css`
- sidepanel unit tests covering notices and visual-state builders

**Exit Criteria**
- [x] Shared motion tokens exist and replace repeated ad hoc timings/easings in the active sidepanel shell.
- [x] Interactive sidepanel surfaces use consistent hover and press behavior.
- [x] Reduced-motion behavior is consistent across both JS and CSS-driven interactions.
- [x] System and verdict copy follow a documented tone contract.
- [x] The current polished sidepanel state is checkpointed as the new rollback-safe baseline.
- [x] Milestone 4 has not started yet.

**M3.5 Completion Notes (2026-03-20)**
All exit criteria met. Additional hardening completed during close-out:
- ModelPicker: custom SVG icons (bolt/hexagon/star), freemium lock rows with "Requires API key"
- Scanning card: robotic italic removed, SCANNING→Scanning, ALL CAPS transcript normalization
- SAFE_SCAN_REASONS whitelist: raw AI rationale strings blocked from UI
- Backend placeholder filter: `Needs primary source` / `No strong web match` blocked in FeedCard
- React key antipattern fixed in Q&A history (`askHistory.map`)
- Retry queue priority: failed verifications re-queued at front (`unshift`)
- Timing oracle closed: `timingSafeEqual` now uses HMAC hashing (no length leak)
- Gemini parser: arrays no longer eagerly returned; scanner advances past extracted regions
- Hero dwell self-cancellation fixed: split into three effects, timer no longer killed by state update cleanup
- ask-video contract: introduced `AskSourceCard` type; backend validator now guards `claim.claimText`
- Extension unit: 83/83 ✅ | Backend unit: 105/105 ✅ | tsc: clean ✅

## Milestone 4 — Transcript Ingestion Abstraction
**Goal:** Build the adapter layer that the current YouTube implementation bypasses.

**Implementation**
- Introduce transcript-source abstractions:
  - source type
  - source visibility
  - source context metadata
- Move current YouTube extraction behind a `youtube` adapter with **no behavior change**.
- Keep the worker pipeline and backend APIs source-agnostic.
- Ensure all transcript/debug/persistence paths can carry source metadata cleanly.
- Define private/public handling at the contract level now, even though only YouTube uses `public` in this milestone.

**Key files**
- `shared/types.ts`
- `src/content/index.ts`
- `src/content/transcript.ts`
- `src/background/service-worker.ts`
- `src/sidepanel/hooks/useExtensionStorage.ts`

**Exit Criteria**
- [ ] YouTube still works exactly as before through the new adapter path.
- [ ] Runtime state exposes transcript source metadata.
- [ ] No source-specific logic leaks into backend verification APIs.
- [ ] Adapter layer is documented and ready for a second source.

## Milestone 5 — Google Meet Web Caption Adapter
**Goal:** Prove meeting support via captions without taking on tab-audio complexity yet.

**Implementation**
- Add Google Meet web as the first non-YouTube source.
- Read live Meet captions/transcript text from the page, not audio capture.
- Add meeting-specific extraction profile:
  - smaller analysis windows
  - stricter handling of hedged/half-formed claims
  - lower-confidence default for weak conversational claims
- Add private-session rules for non-public sources:
  - do not persist raw meeting transcript beyond session
  - do not add meeting claims to cross-video memory by default
  - do not carry meeting Ask history across reload/browser restart
  - clearly disclose private-session handling in UI
- Keep this milestone browser-meeting only; no Zoom, no tab audio.

**Key files**
- `src/manifest.ts`
- `src/content/index.ts`
- new Meet-specific content extraction module
- `src/background/service-worker.ts`
- `backend/src/app/api/analyze-chunk/route.ts`
- `backend/src/lib/prompts.ts`

**Exit Criteria**
- [ ] Meet captions can drive the existing claim pipeline end-to-end.
- [ ] Meeting sessions are marked private in runtime state and UI.
- [ ] No meeting transcript or memory data persists across session end by default.
- [ ] YouTube behavior is unchanged.
- [ ] Manual QA confirms meeting claims are more conservative than YouTube claims.

## Post-Milestone Backlog — Not Before Milestone 5
These stay parked until the above is complete.
- Zoom web caption adapter
- Universal `tabCapture` + offscreen + streaming transcription
- Auth/accounts/database/subscriptions
- Notes, QuickChips, broader monetization work
- Store-release checklist and listing polish
- Provenance-rich inline citations as a second trust wave if current trust gains are insufficient

## Testing and Acceptance Scenarios
Every milestone must explicitly verify these scenarios where relevant.
- YouTube live video with valid captions
- YouTube video with no captions and fallback behavior
- Refresh during active monitoring
- Cached/similar claim path
- BYOK save, load, invalid key, quota exhaustion
- Ask with transcript context
- Ask with no sufficient context
- Long session with panel open
- Non-public meeting session privacy rules
- Meeting session teardown and data removal

## Assumptions and Defaults
- Near-term primary audience is individual users checking high-information YouTube content.
- Advanced models remain BYOK-driven for now.
- First non-YouTube expansion target is **Google Meet web**, not Zoom.
- Meeting support means **browser-based meeting pages**, not desktop Zoom app support.
- No raw audio storage is introduced in this roadmap.
- No generic "chat-first" product pivot is allowed.
- If a milestone misses exit criteria, the next milestone does not start.

## Deliverable Shape
At the end of each milestone, produce:
- a short changelog
- the exact test results
- the remaining defect list
- the next milestone's start checklist
