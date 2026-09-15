import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.astro/**',
      '.claude/**',
      '**/*.d.ts',
      'apps/**/public/**',
      // Temporary standalone export; it has its own ESLint config and will be
      // moved out of this repository.
      'WebMusic-Marketing-Site/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs,ts,tsx}'],
    languageOptions: {
      globals: {...globals.browser, ...globals.node},
    },
  },
  ...astro.configs['flat/recommended'],
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {...globals.browser, ...globals.node},
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: [
      'packages/score/src/react/**/*.{ts,tsx}',
      'packages/score/test/react/**/*.{ts,tsx}',
    ],
    plugins: {'react-hooks': reactHooks},
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
