export interface AskShortcutDescriptor {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  hasContext: boolean;
  showSettings: boolean;
}

const TEXT_ENTRY_TAGS = new Set(['input', 'textarea', 'select']);

export const isTextEntryTarget = (target: unknown): boolean => {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const candidate = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };

  const tagName =
    typeof candidate.tagName === 'string' ? candidate.tagName.toLowerCase() : '';

  if (TEXT_ENTRY_TAGS.has(tagName)) {
    return true;
  }

  if (candidate.isContentEditable === true) {
    return true;
  }

  const role =
    typeof candidate.getAttribute === 'function' ? candidate.getAttribute('role') : null;

  return role === 'textbox';
};

export const shouldHandleAskShortcut = ({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
  defaultPrevented = false,
  target,
  hasContext,
  showSettings,
}: AskShortcutDescriptor): boolean => {
  if (defaultPrevented || showSettings || !hasContext || isTextEntryTarget(target)) {
    return false;
  }

  const normalizedKey = key.toLowerCase();
  const isSlashShortcut = key === '/' && !metaKey && !ctrlKey && !altKey && !shiftKey;
  const isCommandShortcut =
    normalizedKey === 'k' && (metaKey || ctrlKey) && !altKey && !shiftKey;

  return isSlashShortcut || isCommandShortcut;
};
