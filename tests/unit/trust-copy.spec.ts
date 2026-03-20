import { describe, expect, it } from 'vitest';

import { stripLegacyCachePrefix } from '../../src/sidepanel/utils/trustCopy';

describe('stripLegacyCachePrefix', () => {
  it('strips the legacy [From memory] prefix', () => {
    expect(stripLegacyCachePrefix('[From memory] This likely needs a paper.')).toBe(
      'This likely needs a paper.'
    );
  });

  it('strips the prefix case-insensitively and trims whitespace', () => {
    expect(stripLegacyCachePrefix('  [from memory]  Needs a primary source.  ')).toBe(
      'Needs a primary source.'
    );
  });

  it('leaves normal copy unchanged', () => {
    expect(stripLegacyCachePrefix('We could not verify this claim.')).toBe(
      'We could not verify this claim.'
    );
  });

  it('returns an empty string for missing values', () => {
    expect(stripLegacyCachePrefix(undefined)).toBe('');
    expect(stripLegacyCachePrefix(null)).toBe('');
  });
});
