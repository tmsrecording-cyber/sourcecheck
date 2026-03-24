import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  getRemoteLoggerEndpointFromStorage,
  REMOTE_LOG_ENDPOINT_KEY,
  shouldLoadRemoteLogger,
  validateRemoteLoggerEndpoint,
} from '../../src/content/remoteLoggerConfig';

describe('remote logger config', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the remote logger only in dev or development mode', () => {
    expect(shouldLoadRemoteLogger({ DEV: true, MODE: 'production' })).toBe(true);
    expect(shouldLoadRemoteLogger({ DEV: false, MODE: 'development' })).toBe(true);
    expect(shouldLoadRemoteLogger({ DEV: false, MODE: 'production' })).toBe(false);
  });

  it('accepts only loopback http endpoints', () => {
    expect(validateRemoteLoggerEndpoint('http://localhost:9223/log')).toBe('http://localhost:9223/log');
    expect(validateRemoteLoggerEndpoint('http://127.0.0.1:9223/log')).toBe('http://127.0.0.1:9223/log');
    expect(validateRemoteLoggerEndpoint('https://localhost:9223/log')).toBeNull();
    expect(validateRemoteLoggerEndpoint('http://example.com/log')).toBeNull();
    expect(validateRemoteLoggerEndpoint('not-a-url')).toBeNull();
  });

  it('reads endpoint config from extension-owned storage only', async () => {
    const storageArea = {
      get: vi.fn().mockResolvedValue({
        [REMOTE_LOG_ENDPOINT_KEY]: 'http://localhost:9223/log',
      }),
    };

    await expect(getRemoteLoggerEndpointFromStorage(storageArea)).resolves.toBe('http://localhost:9223/log');
    expect(storageArea.get).toHaveBeenCalledWith([REMOTE_LOG_ENDPOINT_KEY]);
  });

  it('warns once and disables invalid stored endpoint config', async () => {
    const storageArea = {
      get: vi.fn().mockResolvedValue({
        [REMOTE_LOG_ENDPOINT_KEY]: 'https://evil.example/log',
      }),
    };

    await expect(getRemoteLoggerEndpointFromStorage(storageArea)).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalledWith('[RemoteLogger] Disabled: invalid loopback endpoint config.');
  });
});
