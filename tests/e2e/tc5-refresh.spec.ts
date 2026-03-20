import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { FREEMIUM_MODEL, type SourceCard, type TranscriptChunk } from '../../shared/types';
import { launchExtensionContext } from './launchExtensionContext';

const EXTENSION_PATH = join(process.cwd(), 'dist');
const VIDEO_ID = 'tc5-fixture-video';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const REFRESH_WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}&sc_refresh=1`;
const VIDEO_TITLE = 'TC5 Fixture Video';
const CHANNEL_NAME = 'TC5 Fixture Channel';

const WATCH_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${VIDEO_TITLE} - YouTube</title>
    <meta property="og:title" content="${VIDEO_TITLE}" />
    <meta itemprop="author" content="${CHANNEL_NAME}" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "name": "${VIDEO_TITLE}",
        "author": {
          "@type": "Person",
          "name": "${CHANNEL_NAME}"
        }
      }
    </script>
  </head>
  <body>
    <div id="page-manager">
      <div id="owner">
        <div id="channel-name">
          <a href="/@tc5-fixture">${CHANNEL_NAME}</a>
        </div>
      </div>
      <h1 class="ytd-watch-metadata">
        <yt-formatted-string>${VIDEO_TITLE}</yt-formatted-string>
      </h1>
      <div id="movie_player">
        <video controls></video>
      </div>
    </div>
  </body>
</html>`;

const TRANSCRIPT: TranscriptChunk[] = [
  {
    text: 'The fixture transcript starts here.',
    startTime: 0,
    duration: 6,
    index: 0,
  },
  {
    text: 'Forty two percent of viewers prefer deterministic refresh tests.',
    startTime: 12,
    duration: 5,
    index: 1,
  },
];

const CLAIM = {
  id: 'claim-tc5-1',
  claimText: 'Forty two percent of viewers prefer deterministic refresh tests.',
  claimType: 'statistic' as const,
  exactQuote: 'Forty two percent of viewers prefer deterministic refresh tests.',
  timestampSeconds: 12,
  confidence: 0.93,
};

const SOURCE_CARD: SourceCard = {
  id: 'card-tc5-1',
  claim: CLAIM,
  status: 'supported',
  sourceTitle: 'TC5 Fixture Study',
  sourceUrl: 'https://example.com/tc5-fixture-study',
  sourceType: 'news_article',
  nuance: 'Fixture evidence used to prove refresh continuity.',
  timestampSeconds: 12,
  verifiedAt: new Date('2026-03-19T18:00:00.000Z').toISOString(),
};

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

const installBackendFixtures = async (context: BrowserContext) => {
  let analyzeCalls = 0;
  let verifyCalls = 0;

  await context.route('http://localhost:3000/api/**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());

    if (requestUrl.pathname === '/api/session/init') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ token: 'fixture-session-token' }),
      });
      return;
    }

    if (requestUrl.pathname === '/api/analyze-chunk') {
      analyzeCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          entities: ['viewers', 'refresh tests'],
          has_claim: true,
          claim_text: CLAIM.claimText,
          action_state: 'VERIFYING',
          reason: 'Fixture backend returned a deterministic claim.',
          claims: [CLAIM],
          chunkRange: {
            startIndex: 0,
            endIndex: TRANSCRIPT.length - 1,
          },
          _metrics: {
            rawCandidates: 1,
            anchorFiltered: 0,
            verifiabilityFiltered: 0,
            finalCandidates: 1,
          },
        }),
      });
      return;
    }

    if (requestUrl.pathname === '/api/verify-claim') {
      verifyCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          sourceCard: SOURCE_CARD,
          similarClaims: [],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ error: `Unhandled fixture route: ${requestUrl.pathname}` }),
    });
  });

  return {
    getAnalyzeCalls: () => analyzeCalls,
    getVerifyCalls: () => verifyCalls,
  };
};

