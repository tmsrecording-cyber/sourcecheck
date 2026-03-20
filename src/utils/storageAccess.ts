type StorageAreaWithAccessLevel = {
  setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }) => Promise<void>;
};

const TRUSTED_CONTEXTS = { accessLevel: 'TRUSTED_CONTEXTS' as const };

const hardenArea = async (label: 'local' | 'session', area: StorageAreaWithAccessLevel | undefined) => {
  if (!area || typeof area.setAccessLevel !== 'function') {
    return;
  }

  try {
    await area.setAccessLevel(TRUSTED_CONTEXTS);
  } catch (error) {
    console.warn(`[SourceCheck/Storage] Failed to harden ${label} storage access level.`, error);
  }
};

export async function hardenStorageAccessLevels(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    return;
  }

  await Promise.all([
    hardenArea('local', chrome.storage.local as StorageAreaWithAccessLevel | undefined),
    hardenArea('session', chrome.storage.session as StorageAreaWithAccessLevel | undefined),
  ]);
}
