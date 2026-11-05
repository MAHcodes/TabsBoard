#!/usr/bin/env node
/* Build the extension for one or both browsers into dist/<target>.
 *
 *   node scripts/build.js            # both
 *   node scripts/build.js chrome     # Chrome / Chromium (MV3)
 *   node scripts/build.js firefox    # Firefox (MV2)
 *
 * Mirrors what the justfile used to do with cp/rm, but is portable, never ships anything it
 * shouldn't, and fails the build when a file the pages or the manifest point at is missing.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const TARGETS = {
  chrome: { manifest: 'manifest.chrome.json', drop: ['manifest.firefox.json', 'manifest.chrome.json', 'background/background.html'] },
  firefox: { manifest: 'manifest.firefox.json', drop: ['manifest.firefox.json', 'manifest.chrome.json'] }
};

function build(name) {
  const t = TARGETS[name];
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const dropped = new Set(t.drop.map(p => path.join(SRC, p)));
  fs.cpSync(SRC, out, { recursive: true, filter: (from) => !dropped.has(from) });
  fs.copyFileSync(path.join(SRC, t.manifest), path.join(out, 'manifest.json'));
  const problems = verify(out);
  if (problems.length) {
    console.error(`\n${name}: ${problems.length} broken reference(s):\n  - ${problems.join('\n  - ')}`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: built dist/${name} (${countFiles(out)} files)`);
  }
}

function countFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
}

/* Every file a page or the manifest points at has to exist in the build. */
function verify(out) {
  const missing = [];
  const need = (rel, from) => { if (!fs.existsSync(path.join(out, rel))) missing.push(`${rel}  (referenced from ${from})`); };
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  const refs = [];
  Object.values(manifest.icons || {}).forEach(p => refs.push(p));
  const action = manifest.action || manifest.browser_action;
  if (action) { if (action.default_popup) refs.push(action.default_popup); Object.values(action.default_icon || {}).forEach(p => refs.push(p)); }
  const bg = manifest.background || {};
  [bg.service_worker, bg.page, ...(bg.scripts || [])].filter(Boolean).forEach(p => refs.push(p));
  Object.values(manifest.chrome_url_overrides || {}).forEach(p => refs.push(p));
  if (manifest.chrome_settings_overrides && manifest.chrome_settings_overrides.homepage) refs.push(manifest.chrome_settings_overrides.homepage);
  refs.forEach(r => need(r, 'manifest.json'));
  const pages = [action && action.default_popup, ...Object.values(manifest.chrome_url_overrides || {}), bg.page].filter(Boolean);
  for (const page of pages) {
    if (!fs.existsSync(path.join(out, page))) continue;
    const html = fs.readFileSync(path.join(out, page), 'utf8');
    for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"#?]+)"/g)) {
      if (/^(https?:)?\/\//.test(m[1])) continue;
      need(path.posix.normalize(path.posix.join(path.posix.dirname(page), m[1])), page);
    }
  }
  return missing;
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(TARGETS);
for (const n of names) {
  if (!TARGETS[n]) { console.error(`Unknown target "${n}". Use: ${Object.keys(TARGETS).join(', ')}`); process.exit(2); }
  build(n);
}
