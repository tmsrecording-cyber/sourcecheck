type StorageAreaWithAccessLevel = {
  setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) => Promise<void>;
};

export type StorageHardeningAreaStatus = 'hardened' | 'unsupported' | 'failed';

export interface StorageHardeningAreaResult {
  area: 'local' | 'session';
  status: StorageHardeningAreaStatus;
}

export interface StorageHardeningResult {
  degraded: boolean;
  areas: StorageHardeningAreaResult[];
}

const TRUSTED_CONTEXTS = { accessLevel: 'TRUSTED_CONTEXTS' as const };

const hardenArea = async (
  label: 'local' | 'session',
  area: StorageAreaWithAccessLevel | undefined,
): Promise<StorageHardeningAreaResult> => {
  if (!area || typeof area.setAccessLevel !== 'function') {
    return { area: label, status: 'unsupported' };
  }

  try {
    await area.setAccessLevel(TRUSTED_CONTEXTS);
    return { area: label, status: 'hardened' };
  } catch (error) {
    console.warn(`[SourceCheck/Storage] Failed to harden ${label} storage access level.`, error);
    return { area: label, status: 'failed' };
  }
};

export async function hardenStorageAccessLevels(): Promise<StorageHardeningResult> {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return {
      degraded: false,
      areas: [
        { area: 'local', status: 'unsupported' },
        { area: 'session', status: 'unsupported' },
      ],
    };
  }

  const areas = await Promise.all([
    hardenArea('local', chrome.storage.local as StorageAreaWithAccessLevel | undefined),
    hardenArea('session', chrome.storage.session as StorageAreaWithAccessLevel | undefined),
  ]);

  return {
    degraded: areas.some((area) => area.status === 'failed'),
    areas,
  };
}
