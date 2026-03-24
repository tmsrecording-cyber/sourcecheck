import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeChromeMock() {
  return {
    sidePanel: {
      setPanelBehavior: vi.fn().mockResolvedValue(undefined),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn(),
      },
      lastError: null,
      id: 'test-extension-id',
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockImplementation((_data: unknown, cb?: () => void) => { cb?.(); }),
        remove: vi.fn().mockImplementation((_keys: unknown, cb?: () => void) => { cb?.(); }),
      },
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockImplementation((_data: unknown, cb?: () => void) => { cb?.(); }),
        remove: vi.fn().mockImplementation((_keys: unknown, cb?: () => void) => { cb?.(); }),
      },
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockImplementation((_data: unknown, cb?: () => void) => { cb?.(); }),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      get: vi.fn(),
      sendMessage: vi.fn(),
    },
  };
}

type ChromeMock = ReturnType<typeof makeChromeMock>;

type RuntimeMessageListener = (
  msg: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void
) => boolean | void | Promise<unknown>;

async function sendMessage(
  listener: RuntimeMessageListener,
  message: unknown,
  sender: unknown = { tab: null },
  timeoutMs = 100,
): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`sendMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const wrappedSendResponse = (response?: unknown) => {
      clearTimeout(timeoutId);
      resolve(response);
    };

    listener(message, sender, wrappedSendResponse);
  });
}

describe('service-worker source-tab validation for retry/reannounce', () => {
  let chrome: ChromeMock;

  beforeEach(() => {
    vi.resetModules();
    chrome = makeChromeMock();
    vi.stubGlobal('chrome', chrome);
  });

  it('accepts the correct Google Meet tab including a trailing slash', async () => {
    await import('../../src/background/service-worker');
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0] as RuntimeMessageListener;

    chrome.tabs.get.mockResolvedValue({
      id: 7,
      url: 'https://meet.google.com/abc-defg-hij/?authuser=1',
    });
    chrome.tabs.sendMessage.mockResolvedValue({ status: 'ok' });

    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: {
        videoId: 'abc-defg-hij',
        title: 'Standup',
        channel: 'Google Meet',
        sourceTabId: 7,
        pageSessionId: 'meet-session-1',
        sourceContext: {
          type: 'meet',
          visibility: 'private',
          sourceId: 'abc-defg-hij',
          sourceLabel: 'Standup',
        },
      },
    });

    await expect(sendMessage(listener, {
      type: 'RETRY_TRANSCRIPT',
      payload: { videoId: 'abc-defg-hij' },
    })).resolves.toEqual({ status: 'ok' });

    await expect(sendMessage(listener, {
      type: 'REANNOUNCE_VIDEO_CONTEXT',
      payload: { videoId: 'abc-defg-hij' },
    })).resolves.toEqual({ status: 'ok' });
  });

  it('rejects a mismatched Google Meet tab', async () => {
    await import('../../src/background/service-worker');
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0] as RuntimeMessageListener;

    chrome.tabs.get.mockResolvedValue({
      id: 7,
      url: 'https://meet.google.com/zzz-yyyy-xxx?authuser=1',
    });

    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: {
        videoId: 'abc-defg-hij',
        title: 'Standup',
        channel: 'Google Meet',
        sourceTabId: 7,
        pageSessionId: 'meet-session-2',
        sourceContext: {
          type: 'meet',
          visibility: 'private',
          sourceId: 'abc-defg-hij',
          sourceLabel: 'Standup',
        },
      },
    });

    await expect(sendMessage(listener, {
      type: 'RETRY_TRANSCRIPT',
      payload: { videoId: 'abc-defg-hij' },
    })).resolves.toEqual({
      status: 'error',
      error: 'The source tab no longer matches the active video.',
    });
  });

  it('preserves YouTube validation for real watch URLs and rejects non-YouTube hosts with v params', async () => {
    await import('../../src/background/service-worker');
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0]?.[0] as RuntimeMessageListener;

    chrome.tabs.get.mockResolvedValue({
      id: 11,
      url: 'https://www.youtube.com/watch?v=yt-video-123&t=90s',
    });
    chrome.tabs.sendMessage.mockResolvedValue({ status: 'ok' });

    await sendMessage(listener, {
      type: 'VIDEO_CHANGED',
      payload: {
        videoId: 'yt-video-123',
        title: 'Fixture Video',
        channel: 'Fixture Channel',
        sourceTabId: 11,
        pageSessionId: 'yt-session-1',
        sourceContext: {
          type: 'youtube',
          visibility: 'public',
          sourceId: 'yt-video-123',
          sourceLabel: 'Fixture Video',
        },
      },
    });

    await expect(sendMessage(listener, {
      type: 'RETRY_TRANSCRIPT',
      payload: { videoId: 'yt-video-123' },
    })).resolves.toEqual({ status: 'ok' });

    chrome.tabs.get.mockResolvedValue({
      id: 11,
      url: 'https://example.com/watch?v=yt-video-123',
    });

    await expect(sendMessage(listener, {
      type: 'REANNOUNCE_VIDEO_CONTEXT',
      payload: { videoId: 'yt-video-123' },
    })).resolves.toEqual({
      status: 'error',
      error: 'The source tab no longer matches the active video.',
    });
  });
});
