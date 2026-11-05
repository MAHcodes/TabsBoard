const SU = require('../src/common/search.js');
const assert = require('assert');

// A miniature of the palette tree: Settings > Appearance > Density > options.
const density = { kind: 'folder', settingId: 'density', label: 'Density', children: () => [
  { kind: 'setting', label: 'Spacious' }, { kind: 'setting', label: 'Compact', checked: true } ] };
const tree = [
  { kind: 'action', label: 'New Collection', section: 'Commands' },
  { kind: 'action', label: 'Toggle sidebar', keywords: 'hide show panel', section: 'Commands' },
  { kind: 'folder', label: 'Themes', children: () => [
    { kind: 'theme', label: 'Nord', themeId: 'nord', section: 'Themes' },
    { kind: 'theme', label: 'Dracula', themeId: 'dracula', section: 'Themes' } ] },
  { kind: 'folder', label: 'Settings', children: [
    { kind: 'folder', label: 'Appearance', children: [density] } ] }
];
const flat = SU.flattenTree(tree);
const labels = flat.map(i => i.searchLabel);

// flatten: folders AND leaves are present; lazy children are expanded
assert.ok(labels.includes('Themes') && labels.includes('Nord') && labels.includes('Appearance'));
// setting options get "Setting: Option" labels and skip their own folder in the path
const compact = flat.find(i => i.label === 'Compact');
assert.strictEqual(compact.searchLabel, 'Density: Compact');
assert.deepStrictEqual(compact.path, ['Settings', 'Appearance']);
assert.deepStrictEqual(flat.find(i => i.label === 'Nord').path, ['Themes']);
assert.deepStrictEqual(compact.chain.map(f => f.label), ['Settings', 'Appearance', 'Density']);
// flatten must not mutate the source items
assert.strictEqual(tree[0].path, undefined);

const top = (q) => SU.rankItems(q, flat).map(i => i.searchLabel);
// settings and themes are reachable from the root by typing
assert.strictEqual(top('compact')[0], 'Density: Compact');
assert.strictEqual(top('nord')[0], 'Nord');
// a folder beats its own children on an exact name
assert.strictEqual(top('themes')[0], 'Themes');
// keywords fallback (no highlight) and path+label fallback
assert.ok(top('panel').includes('Toggle sidebar'));
assert.strictEqual(SU.rankItems('panel', flat).find(i => i.label === 'Toggle sidebar').match.indices.length, 0);
assert.ok(top('themes dracula').includes('Dracula'));
// path-fallback highlight indices are relative to the displayed label
const dr = SU.rankItems('themes dracula', flat).find(i => i.label === 'Dracula');
assert.ok(dr.match.indices.every(i => i < 'Dracula'.length));
// noise guard: a letter-spread subsequence starting mid-word is not a match...
const noisy = SU.flattenTree([{ kind: 'setting', label: 'Confirm before delete' }, { kind: 'setting', label: 'Corner radius' }]);
assert.deepStrictEqual(SU.rankItems('nord', noisy), []);
assert.deepStrictEqual(SU.rankItems('nord', SU.flattenTree([{ label: 'New Board' }, { label: 'Go to board · Work' }])), []);
assert.strictEqual(SU.rankItems('nb', SU.flattenTree([{ label: 'New Board' }])).length, 1);
assert.strictEqual(SU.rankItems('ws', SU.flattenTree([{ label: 'Go to workspace · Work' }])).length, 1);
assert.strictEqual(SU.rankItems('ibb', SU.flattenTree([{ label: 'Import browser bookmarks…' }])).length, 1);
// ...but contiguous mid-word text, and word-start abbreviations, still are
assert.strictEqual(SU.rankItems('bar', SU.flattenTree([{ label: 'Toggle sidebar' }])).length, 1);
assert.strictEqual(SU.rankItems('gcal', SU.flattenTree([{ label: 'Google Calendar' }])).length, 1);
assert.strictEqual(SU.rankItems('cmp', SU.flattenTree([{ label: 'Compact' }])).length, 1);
// keywords are whole-word prefixes, not letter soup
assert.strictEqual(SU.rankItems('pan', SU.flattenTree([{ label: 'X', keywords: 'hide show panel' }])).length, 1);
assert.strictEqual(SU.rankItems('hsp', SU.flattenTree([{ label: 'X', keywords: 'hide show panel' }])).length, 0);
// no match -> nothing
assert.deepStrictEqual(top('zzzqq'), []);

// sections: capped, contiguous, ordered by best item
const ranked = [
  { label: 'a', section: 'Commands', score: 30 }, { label: 'b', section: 'Themes', score: 25 },
  { label: 'c', section: 'Commands', score: 20 }, { label: 'd', section: 'Commands', score: 10 },
  { label: 'e', section: 'Themes', score: 5 }
];
const g = SU.groupBySection(ranked, { Commands: 2 }, 0);
assert.deepStrictEqual(g.map(i => i.label), ['a', 'c', 'b', 'e']);
assert.deepStrictEqual(SU.groupBySection(ranked, {}, 3).map(i => i.label), ['a', 'c', 'd']);
console.log('search tests passed');
