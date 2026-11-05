#!/usr/bin/env node
/* Lint the newtab page the way the browser runs it: as ONE program.
 *
 * newtab/*.js are classic <script>s that share a single global scope, so linting them one by one
 * can't tell a typo from a function defined in another file. This reads the <script> list from
 * newtab/index.html, concatenates the files in load order and lints the result, then maps every
 * message back to its real file and line. It catches:
 *   - references to names that don't exist anywhere (the class of bug that broke
 *     importBrowserBookmarks: a variable that was never declared),
 *   - top-level functions and variables nothing uses (dead code),
 *   - the same name declared in two files.
 */
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');
const globals = require('globals');

const ROOT = path.resolve(__dirname, '..');
const PAGE_DIR = path.join(ROOT, 'src/newtab');
const html = fs.readFileSync(path.join(PAGE_DIR, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]).filter(s => !/dexie\.min\.js$/.test(s));

/* Names the common/*.js scripts attach to `self` (e.g. `self.Themes = …`), which static analysis can't see. */
const NAMESPACES = ['ColorUtils', 'Favicons', 'Thumbs', 'SearchUtils', 'BookmarkSearch', 'PluginProtocol'];

const segments = [];
let code = '', line = 1;
for (const src of scripts) {
  const file = path.normalize(path.join(PAGE_DIR, src));
  const text = fs.readFileSync(file, 'utf8').replace(/\n?$/, '\n');
  const lines = text.split('\n').length - 1;
  segments.push({ file: path.relative(ROOT, file), start: line, end: line + lines - 1 });
  code += text; line += lines;
}
const locate = (l) => { const s = segments.find(x => l >= x.start && l <= x.end) || segments[segments.length - 1]; return `${s.file}:${l - s.start + 1}`; };

(async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.js'],
      languageOptions: {
        ecmaVersion: 2022, sourceType: 'script',
        globals: { ...globals.browser, ...globals.webextensions, chrome: 'readonly', browser: 'readonly', Dexie: 'readonly', module: 'writable', require: 'readonly', ...Object.fromEntries(NAMESPACES.map(n => [n, 'readonly'])) }
      },
      rules: {
        'no-undef': 'error',
        'no-redeclare': 'error',
        'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
        'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error', 'no-func-assign': 'error'
      }
    }]
  });
  const [res] = await eslint.lintText(code, { filePath: path.join(ROOT, 'newtab-bundle.js') });
  const problems = res.messages;
  for (const m of problems) console.error(`${locate(m.line)}:${m.column}  ${m.ruleId || 'parse error'}  ${m.message}`);
  if (problems.length) {
    console.error(`\nbundle lint: ${problems.length} problem(s) across ${scripts.length} scripts`);
    process.exit(1);
  }
  console.log(`bundle lint: ${scripts.length} scripts, no problems`);
})().catch(e => { console.error(e); process.exit(2); });
