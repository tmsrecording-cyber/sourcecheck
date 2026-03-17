/**
 * Security / correctness tests for Fix 5: Stale transcript persists after failure
 *
 * Fix 5 has two parts:
 *
 *   Part A — service-worker.ts: markTranscriptUnavailable() now clears
 *             currentTranscript and calls chrome.storage.local.remove('transcriptSnapshot').
 *
 *   Part B — sidepanel/App.tsx: the storage.onChanged listener no longer guards
 *             against null, so markTranscriptUnavailable's remove() call propagates
 *             to React state and clears the stale transcript.
 *
 * Part A: tested by importing the real service-worker.ts with a Chrome API mock,
 *   then triggering the TRANSCRIPT_FAILED message path and asserting on the mock.
 *
 * Part B: App.tsx requires jsdom + React to mount. Because the sidepanel is a
 *   browser extension UI, we use source-level assertions as a regression guard:
 *   the tests fail if the null guard is re-added or the unconditional setTranscript
 *   call is removed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
 * and waits for the async inner function to settle.
 */
async function sendMessage(
  listener: (msg: unknown, sender: unknown, sendResponse: () => void) => void,
  message: unknown
): Promise<void> {
  const sendResponse = vi.fn();
  listener(message, { tab: null }, sendResponse);
  // Yield to allow the async IIFE inside the listener to run to completion.
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
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

    expect(chrome.storage.local.remove).toHaveBeenCalledWith('transcriptSnapshot');
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

    // App.tsx reads 'transcriptSnapshot' from local storage to populate transcript.
    // If the key used in remove() ever drifts, the clear-on-failure mechanism breaks.
    const removeCall = (chrome.storage.local.remove.mock.calls as unknown[][]).find(
      ([key]) => key === 'transcriptSnapshot'
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

    // Failure arrives for video B — must be silently ignored.
    await sendMessage(listener, {
      type: 'TRANSCRIPT_FAILED',
      payload: { videoId: 'video-b', debug: { source: null, reason: 'timeout', attemptCount: 1 } },
    });

    expect(chrome.storage.local.remove).not.toHaveBeenCalledWith('transcriptSnapshot');
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

  it('PASS: storage listener does not guard against null transcript', () => {
    // The hook derives `nextTranscript` from readTranscriptSnapshotForVideo(...),
    // then must call setTranscript(nextTranscript) without null-guarding.
    expect(storageHookSource).not.toMatch(/if\s*\(\s*nextTranscript\s*!==\s*null\s*\)/);
  });

  it('PASS: storage listener sets transcript unconditionally', () => {
    expect(storageHookSource).toMatch(/setTranscript\(nextTranscript\)/);
  });

  it('PASS: readTranscriptSnapshotForVideo returns null for undefined snapshotValue', () => {
    // When the worker calls chrome.storage.local.remove('transcriptSnapshot'), Chrome
    // fires storage.onChanged with newValue === undefined. The helper must return
    // null so setTranscript(null) clears stale UI state.
    expect(stateUtilsSource).toMatch(/if\s*\(!snapshotValue[\s\S]*?return null/);
  });
});
