import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-smoke/**',
      '**/node_modules/**',
      '**/.pnpm-store/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      '.toolchains/**',
      '.cache/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Plain Node scripts are not covered by TypeScript's own undeclared check.
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Architectural guard: the core package is a pure semantic library. It must
    // never reach for the editor, the shell, or the browser.
    files: ['packages/academic-md-core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@codemirror/*',
                '@tauri-apps/*',
                'react',
                'react-dom',
                '@inklet/math-render',
                '@inklet/editor-ui',
                '@inklet/workspace-port',
              ],
              message: 'academic-md-core must stay DOM-, editor- and shell-free.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'academic-md-core must not touch the DOM.' },
        { name: 'document', message: 'academic-md-core must not touch the DOM.' },
        { name: 'localStorage', message: 'academic-md-core must not touch the DOM.' },
      ],
    },
  }
);
