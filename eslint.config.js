import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const nodeGlobals = Object.fromEntries(
  ['console', 'process', 'Buffer', 'fetch', 'FormData', 'Blob', 'URL', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'AbortController']
    .map((g) => [g, 'readonly']),
);

const browserGlobals = Object.fromEntries(['window', 'document', 'location', 'navigator', 'localStorage', 'matchMedia', 'btoa'].map((g) => [g, 'readonly']));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', 'storage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  // Plain-JS test/script files run on Node.
  { files: ['**/*.mjs', '**/*.js'], languageOptions: { globals: nodeGlobals }, rules: { '@typescript-eslint/no-unused-expressions': 'off' } },
  // Frontend: enforce the rules of hooks and exhaustive dependencies.
  { files: ['apps/web/**/*.{ts,tsx}'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
  // The browser E2E suite ships functions into the page via page.evaluate().
  { files: ['tests/ui.e2e.mjs'], languageOptions: { globals: { ...nodeGlobals, ...browserGlobals } } },
);
