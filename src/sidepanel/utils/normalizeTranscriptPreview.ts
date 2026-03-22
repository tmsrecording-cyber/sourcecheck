/**
 * Normalize shouty auto-captions for display.
 * News broadcasts often surface transcript text in ALL CAPS even when
 * the surrounding UI is sentence case.
 */
export const normalizeTranscriptPreview = (text: string): string => {
  const letters = text.match(/[A-Za-z]/g) ?? [];
  if (letters.length === 0) return text;

  const upperRatio = (text.match(/[A-Z]/g) ?? []).length / letters.length;
  if (upperRatio < 0.6) return text;

  return text
    .toLowerCase()
    .replace(/(^\s*|[.!?]\s+)([a-z])/g, (_, boundary, char) => boundary + char.toUpperCase());
};

export default normalizeTranscriptPreview;
