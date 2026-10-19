// ESLint flat config (Next.js 16 removed `next lint`; run `npm run lint`).
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import regexp from 'eslint-plugin-regexp';
import tseslint from 'typescript-eslint';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  regexp.configs['flat/recommended'],

  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // ── Security (05 §8) ─────────────────────────────────────────────────────
      // Zero exceptions: user content is rendered as text nodes only; brand SVGs are SVGR components.
      'react/no-danger': 'error',
      'react/no-danger-with-children': 'error',
      // CSP blocks inline `style` attributes (no 'unsafe-inline'), and every component is
      // server-rendered, so `style` is banned on DOM elements and components alike. Use classes.
      'react/forbid-dom-props': ['error', { forbid: ['style'] }],
      'react/forbid-component-props': ['error', { forbid: ['style'] }],
      'react/jsx-no-target-blank': ['error', { enforceDynamicLinks: 'always' }],
      'react/jsx-no-script-url': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      // ReDoS: no super-linear backtracking (lengths are checked before regexes anyway).
      'regexp/no-super-linear-backtracking': 'error',
      'regexp/no-super-linear-move': 'error',
      // next/image adds an inline style attribute → use @/components/Img (getImageProps wrapper).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/image',
              importNames: ['default'],
              message: 'Use @/components/Img (no inline style attribute, CSP-safe).',
            },
            {
              name: 'next/script',
              message: 'Third-party scripts must be reviewed; load them with the request nonce.',
            },
          ],
        },
      ],

      // ── Correctness ──────────────────────────────────────────────────────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // The Img wrapper is the one place allowed to use next/image's internals.
  {
    files: ['src/components/Img.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Scripts and tests may log to the console.
  {
    files: ['scripts/**', 'tests/**', '*.config.{ts,mjs}', 'prisma.config.ts'],
    rules: { 'no-console': 'off' },
  },

  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'src/generated/**',
    'public/**',
    'ASSETS/**',
    'docs/**',
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
  ]),
]);
