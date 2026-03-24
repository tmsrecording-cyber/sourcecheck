// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { isTranscriptRootVisible } from '../../src/content/transcript';

const mockRect = (width: number, height: number) => ({
  width,
  height,
  top: 0,
  left: 0,
  right: width,
  bottom: height,
  x: 0,
  y: 0,
  toJSON: () => ({}),
});

describe('isTranscriptRootVisible', () => {
  it('rejects hidden transcript roots', () => {
    const root = document.createElement('div');
    root.style.display = 'none';
    root.getBoundingClientRect = () => mockRect(320, 200) as DOMRect;

    expect(isTranscriptRootVisible(root)).toBe(false);
  });

  it('rejects zero-sized transcript roots', () => {
    const root = document.createElement('div');
    root.style.display = 'block';
    root.getBoundingClientRect = () => mockRect(0, 0) as DOMRect;

    expect(isTranscriptRootVisible(root)).toBe(false);
  });

  it('accepts visible transcript roots with layout', () => {
    const root = document.createElement('div');
    root.style.display = 'block';
    root.getBoundingClientRect = () => mockRect(320, 200) as DOMRect;

    expect(isTranscriptRootVisible(root)).toBe(true);
  });
});
