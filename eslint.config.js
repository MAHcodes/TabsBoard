/* ESLint 10 flat config.
 *
 * The newtab scripts are classic <script>s that share ONE global scope (see index.html for the load
 * order), so a per-file check can't tell a real typo from a function defined in another file. They
 * are linted together instead by `scripts/lint-bundle.js`, which concatenates them in load order.
 * Here they only get the checks that don't depend on other files. */
const globals = require('globals');

/* Namespaces that src/common/*.js attach to `self`, loaded by <script> before the files that use them. */
const sharedNamespaces = Object.fromEntries(['TabsDB', 'Themes', 'ColorUtils', 'Favicons', 'Thumbs', 'SearchUtils', 'BookmarkSearch', 'PluginProtocol', 'ICONS'].map(n => [n, 'readonly']));

const correctness = {
  'no-dupe-keys': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error',
  'no-self-assign': 'error', 'no-const-assign': 'error', 'no-func-assign': 'error', 'no-unsafe-finally': 'error',
  'no-cond-assign': ['error', 'except-parens'], 'no-constant-condition': ['error', { checkLoops: false }],
  'no-empty': ['error', { allowEmptyCatch: true }], 'no-redeclare': 'error', 'no-unused-labels': 'error',
  'no-sparse-arrays': 'error', 'use-isnan': 'error', 'valid-typeof': 'error', 'eqeqeq': ['error', 'smart']
};
const unused = ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }];

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'src/common/dexie.min.js', 'examples/hello-widget/tabsboard-widget-sdk.js'] },

  // Extension code outside newtab: each file is self-contained (IIFEs that attach to `self`).
  {
    files: ['src/common/**/*.js', 'sdk/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.serviceworker, ...globals.webextensions, chrome: 'readonly', browser: 'readonly', Dexie: 'readonly', module: 'writable', require: 'readonly', importScripts: 'readonly' } },
    rules: { ...correctness, 'no-undef': 'error', 'no-unused-vars': unused }
  },
  // Entry points that load the common scripts first and use what they attach to `self`.
  {
    files: ['src/background/**/*.js', 'src/popup/**/*.js', 'examples/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...sharedNamespaces, ...globals.browser, ...globals.serviceworker, ...globals.webextensions, chrome: 'readonly', browser: 'readonly', Dexie: 'readonly', importScripts: 'readonly' } },
    rules: { ...correctness, 'no-undef': 'error', 'no-unused-vars': unused }
  },

  // newtab: shared global scope, so undefined/unused names are judged by lint-bundle.js.
  {
    files: ['src/newtab/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, ...globals.webextensions } },
    rules: { ...correctness, 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off' }
  },

  // Node: tests and tooling.
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser, chrome: 'writable' } },
    rules: { ...correctness, 'no-undef': 'error', 'no-unused-vars': unused }
  }
];
