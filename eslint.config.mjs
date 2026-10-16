// Lint the site's own modules. Uses only rules built into ESLint, so it runs
// with the globally installed eslint and no npm install.
const browser = Object.fromEntries([
  'window', 'document', 'location', 'history', 'navigator', 'console', 'setTimeout', 'clearTimeout',
  'URL', 'URLSearchParams', 'Blob', 'TextEncoder', 'DataView', 'Uint8Array', 'Uint32Array', 'ArrayBuffer',
  'FormData', 'Intl', 'Node', 'Promise', 'Map', 'Set',
].map((g) => [g, 'readonly']));

export default [
  { ignores: ['assets/vendor/**', 'tools/**'] },
  {
    files: ['assets/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browser },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      'no-constant-condition': 'error',
      'no-redeclare': 'error',
      'prefer-const': 'error',
    },
  },
];
