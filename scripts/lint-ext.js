#!/usr/bin/env node
/* Run Mozilla's `web-ext lint` over both builds.
 *
 *   node scripts/lint-ext.js                    # build, lint, fail on unexpected errors
 *   node scripts/lint-ext.js --update-baseline  # accept the current innerHTML warning counts
 *
 * web-ext is a Firefox linter, so some of what it says about the Chrome build is simply not
 * relevant (no MV3 service workers or extension IDs in Chrome, Chrome-only permissions). Those
 * are listed in EXPECTED_CHROME_ERRORS. Everything else that is an error fails the run.
 *
 * Warnings never fail the run, with one exception: UNSAFE_VAR_ASSIGNMENT ("assignment to
 * innerHTML with dynamic values") is ratcheted against scripts/lint-ext.baseline.json, so the
 * number can go down but not up. New code should not add to it.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(__dirname, 'lint-ext.baseline.json');
const EXPECTED_CHROME_ERRORS = new Set(['MANIFEST_FIELD_UNSUPPORTED', 'EXTENSION_ID_REQUIRED']);
const RATCHETED = 'UNSAFE_VAR_ASSIGNMENT';

const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' });

const built = run(process.execPath, ['scripts/build.js']);
process.stdout.write(built.stdout); process.stderr.write(built.stderr);
if (built.status !== 0) process.exit(built.status || 1);

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const update = process.argv.includes('--update-baseline');
const next = {};
let failed = false;

for (const target of ['firefox', 'chrome']) {
  const r = run('npx', ['--yes', 'web-ext@8', 'lint', '--source-dir', `dist/${target}`, '--no-config-discovery', '--output', 'json']);
  let report;
  try { report = JSON.parse(r.stdout); } catch (e) { console.error(`${target}: web-ext produced no report\n${r.stderr}`); process.exit(2); }

  const errors = report.errors.filter(e => target !== 'chrome' || !EXPECTED_CHROME_ERRORS.has(e.code));
  const counts = {};
  report.warnings.forEach(w => { counts[w.code] = (counts[w.code] || 0) + 1; });
  next[target] = { [RATCHETED]: counts[RATCHETED] || 0 };

  console.log(`\n${target}: ${errors.length} error(s), ${report.warnings.length} warning(s)` + (target === 'chrome' ? `  (ignoring ${[...EXPECTED_CHROME_ERRORS].join(', ')}: Firefox-only checks)` : ''));
  for (const e of errors) { console.log(`  ERROR ${e.code}: ${e.message}${e.file ? `  [${e.file}${e.line ? ':' + e.line : ''}]` : ''}`); failed = true; }
  console.log('  warnings by code: ' + (Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'));

  const allowed = baseline[target] && baseline[target][RATCHETED];
  if (!update && typeof allowed === 'number' && next[target][RATCHETED] > allowed) {
    console.log(`  ERROR ${RATCHETED} went up: ${next[target][RATCHETED]} > baseline ${allowed}. Build the markup with textContent/escapeHtml helpers instead, or rerun with --update-baseline if it is justified.`);
    failed = true;
  } else if (!update && typeof allowed === 'number' && next[target][RATCHETED] < allowed) {
    console.log(`  note: ${RATCHETED} dropped from ${allowed} to ${next[target][RATCHETED]}. Run with --update-baseline to lock it in.`);
  }
}

if (update) { fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n'); console.log(`\nbaseline written to ${path.relative(ROOT, BASELINE)}`); }
process.exit(failed ? 1 : 0);
