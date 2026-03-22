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
  minimum_chrome_version: '114',
  name: 'SourceCheck',
  version: '0.1.1',
  description: 'Live AI fact-checking as you watch YouTube. Spots claims, finds sources, and shows what\'s verified — in real time.',
  icons: {
    '16': 'icons/16.png',
    '32': 'icons/32.png',
    '48': 'icons/48.png',
    '128': 'icons/128.png',
  },
  permissions: ['sidePanel', 'storage', 'declarativeNetRequest', 'declarativeNetRequestWithHostAccess'],
  host_permissions: [
    '*://*.youtube.com/*',
    '*://meet.google.com/*',
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
    {
      matches: ['*://meet.google.com/*'],
      js: ['src/content/index.ts'],
    },
  ],
  side_panel: {
    default_path: 'src/sidepanel.html',
  },
  action: {
    default_title: 'Open SourceCheck',
  },
  // Restrict extension page scripts to same-origin only; no eval, no inline scripts
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self';",
  },
  // Explicitly disable web_accessible_resources for security
  // The content script runs in isolated world; no page script injection needed
  web_accessible_resources: [],
});

const manifestApiBase = import.meta.env?.PROD
  ? resolveManifestApiBase(process.env.VITE_API_BASE, false)
  : resolveManifestApiBase(process.env.VITE_API_BASE, true);

export default createManifest(manifestApiBase);
