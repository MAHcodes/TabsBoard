/* Default / fallback themes. Run: node tests/themes-defaults.test.js */
const assert = require('assert');
global.self = global; global.window = global;
require('../src/common/themes.js');
const T = global.Themes;
assert.ok(T, 'Themes global');
assert.strictEqual(T.DEFAULT_LIGHT_ID, 'iceberg_light');
assert.strictEqual(T.DEFAULT_DARK_ID, 'iceberg_dark');
assert.strictEqual(T.defaultTheme(true).id, 'iceberg_dark');
assert.strictEqual(T.defaultTheme(false).id, 'iceberg_light');
// both exist and have the right type
assert.strictEqual(T.findTheme('iceberg_dark').type, 'dark');
assert.strictEqual(T.findTheme('iceberg_light').type, 'light');
// auto: system light / dark pick the slots; missing slot ids fall to the defaults
global.matchMedia = (q) => ({ matches: global.__dark });
global.__dark = true;
assert.strictEqual(T.resolveTheme('auto', undefined, undefined, []).id, 'iceberg_dark');
global.__dark = false;
assert.strictEqual(T.resolveTheme('auto', undefined, undefined, []).id, 'iceberg_light');
global.__dark = false;
assert.strictEqual(T.resolveTheme('auto', 'gruvbox_light', 'nord', []).id, 'gruvbox_light');
global.__dark = true;
assert.strictEqual(T.resolveTheme('auto', 'gruvbox_light', 'nord', []).id, 'nord');
// an unresolvable id (deleted custom theme, bad backup) follows the system, not "Serika"
global.__dark = true;
assert.strictEqual(T.resolveTheme('custom-gone', 'x', 'y', []).id, 'iceberg_dark');
global.__dark = false;
assert.strictEqual(T.resolveTheme('custom-gone', 'x', 'y', []).id, 'iceberg_light');
assert.strictEqual(T.resolveTheme('auto', 'custom-gone', 'custom-gone', []).id, 'iceberg_light');
// an explicit theme is honoured regardless of the system
global.__dark = true;
assert.strictEqual(T.resolveTheme('nord', 'a', 'b', []).id, 'nord');
console.log('themes-defaults tests passed');
