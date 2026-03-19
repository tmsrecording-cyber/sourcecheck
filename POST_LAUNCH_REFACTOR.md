# POST_LAUNCH_REFACTOR.md

## Status

This queue is **explicitly deferred until after launch**.

Do **not** touch this before:
1. Redis / Upstash production config is complete
2. Production deploy is verified
3. Broader-share release is live or confirmed stable

Current decision:
- `App.tsx` works correctly
- no current bug justifies pre-launch refactor
- refactoring now adds unnecessary launch risk

---

## Why this is deferred

Current `App.tsx` state is acceptable for launch because:

- behavior is verified
- no observed bugs are tied to current structure
- readability is still acceptable
- extension-specific guards like `isMountedRef` are intentional and valid
- `feedScrollKey` has no confirmed bug attached to it

Pre-launch refactor risk:
- subtle state regressions
- stale-response bugs
- settings / provider-error regressions
- launch delay for non-critical cleanup

---

## Locked non-issues

These are **not** pre-launch problems unless a real bug appears:

- `isMountedRef` usage in extension async flows
- `feedScrollKey` composition
- Tailwind class length
- HUD / instrument naming
- number of `useEffect` hooks by itself

---

## Post-launch refactor queue

### 1. Extract `useAskQuestion`
Move ask flow out of `App.tsx`.

Current responsibilities to move:
- `askDraft`
- `askHistory`
- `isThinking`
- `askError`
- `handleAskSubmit`

Goal:
- isolate async ask lifecycle
- keep cross-video stale-response protection
- reduce `App.tsx` responsibility without changing behavior

---

### 2. Extract `useProviderErrorGate`
Move provider error listener and settings auto-open logic out of `App.tsx`.

Current responsibilities to move:
- `lastProviderError`
- `lastSettingsSaveAtRef`
- provider error listener registration
- settings auto-open decision logic
- stale provider-error suppression behavior

Goal:
- isolate provider error handling
- make auto-open behavior easier to test
- prepare for replacing the 1500ms suppression gate cleanly

---

### 3. Extract `PanelShell`
Move `PanelShell` to its own component file.

Why:
- reduces `App.tsx` bloat
- keeps shell/loading/error display logic reusable
- improves file readability

This is hygiene only, not urgent.

---

### 4. Add proper `PROVIDER_ERROR` type guard
Replace inline runtime narrowing with a dedicated guard.

Current problem:
- repeated `typeof === 'object' && !== null` checks
- payload casting is noisy inside the effect

Goal:
- cleaner message parsing
- safer narrowing
- easier maintenance

Example direction:
- `isProviderErrorMessage(value): value is ProviderErrorMessage`

---

### 5. Replace 1500ms stale-error gate
Current logic is acceptable as a temporary patch but should be replaced after launch.

Current behavior:
- ignores provider errors for 1500ms after settings save

Desired replacement:
- correlation token
- settings version number
- request timestamp / generation ID
- explicit discard of pre-save errors

Goal:
- remove timing-based suppression
- make stale error rejection deterministic

---

### 6. Optional `App.tsx` decomposition
Only do this if still useful after items 1–5.

Possible extractions:
- video-scoped UI reset logic
- display analysis status stabilization logic
- settings route/view switch
- header / tab shell separation

Important:
- do not decompose for aesthetics alone
- only continue if it improves clarity without changing behavior

---

## Priority order after launch

### High value
1. `useAskQuestion`
2. `useProviderErrorGate`
3. `PROVIDER_ERROR` type guard

### Medium
4. replace 1500ms gate
5. extract `PanelShell`

### Optional
6. further `App.tsx` decomposition

---

## Guardrails for the refactor pass

When this work starts:

- behavior must remain unchanged
- no visual redesign in same pass
- no settings UX rewrite in same pass
- no background/service-worker logic changes unless required
- no "cleanup drift"
- preserve cross-video stale-response protection
- preserve current settings auto-open behavior
- preserve current launch-safe behavior first

Recommended approach:
- one extraction at a time
- pass/fail gates after each extraction
- savepoint after each successful pass

---

## Not in scope for this file

Do not mix this queue with:
- Redis / Upstash rollout
- production env work
- model changes
- token instrumentation
- grounding cost monitoring
- broader security roadmap
- visual polish

Those are separate tracks.

---

## Immediate focus before any of this

Stay locked on:

1. Upstash Redis config
2. production deploy
3. broader share

Nothing in this file should interrupt launch.
