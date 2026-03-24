const TIME_PRECISION_FACTOR = 1000;

export const roundSeconds = (value: number): number =>
  Math.round(value * TIME_PRECISION_FACTOR) / TIME_PRECISION_FACTOR;

export const normalizeSeconds = (
  value: unknown,
  {
    fallback = 0,
    min = 0,
  }: {
    fallback?: number;
    min?: number;
  } = {},
): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, roundSeconds(value as number));
};

export const secondsFromMilliseconds = (
  value: unknown,
  options?: {
    fallback?: number;
    min?: number;
  },
): number => normalizeSeconds(
  Number.isFinite(value) ? (value as number) / TIME_PRECISION_FACTOR : value,
  options,
);
