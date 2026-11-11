import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'tests/data-compat/frozen-v1/**',
      '**/dist/**',
      '**/node_modules/**',
      '.data/**',
      'coverage/**',
      'tests/conformance/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // The browser client: React rules (hooks, and the React Compiler checks that
    // ship with the plugin's recommended set) plus browser globals.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/web/*.config.ts', 'apps/web/e2e/**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
