# SourceCheck Manual Test Matrix

## Test Case 1: Normal Captioned Video

| Field | Value |
|-------|-------|
| **Trigger** | Navigate to any YouTube video with manual captions (e.g., Veritasium, Kurzgesagt) |
| **Expected Lifecycle** | `idle` → `video_detected` → `playback_ready` → `extracting_transcript` → `transcript_buffering` → `transcript_loaded` → `analyzing` → `ready` |
| **Critical Logs** | `[transcript] source=window reason=caption-tracks-found` OR `[transcript] source=html reason=caption-tracks-found via=innertube` → `TRANSCRIPT_BATCH_START` → `TRANSCRIPT_BATCH_APPEND` → `TRANSCRIPT_LOADED` → `analyze-chunk request` → `analyze-chunk response status=200` |
| **User-Visible Result** | "Monitoring" status, transcript preview visible, claim cards appear within 30-60s |
| **Failure Signatures** | Stuck on "Loading transcript..." > 65s; `transcript_status_sent` with `reason=no-caption-tracks`; `fetch-failed` in logs; No `TRANSCRIPT_LOADED` |

---

## Test Case 2: Auto-Captioned Video

| Field | Value |
|-------|-------|
| **Trigger** | Navigate to video with ASR captions only (e.g., casual vlog, live stream VOD) |
| **Expected Lifecycle** | Same as Case 1, but transcript source should select ASR track |
| **Critical Logs** | `[transcript] source=html reason=caption-tracks-found` with ASR track in `transcriptFetchLog`; `track_selected` with `kind=asr` |
| **User-Visible Result** | Same as Case 1 - auto-captions should work identically |
| **Failure Signatures** | `reason=no-usable-track`; `panel-open-exhausted` (panel fallback shouldn't be needed for ASR); Stuck in `extracting_transcript` |

---

## Test Case 3: Seek Forward/Backward

| Field | Value |
|-------|-------|
| **Trigger** | While video is playing with active analysis, click timeline to seek to different position |
| **Expected Lifecycle** | `VIDEO_SEEKED` → `flushPipelineForSeek` → `ANALYZE_STARTED` → Resume `analyzing` from new position |
| **Critical Logs** | `VIDEO_SEEKED` message; `Seek detected: nextChunk=X currentTime=Y. Repositioning.`; `analyze-chunk request` with new `currentTime`; `verification batch starting` for new claims |
| **User-Visible Result** | Status briefly shows "Repositioning cognitive scan...", then resumes; New claims from new position appear; Old claims outside 15s leash hidden |
| **Failure Signatures** | `lastProcessedIndex` not updated (keeps scanning from old position); Duplicate claims for same timestamp; Status stuck on "Repositioning..."; Cards disappear and don't return |

---

## Test Case 4: Switch to Different Video

| Field | Value |
|-------|-------|
| **Trigger** | While analyzing Video A, click on related video to load Video B |
| **Expected Lifecycle** | `VIDEO_CHANGED` (Video B) → `resetSessionState` → `transcript_unavailable` (Video A cleanup) → New `extracting_transcript` → `transcript_loaded` → `analyzing` |
| **Critical Logs** | `VIDEO_CHANGED` with `mergedMetadataOnly=false`; `resetSessionState` clears all state; `TRANSCRIPT_SNAPSHOT_KEY` cleared for old video; New transcript fetch for video B |
| **User-Visible Result** | UI resets to "Loading transcript..." for new video; Old cards cleared; New analysis starts within 30s |
| **Failure Signatures** | Old transcript still displayed; Cards from Video A shown for Video B; `video-mismatch` in logs; `TRANSCRIPT_FAILED` with stale videoId |

---

## Test Case 5: Refresh Page Mid-Session

| Field | Value |
|-------|-------|
| **Trigger** | Press F5 while video is playing and analysis is active |
| **Expected Lifecycle** | Extension: `hydrateState` → Restore from `TRANSCRIPT_SNAPSHOT_KEY` → `HYDRATED_FROM_SNAPSHOT` → Resume `analyzing` if playback known |
| **Critical Logs** | `HYDRATED_FROM_SNAPSHOT` with chunk count; `hydrated_from_snapshot` debug stage; `analyze-chunk request` resumes from `lastProcessedIndex` |
| **User-Visible Result** | Sidepanel shows "Restoring..." briefly; Cards from before refresh reappear; Analysis continues from where it left off |
| **Failure Signatures** | `transcriptChunkCount=0` after hydration; `sourceCards` empty after restore; `lastProcessedIndex=-1` (restart from beginning); Duplicate cards for same claims |

---

## Test Case 6: No Transcript Available

| Field | Value |
|-------|-------|
| **Trigger** | Navigate to video with no captions and no auto-captions (e.g., music video, some foreign language content) |
| **Expected Lifecycle** | `extracting_transcript` → `transcript_failed_sent` → `transcript_unavailable` |
| **Critical Logs** | `reason=no-caption-tracks`; `TRANSCRIPT_FAILED` message; `markTranscriptUnavailable` called; `transcriptSnapshot` cleared; `ANALYZE_COMPLETED claimCount=0` |
| **User-Visible Result** | Status shows "No transcript available for this video"; Ask box disabled; No infinite loading |
| **Failure Signatures** | Stuck on "Loading transcript..." forever; `transcript_status_sent` with `reason=pending` looping; No `TRANSCRIPT_FAILED` after 65s timeout |

---

## Test Case 7: Model Change + Reload Persistence

| Field | Value |
|-------|-------|
| **Trigger** | 1. Open model picker, select different model (e.g., Flash 3), 2. Reload extension/page, 3. Check model persisted |
| **Expected Lifecycle** | `MODEL_CHANGED` → Persist to `chrome.storage.sync` → `hydrateState` restores → UI shows selected model → API calls use selected model |
| **Critical Logs** | `[SourceCheck/SW] Model changed to: gemini-3-flash`; `storage.sync.set {selectedModel}`; After reload: `selectedModel` in `runtimeState`; `analyze-chunk` request includes `model` field |
| **User-Visible Result** | Model picker shows selected model after reload; Analysis continues with selected model; No errors in console |
| **Failure Signatures** | Model reverts to default after reload; `selectedModel` undefined in `runtimeState`; UI shows different model than backend uses; 400 error from backend (invalid model) |

---

## Test Case 8: Ask Question After Transcript + After Verified Cards Exist

| Field | Value |
|-------|-------|
| **Trigger** | 1. Let transcript load and cards appear, 2. Type question in Ask box, 3. Submit |
| **Expected Lifecycle** | `ASK_QUESTION` message → `askVideoQuestion` → `ask-video request` → Response with answer → History entry added |
| **Critical Logs** | `ask-video request video=X transcriptContext=Y sourceCards=Z`; `ask-video response video=X status=200`; Response includes `answer` and `sources` |
| **User-Visible Result** | Answer appears in feed with sources; Sources are clickable; Follow-up questions work |
| **Failure Signatures** | "No transcript or source cards are available yet" error; `ask-video` 400/500 error; Empty answer; Sources missing URLs; Answer unrelated to video content |

---

## Required Checkpoint Log Entries

| Checkpoint | Log Pattern | Status |
|------------|-------------|--------|
| VIDEO_CHANGED | `\[SourceCheck/SW\]\[message\] messageType=VIDEO_CHANGED` | ✅ Present |
| TRANSCRIPT_STATUS | `\[SourceCheck\]\[transcript\] source=.* reason=` | ✅ Present |
| TRANSCRIPT_BATCH_START | `\[SourceCheck/SW\]\[message\] messageType=TRANSCRIPT_BATCH_START` | ✅ Present |
| TRANSCRIPT_BATCH_APPEND | `\[SourceCheck/SW\]\[message\] messageType=TRANSCRIPT_BATCH_APPEND` | ✅ Present |
| TRANSCRIPT_LOADED | `\[SourceCheck/SW\] Transcript loaded: N chunks` | ✅ Present |
| TRANSCRIPT_FAILED | `\[SourceCheck/SW\]\[message\] messageType=TRANSCRIPT_FAILED` | ✅ Present |
| analyze-chunk start | `\[SourceCheck/SW\] analyze-chunk request video=` | ✅ Present |
| analyze-chunk response | `\[SourceCheck/SW\] analyze-chunk response video=.* status=` | ✅ Present |
| verify-claim start | `\[SourceCheck/SW\] verify-claim request video=` | ✅ Present |
| verify-claim response | `\[SourceCheck/SW\] verify-claim response video=.* status=` | ✅ Present |
| MODEL_CHANGED persisted | `\[SourceCheck/SW\] Model changed to:` | ✅ Present |
| ask-video start | `\[SourceCheck/SW\] ask-video request video=` | ✅ Present |
| ask-video response | `\[SourceCheck/SW\] ask-video response video=.* status=` | ✅ Present |

---

## Log Verbosity Checklist

All critical checkpoints are **already observable** in current code. No additional logging needed for Phase 1.

- VIDEO_CHANGED: Line 1797 in service-worker.ts
- TRANSCRIPT_STATUS: Line 251 in transcript.ts via content script
- TRANSCRIPT_BATCH_START: Line 1843 in service-worker.ts
- TRANSCRIPT_BATCH_APPEND: Line 1871 in service-worker.ts
- TRANSCRIPT_LOADED: Line 1943 in service-worker.ts
- TRANSCRIPT_FAILED: Line 2002 in service-worker.ts
- analyze-chunk: Lines 1678, 1693 in service-worker.ts
- verify-claim: Lines 1391, 1403 in service-worker.ts
- MODEL_CHANGED: Line 2024 in service-worker.ts
- ask-video: Lines 1605, 1612 in service-worker.ts
