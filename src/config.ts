const getApiBase = () => {
  const configured = import.meta.env.VITE_API_BASE?.trim();

  // Allow localhost in the dev server (vite serve) and in explicit dev builds
  // (vite build --mode development, i.e. `npm run build:dev`).
  // import.meta.env.DEV is only true in vite serve; import.meta.env.MODE
  // covers both serve and `build --mode development`.
  if (import.meta.env.DEV || import.meta.env.MODE === 'development') {
    return configured || 'http://localhost:3000';
  }

  if (!configured) {
    throw new Error('VITE_API_BASE is required for release builds.');
  }

  try {
    new URL(configured);
  } catch {
    throw new Error(`VITE_API_BASE must be a valid absolute URL. Received: ${configured}`);
  }

  return configured;
};

export const API_BASE = getApiBase();
export const REQUEST_TIMEOUT_MS = (() => {
  const configured = Number.parseInt(import.meta.env.VITE_REQUEST_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured >= 1000 ? configured : 20_000;
})();

export const CHUNK_INTERVAL_MS = 30_000;

export const MIN_CONFIDENCE = 0.65;
