# Lead Engineering Decision Memo

## Purpose
This memo records the current backend architecture judgment for SourceCheck, the product principles we are keeping, the things we are explicitly not copying from newsroom/research tools, and the next engineering lane we are choosing on purpose.

It is written to be durable context for future agents and contributors.

## Product Standard
SourceCheck is not trying to become:
- a generic chatbot
- a newsroom CMS
- a grant-funded research prototype
- a fact-check dashboard that only works with constant human curation

SourceCheck is trying to become:
- a real-time ambient fact-checking layer for spoken public content
- fast enough for normal viewing
- careful enough not to overclaim
- trustworthy because provenance is clear
- product-grade, not demo-grade

## What We Believe

### 1. Match-first is the correct architecture
The system should prefer:
1. internal memory reuse
2. public fact-check reuse
3. fresh verification only when needed

Fresh verification is necessary, but it should not be the default center of gravity.

### 2. Vector similarity alone must never trigger reuse
Embeddings are useful for candidate retrieval.
They are not sufficient to decide that two claims have the same truth conditions.

Reuse must depend on:
- subject
- predicate
- object
- polarity
- quantity
- time / period
- location
- attribution mode

### 3. Provenance is product-critical
Users must be able to distinguish:
- Earlier in this video
- Seen before
- Previously fact-checked
- Verified live
- Related claim

This is not decoration. It is part of the trust model.

### 4. Private-session boundaries are non-negotiable
Private-session content must not:
- enter global memory
- be matched against public fact-check corpora
- be persisted into shared claim history

### 5. We do not copy failed products wholesale
We adopt proven ideas:
- ClaimReview / known-claim reuse
- truth-aware claim matching
- evidence adequacy discipline
- repeat-claim monitoring

We reject product shapes that were optimized for:
- newsroom workflows
- heavy human operations
- event-only usage
- weak consumer UX standards

## Current Backend Judgment
The backend is already in a good state architecturally.

The strongest parts are:
- sane route split
- normalization / canonicalization layer starting to exist
- internal truth-aware reuse gating
- graceful degradation
- shared contracts
- persistence boundary thinking

The backend is no longer in the dangerous prototype zone of:
- embedding-only reuse
- live verification as the only serious path
- unclear provenance
- unstable route contracts

## What Is Implemented Today

### Implemented now
- top-candidate claim normalization in `analyze-chunk`
- heuristic checkworthiness scoring
- internal truth-aware memory matching in `verify-claim`
- explicit internal reuse gate
- external ClaimReview / Google Fact Check Tools match lane
- short-TTL public verify cache
- conflict resolver V0
- same-video duplicate clustering / suppression
- vector-store persistence of canonical claim metadata
- backend provenance fields in verify responses
- provenance UI mapping in the sidepanel

### Not implemented yet
- broader freshness policy across all evidence sources
- full retrieval-planner architecture
- richer operational dashboards beyond console telemetry

## Why We Are Not Changing Everything At Once
The target architecture is larger than a single safe patch.

Trying to implement:
- canonicalization
- external reuse
- conflict resolution
- duplicate clustering
- retrieval-planner decomposition

in one pass would create a high-risk, poorly testable system.

We are deliberately building it in slices that preserve route stability and keep the extension contract intact.

## Chosen Engineering Direction
The chosen direction is:

1. **match-first**
2. **truth-condition-aware reuse**
3. **public fact-check matching before expensive live verification**
4. **fresh verification as disciplined fallback**
5. **clear provenance**
6. **explicit conflict handling**
7. **duplicate suppression**

## What We Are Not Doing Yet
We are explicitly deferring:
- route split redesign
- SSE / streaming redesign
- queue/worker extraction architecture
- multi-provider verification orchestration
- API versioning as the next priority

Those may become useful later, but they are not the highest-leverage moves right now.

## Why
The main current systems risk is not route topology.
It is that too many claims still fall through to the expensive live verification path.

The best fix is to reduce miss-path frequency, not to redesign transport first.

## Next Lane We Are Choosing
The next backend lane is:

### Match-first hardening + observability

Specifically:
- keep the ClaimReview / Google Fact Check Tools lane narrow and non-blocking
- use strict direct reuse only for freshness-valid exact matches
- preserve context-only behavior on ambiguity
- log match-path outcomes, conflict outcomes, and cluster suppressions so we can measure impact

This is the highest-leverage next move for:
- latency
- cost
- trust
- product credibility

## Immediate Follow-on Work After That
After the current implemented slice:
1. richer quantity / time matching hardening
2. deploy-facing env/docs cleanup
3. optional operational dashboards or debug surfaces
4. full retrieval-planner decomposition only if miss-path latency remains high

## What Makes This Product Real
SourceCheck becomes a serious product when it is:
- fast on repeated claims
- careful on ambiguous claims
- consistent over time
- clear about provenance
- quietly reliable in ordinary viewing

That is the standard.

## Final Decision
We are not building a gimmick and we are not copying a failed brand.

We are building a consumer ambient fact-checking product that uses:
- the strongest proven architectural ideas
- only the complexity that materially improves trust, latency, cost, and reliability

### Current lead-engineering choice
Proceed with:
1. observability
2. external fact-check lane
3. quantity/time matching hardening
4. short-term verification cache
5. conflict resolver
6. duplicate clustering

## Status Update
As of the current implementation pass:
- items 1 through 6 above are implemented as a narrow, test-backed slice
- the next work is refinement, measurement, and rollout hardening rather than architectural reversal

That is the current system decision unless explicitly superseded.
