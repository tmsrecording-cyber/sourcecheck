import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hardenStorageAccessLevels } from '../../src/utils/storageAccess';

describe('hardenStorageAccessLevels', () => {
  const originalChrome = globalThis.chrome;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalChrome === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.chrome;
    } else {
      vi.stubGlobal('chrome', originalChrome);
    }
  });

  it('hardens local and session storage to trusted contexts', async () => {
    const localSetAccessLevel = vi.fn().mockResolvedValue(undefined);
    const sessionSetAccessLevel = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('chrome', {
      storage: {
        local: { setAccessLevel: localSetAccessLevel },
        session: { setAccessLevel: sessionSetAccessLevel },
      },
    });

    await hardenStorageAccessLevels();

    expect(localSetAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(sessionSetAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('does not throw when access-level APIs are missing', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {},
        session: {},
      },
    });

    await expect(hardenStorageAccessLevels()).resolves.toBeUndefined();
  });

  it('does not throw when a storage area rejects', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: { setAccessLevel: vi.fn().mockRejectedValue(new Error('local failed')) },
        session: { setAccessLevel: vi.fn().mockRejectedValue(new Error('session failed')) },
      },
    });

    await expect(hardenStorageAccessLevels()).resolves.toBeUndefined();
  });
});
