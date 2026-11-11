import { defineConfig } from 'vitest/config';

// `test:unit`: the per-package suites. Conformance (node:test) and data-compat
// (its own config) are deliberately not collected here.
export default defineConfig({
  test: { projects: ['apps/server', 'packages/shared'] },
});
