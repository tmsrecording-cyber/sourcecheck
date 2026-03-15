import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      // Mirror the @/* path alias from tsconfig.json so test files can
      // import production modules via the same specifier the route files use.
      '@': path.resolve(__dirname, './src'),
    },
  },
});
