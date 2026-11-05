#!/usr/bin/env node
/* Keep the things that must agree with each other in agreement.
 *
 *   node scripts/sync.js          # check: exits 1 and says what drifted
 *   node scripts/sync.js --write  # fix it
 *
 * Single sources of truth:
 *   version  -> src/manifest.chrome.json  (the Firefox manifest, package.json and the README follow it)
 *   SDK      -> sdk/tabsboard-widget-sdk.js (the hello-widget example carries a copy so it runs standalone)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const write = process.argv.includes('--write');
const rel = (p) => path.relative(ROOT, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const drift = [];

function note(file, what, fix) {
  if (write) { fix(); console.log(`fixed   ${rel(file)}: ${what}`); }
  else drift.push(`${rel(file)}: ${what}`);
}

// ---- version
const chromePath = path.join(ROOT, 'src/manifest.chrome.json');
const version = JSON.parse(read(chromePath)).version;

for (const file of [path.join(ROOT, 'src/manifest.firefox.json'), path.join(ROOT, 'package.json')]) {
  const raw = read(file);
  const json = JSON.parse(raw);
  if (json.version !== version) {
    note(file, `version is ${json.version}, expected ${version}`, () => {
      // Replace in place so formatting and key order are untouched.
      fs.writeFileSync(file, raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
    });
  }
}

const readme = path.join(ROOT, 'README.md');
const readmeText = read(readme);
const readmeVersion = (readmeText.match(/\*\*v(\d+\.\d+\.\d+)\*\*/) || [])[1];
if (readmeVersion !== version) {
  note(readme, `shows v${readmeVersion || '(none)'}, expected v${version}`, () => {
    fs.writeFileSync(readme, readmeText.replace(/\*\*v\d+\.\d+\.\d+\*\*/, `**v${version}**`));
  });
}

// ---- SDK copy
const sdk = path.join(ROOT, 'sdk/tabsboard-widget-sdk.js');
const copy = path.join(ROOT, 'examples/hello-widget/tabsboard-widget-sdk.js');
if (!fs.existsSync(copy) || read(copy) !== read(sdk)) {
  note(copy, 'differs from sdk/tabsboard-widget-sdk.js', () => fs.copyFileSync(sdk, copy));
}

if (drift.length) {
  console.error('Out of sync (run `npm run sync` to fix):\n  - ' + drift.join('\n  - '));
  process.exit(1);
}
if (!write) console.log(`in sync (v${version}, SDK copy identical)`);
