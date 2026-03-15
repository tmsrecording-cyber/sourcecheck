import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { createManifest } from './src/manifest';

const isLocalReleaseHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '0.0.0.0' ||
  hostname === '::1' ||
  hostname.endsWith('.local') ||
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

const resolveApiBaseForCommand = (
  apiBase: string | undefined,
  command: 'build' | 'serve',
  mode: string
) => {
  const configured = apiBase?.trim();

  // Dev server (`npm run dev`) and explicit dev build (`npm run build:dev`,
  // i.e. `vite build --mode development`) both allow localhost and default to
  // localhost:3000.  Only production builds enforce the non-local URL lock.
  if (command === 'serve' || mode === 'development') {
    return configured || 'http://localhost:3000';
  }

  if (!configured) {
    throw new Error('VITE_API_BASE is required for release builds.');
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`VITE_API_BASE must be a valid absolute URL. Received: ${configured}`);
  }

  if (isLocalReleaseHost(parsed.hostname)) {
    throw new Error(`VITE_API_BASE must not point to a local/dev host in release builds. Received: ${configured}`);
  }

  return configured;
};

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = resolveApiBaseForCommand(env.VITE_API_BASE, command, mode);

  return {
    plugins: [react(), crx({ manifest: createManifest(apiBase) })],
  };
});
