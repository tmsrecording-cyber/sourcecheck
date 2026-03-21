# Checkpoint: M3.5 Complete — Ready for M4

**Date:** 2026-03-20
**Status:** M3.5 exit criteria fully met. M4 (Transcript Ingestion Abstraction) is next.
**Tag:** baseline-2026-03-20-m3.5-complete *(pending git tag)*

---

## Automated Gates

- ✅ Extension unit tests: `83/83`
- ✅ Backend unit tests: `105/105`
- ✅ Extension tsc: clean
- ✅ Backend tsc: clean

---

## What M3.5 Delivered

### Interaction Language Locked
- `motionTokens.ts` — shared spring/duration/distance tokens, hover lift, press settle, expand/reveal
- `SIDEPANEL_VISUAL_LANGUAGE.md` — documented tone contract, motion roles, reduced-motion rules
- All interactive surfaces (feed cards, model picker, notices, ask responses, tabs) use consistent hover/press behavior
- CSS transitions audited; italic and mono-font removed from scan/thinking states

### Copy Tone Hardened
- Scanning card: `SCANNING...` → `Scanning`, no italic, human rotating thoughts
- ALL CAPS YouTube captions normalized to sentence case in transcript preview
- Raw AI rationale blocked via `SAFE_SCAN_REASONS` whitelist in `CardFeed`
- Backend placeholder text (`Needs primary source`, `No strong web match`) filtered in `FeedCard`
- `VideoHeader` copy: `Building notes` → `Listening`, `Unresolved` → `Unverifiable`
- Notices: `Key saved.` → `API key saved.`, `Fallback transcript active` → `Backup transcript active`

### Model Picker Overhauled
- Custom SVG icons: bolt (Flash Lite), hexagon+dot (Flash 2.5), 4-point star (Flash 3 Preview)
- Shows all 3 models; BYOK-only ones locked with `Lock` icon + "Requires API key"

### Bugs Fixed
- **Hero dwell self-cancellation**: split into three effects; timer no longer killed by `setDwellState` cleanup
- **ask-video contract mismatch**: introduced `AskSourceCard` type; backend validator guards `claim.claimText`; no more 500 on malformed payload
- **React key antipattern**: `askHistory.map` now uses `timestampSeconds-query` (no index)
- **Verification retry queue**: `unshift` instead of `push` — retried claims go to front
- **Timing oracle**: `timingSafeEqual` now uses HMAC; no length leak
- **Gemini eager array parser**: scanner advances past extracted regions; objects preferred over preamble arrays
- **Generation guard completeness**: `VERIFY_COMPLETED` dispatch guarded at all three exit sites

---

## Product State Confirmed in Code

- ✅ Unified `FeedCard` is the single card primitive across all states
- ✅ Freemium hard-locked to `gemini-2.5-flash`; BYOK unlocks Flash Lite and Flash 3 Preview
- ✅ Cross-video memory (`similarClaims`) renders in hero and compact cards
- ✅ Global Ask focus shortcut (`/` and `Cmd/Ctrl+K`) works from sidepanel shell
- ✅ Notice layer covers: API key saved, model changed, backup transcript, answer ready
- ✅ HISTORY tab shows only resolved cards and Q&A — no live scan state
- ✅ Ask payloads trimmed to `AskSourceCard` shape (no oversized serialization)

---

## Manual Baseline Checklist (to perform before M4 starts)

- [ ] Live YouTube scan from empty state through first verified card
- [ ] Source card expansion/collapse in a live browsing session
- [ ] Ask flow: question → answer in HISTORY with "Answer ready" notice
- [ ] Refresh continuity on an active video
- [ ] BYOK: save key → Flash 3 Preview available; remove key → snaps back to Flash 2.5
- [ ] ModelPicker: locked rows render correctly for freemium users

---

## M4 Start Conditions

M4 (Transcript Ingestion Abstraction) may begin once:
1. Manual baseline checklist above is complete
2. Git tag `baseline-2026-03-20-m3.5-complete` is created
3. All automated gates remain green on the tagged commit

## M4 Scope Reminder

- Introduce `TranscriptSourceType`, `TranscriptSourceVisibility`, `TranscriptSourceContext`
- Move YouTube extraction behind a `youtube` adapter with **no behavior change**
- Worker pipeline and backend APIs remain source-agnostic
- No new features, no Meet work — adapter contract only
