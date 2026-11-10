import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'legacy/**',
      '**/dist/**',
      '**/node_modules/**',
      '.data/**',
      'coverage/**',
      'tests/conformance/**',
    ],
  },
  ...tseslint.configs.recommended,
);
