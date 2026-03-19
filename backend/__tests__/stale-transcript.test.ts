/**
 * Security / correctness tests for Fix 5: Stale transcript persists after failure
 *
 * Fix 5 has two parts:
 *
 *   Part A — service-worker.ts: markTranscriptUnavailable() now clears
 *             currentTranscript and calls chrome.storage.local.remove(TRANSCRIPT_SNAPSHOT_KEY).
 *             (Worker uses the constant; we assert against the canonical key value.)
 *
 *   Part B — sidepanel/App.tsx: the storage.onChanged listener no longer guards
 *             against null, so markTranscriptUnavailable's remove() call propagates
 *             to React state and clears the stale transcript.
 *
 * Part A: tested by importing the real service-worker.ts with a Chrome API mock,
 *   then triggering the TRANSCRIPT_FAILED message path and asserting on the mock.
 *
 * Part B: App.tsx requires jsdom + React to mount. Because the sidepanel is a
 *   browser extension UI, we use source-level assertions as a BRITTLE regression guard:
 *   the tests fail if the null guard is re-added or the unconditional setTranscript
 *   call is removed. These are intentionally fragile to catch logic regressions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Canonical storage key used by service-worker.ts (keep in sync with src/background/service-worker.ts)
const TRANSCRIPT_SNAPSHOT_KEY = 'transcriptSnapshot';

// ---------------------------------------------------------------------------
// Chrome API mock factory — must be installed before the service worker module
// is imported, since module-level code (chrome.sidePanel.setPanelBehavior,
// chrome.runtime.onMessage.addListener) runs at import time.
// ---------------------------------------------------------------------------
function makeChromeMock() {
  return {
    sidePanel: {
      // Called at module initialisation: chrome.sidePanel.setPanelBehavior(...)
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      onMessage: {
        // Captures the message listener the service worker registers.
        addListener: vi.fn(),
      },
      lastError: null,
    },
    storage: {
      local: {
        // hydrateState() reads local storage; return empty object by default.
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockImplementation((_data: unknown, cb?: () => void) => { cb?.(); }),
        // This is the key assertion target for Fix 5 Part A.
        remove: vi.fn().mockImplementation((_keys: unknown, cb?: () => void) => { cb?.(); }),
      },
      session: {
        // hydrateState() and persistPanelState() use session storage.
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockImplementation((_data: unknown, cb?: () => void) => { cb?.(); }),
      },
      sync: {
        // Model preference storage
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockImplementation((_data: unknown, cb?: () => void) => { cb?.(); }),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      get: vi.fn().mockResolvedValue(null),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
}

type ChromeMock = ReturnType<typeof makeChromeMock>;

/**
 * Sends a message through the service worker's chrome.runtime.onMessage handler
 * and resolves when sendResponse is called (or after a safety timeout).
 * This is more robust than a fixed delay because it waits for actual completion.
 */
