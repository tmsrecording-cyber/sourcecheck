export const stripLegacyCachePrefix = (value?: string | null): string => {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/^\s*\[From memory\]\s*/i, '').trim();
};
