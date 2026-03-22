/**
 * Sanitize a URL for safe use in href attributes.
 * Blocks javascript:, data:, vbscript: and other non-http(s) protocols.
 * Returns null for unsafe or empty URLs.
 */
export const sanitizeUrl = (url: string | undefined | null): string | null => {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
    return null;
  } catch {
    // Relative URLs or malformed — reject
    return null;
  }
};
