import { describe, expect, it } from 'vitest';

import { isTextEntryTarget, shouldHandleAskShortcut } from '../../src/sidepanel/utils/askShortcut';

describe('ask shortcut policy', () => {
  it('accepts slash when context is available', () => {
    expect(
      shouldHandleAskShortcut({
        key: '/',
        hasContext: true,
        showSettings: false,
      }),
    ).toBe(true);
  });

  it('accepts command palette style shortcuts when context is available', () => {
    expect(
      shouldHandleAskShortcut({
        key: 'k',
        metaKey: true,
        hasContext: true,
        showSettings: false,
      }),
    ).toBe(true);

    expect(
      shouldHandleAskShortcut({
        key: 'K',
        ctrlKey: true,
        hasContext: true,
        showSettings: false,
      }),
    ).toBe(true);
  });

  it('ignores shortcuts while the settings panel is open or context is missing', () => {
    expect(
      shouldHandleAskShortcut({
        key: '/',
        hasContext: false,
        showSettings: false,
      }),
    ).toBe(false);

    expect(
      shouldHandleAskShortcut({
        key: '/',
        hasContext: true,
        showSettings: true,
      }),
    ).toBe(false);
  });

  it('does not steal focus from text-entry elements', () => {
    const inputTarget = { tagName: 'INPUT' };
    const contentEditableTarget = { tagName: 'DIV', isContentEditable: true };

    expect(isTextEntryTarget(inputTarget)).toBe(true);
    expect(isTextEntryTarget(contentEditableTarget)).toBe(true);
    expect(
      shouldHandleAskShortcut({
        key: '/',
        target: inputTarget,
        hasContext: true,
        showSettings: false,
      }),
    ).toBe(false);
  });

  it('ignores unrelated modified shortcuts', () => {
    expect(
      shouldHandleAskShortcut({
        key: '/',
        shiftKey: true,
        hasContext: true,
        showSettings: false,
      }),
    ).toBe(false);

    expect(
      shouldHandleAskShortcut({
        key: 'p',
        metaKey: true,
        hasContext: true,
        showSettings: false,
      }),
    ).toBe(false);
  });
});
