import { expect, test, chromium, type BrowserContext, type Page, type Route } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSION_PATH = join(process.cwd(), 'dist');
const VIDEO_ID = 'smoke-video-id';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const WATCH_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Smoke Fixture Video - YouTube</title>
    <meta property="og:title" content="Smoke Fixture Video" />
    <meta itemprop="author" content="Smoke Fixture Channel" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": "Smoke Fixture Video",
        "author": {
          "@type": "Person",
          "name": "Smoke Fixture Channel"
        }
      }
    </script>
  </head>
  <body>
    <div id="page-manager">
      <div id="owner">
        <div id="channel-name">
          <a href="/@smoke-fixture">Smoke Fixture Channel</a>
        </div>
      </div>
      <h1 class="ytd-watch-metadata">
        <yt-formatted-string>Smoke Fixture Video</yt-formatted-string>
      </h1>
      <video controls></video>
    </div>
  </body>
</html>`;

const getExtensionId = async (context: BrowserContext) => {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  return new URL(serviceWorker.url()).host;
};

const installYoutubeFixture = async (page: Page) => {
  await page.route('https://www.youtube.com/**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.pathname === '/watch') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: WATCH_HTML,
      });
      return;
    }

    if (requestUrl.pathname === '/youtubei/v1/player') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          videoDetails: { videoId: VIDEO_ID },
        }),
      });
      return;
    }

    await route.fulfill({ status: 204, body: '' });
  });
};

const readWorkerRuntimeState = async (page: Page) =>
  page.evaluate(async () => {
    const result = await chrome.storage.session.get(['workerRuntimeState']);
    return result.workerRuntimeState ?? null;
  });

test('extension smoke: initializes on a YouTube watch page and enters transcript handling', async ({}, testInfo) => {
  test.setTimeout(90_000);

  expect(existsSync(EXTENSION_PATH)).toBeTruthy();

  const userDataDir = testInfo.outputPath('chromium-user-data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    const extensionId = await getExtensionId(context);
    const youtubePage = await context.newPage();
    await installYoutubeFixture(youtubePage);
    await youtubePage.goto(WATCH_URL, { waitUntil: 'domcontentloaded' });

    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/src/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(panelPage.getByText('Smoke Fixture Video')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(async () => {
        const state = await readWorkerRuntimeState(panelPage);
        return state
          ? {
              currentVideoId: state.currentVideo?.videoId ?? null,
              lifecycle: state.lifecycle,
            }
          : null;
      }, {
        timeout: 25_000,
        message: 'worker runtime state should capture the YouTube video',
      })
      .toMatchObject({
        currentVideoId: VIDEO_ID,
      });

    let finalState: { lifecycle: string; transcriptReason: string | null } | null = null;
    await expect
      .poll(async () => {
        const state = await readWorkerRuntimeState(panelPage);
        finalState = state
          ? {
              lifecycle: state.lifecycle,
              transcriptReason: state.transcriptDebug?.reason ?? null,
            }
          : null;
        return finalState;
      }, {
        timeout: 25_000,
        message: 'extension should begin transcript handling or intentionally mark transcript unavailable',
      })
      .not.toBeNull();

    expect([
      'video_detected',
      'playback_ready',
      'extracting_transcript',
      'transcript_buffering',
      'transcript_loaded',
      'transcript_unavailable',
      'analyzing',
      'verifying',
      'ready',
    ]).toContain(finalState!.lifecycle);

    if (finalState!.lifecycle === 'transcript_unavailable') {
      expect(finalState!.transcriptReason).toBeTruthy();
    }
  } finally {
    await context.close();
  }
});
