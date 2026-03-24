const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export const REMOTE_LOG_ENDPOINT_KEY = 'scRemoteLogEndpoint';

type RemoteLoggerEnv = {
  DEV?: boolean;
  MODE?: string;
};

type SessionStorageAreaLike = {
  get: (keys: string[] | string) => Promise<Record<string, unknown>> | Record<string, unknown>;
};

export const shouldLoadRemoteLogger = (env: RemoteLoggerEnv): boolean =>
  Boolean(env.DEV || env.MODE === 'development');

export const validateRemoteLoggerEndpoint = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

export async function getRemoteLoggerEndpointFromStorage(
  storageArea: SessionStorageAreaLike | undefined,
): Promise<string | null> {
  if (!storageArea || typeof storageArea.get !== 'function') {
    return null;
  }

  try {
    const stored = await storageArea.get([REMOTE_LOG_ENDPOINT_KEY]);
    const rawValue = stored[REMOTE_LOG_ENDPOINT_KEY];
    const endpoint = validateRemoteLoggerEndpoint(rawValue);

    if (!endpoint && typeof rawValue === 'string' && rawValue.trim()) {
      console.warn('[RemoteLogger] Disabled: invalid loopback endpoint config.');
    }

    return endpoint;
  } catch {
    return null;
  }
}
