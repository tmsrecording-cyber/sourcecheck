import { chromium, type BrowserContext } from '@playwright/test';

const EXTENSION_LAUNCH_ATTEMPTS = 2;
const EXTENSION_LAUNCH_RETRY_DELAY_MS = 750;

const shouldRetryLaunch = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('launchPersistentContext') ||
    error.message.includes('Target page, context or browser has been closed') ||
    error.message.includes('SIGABRT')
  );
};

export async function launchExtensionContext(
  userDataDir: string,
  extensionPath: string
): Promise<BrowserContext> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= EXTENSION_LAUNCH_ATTEMPTS; attempt += 1) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
        ],
      });
    } catch (error) {
      lastError = error;

      if (attempt === EXTENSION_LAUNCH_ATTEMPTS || !shouldRetryLaunch(error)) {
        throw error;
      }

      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, EXTENSION_LAUNCH_RETRY_DELAY_MS);
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to launch extension browser context.');
}
