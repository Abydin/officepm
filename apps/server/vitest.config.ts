import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests read the shared package straight from source, so they never need a build first.
    alias: {
      '@officepm/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: { name: 'server', include: ['src/**/*.test.ts'], pool: 'forks' },
});
