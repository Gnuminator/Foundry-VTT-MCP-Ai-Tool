// ESLint flat config (ESLint 10, typescript-eslint 8). Lints the TypeScript sources only
// (`.ts` and `.tsx`), as the old `.eslintrc.json` did; plain JavaScript stays unlinted.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import vitest from '@vitest/eslint-plugin';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: [
      // ESLint 8 skipped dot-folders by default, flat config does not: without this,
      // `eslint .` also lints sibling worktrees under `.claude/worktrees/`.
      '**/.*/**',
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          // typescript-eslint 8 checks caught errors by default; 6 did not. Kept off until the
          // lint zero sweep renames the unused ones.
          caughtErrors: 'none',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      // Findings that are new with ESLint 10 and typescript-eslint 8 (their recommended sets
      // and the stricter prefer-optional-chain). Warnings, so the ratchet counts them, until
      // the lint zero sweep fixes them and warnings become errors.
      'no-useless-assignment': 'warn',
      'no-constant-binary-expression': 'warn',
      'preserve-caught-error': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/unbound-method': 'error',
      '@typescript-eslint/no-duplicate-type-constituents': 'error',
      '@typescript-eslint/only-throw-error': 'warn',
    },
  },
  {
    files: ['**/*.test.ts', '**/test-support/**/*.ts'],
    plugins: { vitest },
    rules: {
      // `expect(mock.method).toHaveBeenCalled()` is not an unbound call; the vitest version of
      // the rule knows that and still checks everything else.
      '@typescript-eslint/unbound-method': 'off',
      'vitest/unbound-method': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['packages/cogm-dashboard/web/**/*.ts', 'packages/cogm-dashboard/web/**/*.tsx'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    // The two classic hook rules, as in eslint-plugin-react-hooks 5 "recommended". Version 7's
    // recommended set adds the React Compiler rules; turning those on is the React lane's call.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettierRecommended
);
