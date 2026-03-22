import { describe, expect, it } from 'vitest';

import { sanitizeUrl } from '../../src/sidepanel/utils/sanitizeUrl';

describe('sanitizeUrl', () => {
  it('allows https URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeUrl('https://www.federalregister.gov/example')).toBe('https://www.federalregister.gov/example');
  });

  it('allows http URLs', () => {
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com');
  });

  it('blocks javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('JavaScript:alert(1)')).toBeNull();
  });

  it('blocks data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('blocks vbscript: URLs', () => {
    expect(sanitizeUrl('vbscript:MsgBox("XSS")')).toBeNull();
  });

  it('returns null for empty or undefined inputs', () => {
    expect(sanitizeUrl('')).toBeNull();
    expect(sanitizeUrl(null)).toBeNull();
    expect(sanitizeUrl(undefined)).toBeNull();
    expect(sanitizeUrl('   ')).toBeNull();
  });

  it('trims whitespace from valid URLs', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('rejects relative URLs', () => {
    expect(sanitizeUrl('/path/to/resource')).toBeNull();
    expect(sanitizeUrl('path/to/resource')).toBeNull();
  });
});
