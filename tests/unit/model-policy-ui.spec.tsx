import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ModelPicker } from '../../src/sidepanel/components/ModelPicker';
import { getStoredProviderApiKey, hasStoredProviderApiKey } from '../../src/background/providers/types';

describe('model policy UI guards', () => {
  it('rejects blank or malformed stored provider keys', () => {
    expect(getStoredProviderApiKey(null)).toBeNull();
    expect(getStoredProviderApiKey({ apiKey: '   ' })).toBeNull();
    expect(getStoredProviderApiKey({ apiKey: 'not-a-real-key' })).toBeNull();
    expect(hasStoredProviderApiKey({ apiKey: 'AIza-short' })).toBe(false);
  });

  it('accepts trimmed Gemini API keys from provider settings', () => {
    const storedKey = getStoredProviderApiKey({
      provider: 'gemini',
      apiKey: '  AIzaSy012345678901234567890123456789  ',
    });

    expect(storedKey).toBe('AIzaSy012345678901234567890123456789');
    expect(hasStoredProviderApiKey({ apiKey: storedKey })).toBe(true);
  });

  it('shows the managed freemium model when no custom key is present', () => {
    const html = renderToStaticMarkup(
      <ModelPicker
        selectedModel="gemini-3.1-flash-lite-preview"
        hasCustomKey={false}
        compact
        onModelChange={() => undefined}
      />,
    );

    expect(html).toContain('2.5 Flash');
    expect(html).not.toContain('Dual');
  });

  it('shows the stored BYOK model when a custom key is present', () => {
    const html = renderToStaticMarkup(
      <ModelPicker
        selectedModel="gemini-3.1-flash-lite-preview"
        hasCustomKey
        compact
        onModelChange={() => undefined}
      />,
    );

    expect(html).toContain('Dual');
  });
});