async function sendMessage(
  listener: (msg: unknown, sender: unknown, sendResponse: () => void) => void,
  message: unknown,
  timeoutMs = 100
): Promise<void> {
  const sendResponse = vi.fn();
  
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`sendMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const wrappedSendResponse = () => {
      clearTimeout(timeoutId);
      resolve();
    };
    
    listener(message, { tab: null }, wrappedSendResponse);
  });
}

// ---------------------------------------------------------------------------
// Part A — service-worker.ts (real module, Chrome mocked)
// ---------------------------------------------------------------------------
describe('Fix 5 Part A: markTranscriptUnavailable removes transcript snapshot from storage', () => {
  let chrome: ChromeMock;

  beforeEach(() => {
    // Fresh module state and fresh Chrome mock for every test.
    vi.resetModules();
    chrome = makeChromeMock();
    vi.stubGlobal('chrome', chrome);
  });

  it('PASS: chrome.storage.local.remove("transcriptSnapshot") is called on transcript failure', async () => {
    // Import the real service worker — module-level code runs with Chrome mock in place.
    await import('../../src/background/service-worker');

    // The service worker calls chrome.runtime.onMessage.addListener during init.
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0];
    expect(listener, 'service worker must register an onMessage listener').toBeDefined();

    // Establish a video context so that the TRANSCRIPT_FAILED message is not
    // silently ignored (it is ignored when videoId does not match currentVideoInfo).
    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: {
        videoId: 'yt-test-001',
        title: 'Test Video',
        channel: 'Test Channel',
        pageSessionId: 'ps-1',
      },
    });

    // Trigger the failure path → markTranscriptUnavailable() → remove('transcriptSnapshot')
    await sendMessage(listener, {
      type: 'TRANSCRIPT_FAILED',
      payload: {
        videoId: 'yt-test-001',
        debug: { source: null, reason: 'fetch-failed', attemptCount: 1 },
      },
    });

    expect(chrome.storage.local.remove).toHaveBeenCalledWith(TRANSCRIPT_SNAPSHOT_KEY, expect.any(Function));
  });

  it('PASS: exact storage key "transcriptSnapshot" is used — App.tsx and worker agree', async () => {
    await import('../../src/background/service-worker');

    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: { videoId: 'yt-test-002', title: 'T', channel: 'C', pageSessionId: 'ps-2' },
    });

    await sendMessage(listener, {
      type: 'TRANSCRIPT_FAILED',
      payload: { videoId: 'yt-test-002', debug: { source: null, reason: 'timeout', attemptCount: 1 } },
    });

    // App.tsx reads transcriptSnapshot from local storage to populate transcript.
    // If the key used in remove() ever drifts, the clear-on-failure mechanism breaks.
    const removeCall = (chrome.storage.local.remove.mock.calls as unknown[][]).find(
      ([key]) => key === TRANSCRIPT_SNAPSHOT_KEY
    );
    expect(removeCall).toBeDefined();
  });

  it('PASS: TRANSCRIPT_FAILED for a different video id is ignored — correct video cleared only', async () => {
    await import('../../src/background/service-worker');

    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

    // Set up video A as the active video.
    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: { videoId: 'video-a', title: 'T', channel: 'C', pageSessionId: 'ps-3' },
    });

    // Clear mock history to ensure we only count calls from this test
    chrome.storage.local.remove.mockClear();

    // Failure arrives for video B — must be silently ignored.
    await sendMessage(listener, {
      type: 'TRANSCRIPT_FAILED',
      payload: { videoId: 'video-b', debug: { source: null, reason: 'timeout', attemptCount: 1 } },
    });

    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
  });

  it('PASS: after VIDEO_CHANGED then TRANSCRIPT_FAILED, persisted state has no transcript chunks', async () => {
    await import('../../src/background/service-worker');

    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];

    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: { videoId: 'yt-test-003', title: 'T', channel: 'C', pageSessionId: 'ps-4' },
    });

    await sendMessage(listener, {
      type: 'TRANSCRIPT_FAILED',
      payload: { videoId: 'yt-test-003', debug: { source: null, reason: 'timeout', attemptCount: 1 } },
    });

    // The worker syncs module state → runtimeState before every session.set call.
    // After markTranscriptUnavailable(), currentTranscript is [], so
    // runtimeState.transcriptChunkCount must be 0 in the persisted payload.
    const sessionSetCalls = chrome.storage.session.set.mock.calls;
    const lastPayload = sessionSetCalls[sessionSetCalls.length - 1]?.[0] as Record<string, unknown> | undefined;
    const persistedRuntime = lastPayload?.workerRuntimeState as { transcriptChunkCount?: number } | undefined;
    expect(persistedRuntime?.transcriptChunkCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Part B — App.tsx (source-level regression guard)
//
// App.tsx is the sidepanel React component. Mounting it requires jsdom + React
// Testing Library, which are not part of this backend test setup. Instead we
// verify the null-guard removal through source inspection: if the guard were
// re-added, these tests would fail immediately.
// ---------------------------------------------------------------------------
describe('Fix 5 Part B: App.tsx storage listener propagates null transcript to React state', () => {
  const storageHookSource = readFileSync(
    resolve(__dirname, '../../src/sidepanel/hooks/useExtensionStorage.ts'),
    'utf-8'
  );

  const stateUtilsSource = readFileSync(
    resolve(__dirname, '../../src/sidepanel/utils/state.ts'),
    'utf-8'
  );

  it('PASS: storage listener does not guard against null transcript (BRITTLE: regex-based)', () => {
    // BRITTLE REGRESSION GUARD: This test uses regex to detect the null guard.
    // It will break on harmless refactors (renames, formatting). That's intentional:
    // we want to catch if the guard is re-added. If this breaks, verify the logic
    // still propagates null and update the regex accordingly.
    expect(storageHookSource).not.toMatch(/if\s*\(\s*nextTranscript\s*!==\s*null\s*\)/);
  });

  it('PASS: storage listener queues transcript update unconditionally (BRITTLE: regex-based)', () => {
    // BRITTLE REGRESSION GUARD: This test uses regex to verify the call pattern.
    // It will break on harmless refactors. That's intentional: we want to catch
    // if the unconditional setTranscript is replaced with a guarded version.
    // The hook assigns to pendingUpdates.transcript and flushes via setTranscript().
    // The important thing is that the transcript value (even if null) is propagated without guards.
    expect(storageHookSource).toMatch(/pendingUpdates\.transcript\s*=\s*readTranscriptSnapshotForVideo\(/);
  });

  it('PASS: readTranscriptSnapshotForVideo returns null for undefined snapshotValue (BRITTLE: regex-based)', () => {
    // BRITTLE REGRESSION GUARD: This test uses regex to verify the early-return pattern.
    // It will break on harmless refactors. That's intentional: we want to catch
    // if the null-return behavior changes, which would break stale-transcript clearing.
    // When the worker calls chrome.storage.local.remove(TRANSCRIPT_SNAPSHOT_KEY), Chrome
    // fires storage.onChanged with newValue === undefined. The helper must return
    // null so setTranscript(null) clears stale UI state.
    expect(stateUtilsSource).toMatch(/if\s*\(!snapshotValue[\s\S]*?return null/);
  });
});
