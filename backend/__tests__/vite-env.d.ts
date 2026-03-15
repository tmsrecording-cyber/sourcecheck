// Ambient type extension so the backend TypeScript compiler does not error
// when test files import extension-side modules that use import.meta.env
// (a Vite/browser-extension convention, not available in Next.js by default).
interface ImportMeta {
  readonly env: {
    readonly [key: string]: string | undefined;
  };
}