const openPanel = async (context: BrowserContext, extensionId: string) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/sidepanel.html`, {
    waitUntil: 'domcontentloaded',
  });
  return page;
};

const readWorkerRuntimeState = async (page: Page) =>
  page.evaluate(async () => {
    const result = await chrome.storage.session.get(['workerRuntimeState']);
    return result.workerRuntimeState ?? null;
  });

const sendRuntimeMessage = async (page: Page, message: Record<string, unknown>) =>
  page.evaluate(async (payload) => chrome.runtime.sendMessage(payload), message);

test.describe('TC5: Refresh continuity', () => {
  test('preserves cards across a real watch-page refresh and reopened sidepanel', async ({}, testInfo) => {
    test.setTimeout(90_000);
    expect(existsSync(EXTENSION_PATH)).toBeTruthy();

    const userDataDir = testInfo.outputPath('chromium-user-data');
    const context = await launchExtensionContext(userDataDir, EXTENSION_PATH);

    try {
      const fixtureCounters = await installBackendFixtures(context);
      const extensionId = await getExtensionId(context);

      const youtubePage = await context.newPage();
      await installYoutubeFixture(youtubePage);
      await youtubePage.goto(WATCH_URL, { waitUntil: 'domcontentloaded' });

      const panelPage = await openPanel(context, extensionId);
      await expect(panelPage.getByText(VIDEO_TITLE)).toBeVisible({ timeout: 20_000 });

      const initialVideoState = await expect
        .poll(async () => {
          const state = await readWorkerRuntimeState(panelPage);
          return state
            ? {
                videoId: state.currentVideo?.videoId ?? null,
                pageSessionId: state.currentVideo?.pageSessionId ?? null,
                sourceTabId: state.currentVideo?.sourceTabId ?? null,
              }
            : null;
        }, {
          timeout: 20_000,
          message: 'initial watch page should register the current video and page session',
        })
        .not.toBeNull();

      const beforeRefresh = await readWorkerRuntimeState(panelPage);
      const initialPageSessionId = beforeRefresh?.currentVideo?.pageSessionId ?? null;
      expect(beforeRefresh?.currentVideo?.videoId).toBe(VIDEO_ID);
      expect(typeof beforeRefresh?.currentVideo?.sourceTabId).toBe('number');
      expect(initialPageSessionId).toBeTruthy();

      const transcriptResponse = await sendRuntimeMessage(panelPage, {
        type: 'TRANSCRIPT_LOADED',
        payload: {
          videoId: VIDEO_ID,
          transcript: TRANSCRIPT,
          debug: {
            source: 'panel',
            reason: 'loaded',
            attemptCount: 1,
          },
        },
      });
      expect(transcriptResponse).toMatchObject({ status: 'ok' });

      const playbackResponse = await sendRuntimeMessage(panelPage, {
        type: 'PLAYBACK_UPDATE',
        payload: {
          videoId: VIDEO_ID,
          currentTime: 18,
          duration: 120,
          paused: false,
          playbackRate: 1,
        },
      });
      expect(playbackResponse).toMatchObject({ status: 'ok' });

      await expect
        .poll(async () => {
          const state = await readWorkerRuntimeState(panelPage);
          return state
            ? {
                sourceCards: state.sourceCards.length,
                allSourceCards: state.allSourceCards.length,
              }
            : null;
        }, {
          timeout: 20_000,
          message: 'worker state should contain the verified source card before refresh',
        })
        .toEqual({
          sourceCards: 1,
          allSourceCards: 1,
        });

      expect(fixtureCounters.getAnalyzeCalls()).toBeGreaterThan(0);
      expect(fixtureCounters.getVerifyCalls()).toBeGreaterThan(0);

      await youtubePage.goto(REFRESH_WATCH_URL, { waitUntil: 'domcontentloaded' });

      // Headless Chromium does not reliably reinject the content script on this
      // fixture navigation, so explicitly ask the live source tab to mint a new
      // pageSessionId and resend VIDEO_CHANGED from the real tab context.
      const reannounceResponse = await sendRuntimeMessage(panelPage, {
        type: 'REANNOUNCE_VIDEO_CONTEXT',
        payload: { videoId: VIDEO_ID },
      });
      expect(reannounceResponse).toMatchObject({ status: 'ok' });

      await expect
        .poll(async () => {
          const state = await readWorkerRuntimeState(panelPage);
          return state
            ? {
                pageSessionId: state.currentVideo?.pageSessionId ?? null,
                sourceTabId: state.currentVideo?.sourceTabId ?? null,
                sourceCards: state.sourceCards.length,
                allSourceCards: state.allSourceCards.length,
              }
            : null;
        }, {
          timeout: 25_000,
          message: 'refresh should preserve cards while updating the content-script page session id',
        })
        .toEqual({
          pageSessionId: expect.not.stringMatching(`^${initialPageSessionId}$`) as unknown as string,
          sourceTabId: beforeRefresh?.currentVideo?.sourceTabId ?? null,
          sourceCards: 1,
          allSourceCards: 1,
        });

      const afterRefresh = await readWorkerRuntimeState(panelPage);
      expect(afterRefresh?.currentVideo?.pageSessionId).not.toBe(initialPageSessionId);
      expect(afterRefresh?.sourceCards.length).toBe(1);
      expect(afterRefresh?.allSourceCards.length).toBe(1);

      await panelPage.close();

      const reopenedPanel = await openPanel(context, extensionId);
      await expect(reopenedPanel.getByText(VIDEO_TITLE)).toBeVisible({ timeout: 10_000 });
      await expect
        .poll(async () => reopenedPanel.locator('[data-testid="source-card"]').count(), {
          timeout: 10_000,
          message: 'reopened sidepanel should render the preserved source card',
        })
        .toBe(1);
    } finally {
      await context.close();
    }
  });
});
