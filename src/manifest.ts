import type { ManifestV3Export } from '@crxjs/vite-plugin';

const getDefaultDevApiBase = () => 'http://localhost:3000';

const isLocalReleaseHost = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '0.0.0.0' ||
  hostname === '::1' ||
  hostname.endsWith('.local') ||
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

const resolveManifestApiBase = (apiBase?: string, allowLocal: boolean = true) => {
  const configured = apiBase?.trim();

  if (!configured) {
    if (allowLocal) {
      return getDefaultDevApiBase();
    }
    throw new Error('VITE_API_BASE is required for release builds.');
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`VITE_API_BASE must be a valid absolute URL. Received: ${configured}`);
  }

  if (!allowLocal && isLocalReleaseHost(parsed.hostname)) {
    throw new Error(`VITE_API_BASE must not point to a local/dev host in release builds. Received: ${configured}`);
  }

  return configured;
};

const getApiHostPermission = (apiBase: string) => {
  return `${new URL(apiBase).origin}/*`;
};

export const createManifest = (apiBase = getDefaultDevApiBase()): ManifestV3Export => ({
  manifest_version: 3,
  name: 'SourceCheck',
  version: '0.1.0',
  permissions: ['sidePanel', 'storage', 'declarativeNetRequest', 'declarativeNetRequestWithHostAccess'],
  host_permissions: [
    'https://www.youtube.com/*',
    getApiHostPermission(apiBase),
  ],
  declarative_net_request: {
    rule_resources: [
      {
        id: 'youtube_headers',
        enabled: true,
        path: 'rules.json',
      },
    ],
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['*://*.youtube.com/watch*'],
      js: ['src/content/index.ts'],
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel.html',
  },
  action: {
    default_title: 'Open SourceCheck',
  },
});

const manifestApiBase = import.meta.env?.PROD
  ? resolveManifestApiBase(process.env.VITE_API_BASE, false)
  : resolveManifestApiBase(process.env.VITE_API_BASE, true);

export default createManifest(manifestApiBase);
