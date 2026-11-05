/* Storage-layer tests (Dexie / IndexedDB). Needs two dev dependencies:
 *   npm i -D dexie fake-indexeddb
 * Run: node tests/storage.test.js */
try { require('fake-indexeddb/auto'); global.Dexie = require('dexie'); }
catch (e) { console.error('Install dev deps first: npm i -D dexie fake-indexeddb'); process.exit(2); }
const assert = require('assert');
// chrome.storage stub
const store = {}; const listeners = [];
global.chrome = { runtime: {}, storage: {
  local: {
    get(k, cb) { cb(k in store ? { [k]: JSON.parse(JSON.stringify(store[k])) } : {}); },
    set(o, cb) { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: store[k], newValue: v }; store[k] = JSON.parse(JSON.stringify(v)); } listeners.forEach(l => l(ch, 'local')); cb && cb(); },
    remove(k, cb) { delete store[k]; cb && cb(); }
  },
  onChanged: { addListener(l) { listeners.push(l); } }
}};
const DB = require('../src/common/storage.js');

(async () => {
  // ---- 1. legacy blob migration
  // craft legacy by hand
  const L = { version: 1, meta: { activeWorkspaceId: 'w1', settings: { themeId: 'dark', showPreviews: false, dashboard: { columns: 5 } } },
    workspaces: { w1: { id: 'w1', name: 'Home', order: 0, activeBoardId: 'b1' } },
    boards: { b1: { id: 'b1', workspaceId: 'w1', name: 'B', order: 0 } },
    collections: { c1: { id: 'c1', workspaceId: 'w1', name: 'Reads', order: 0 } },
    widgets: { x1: { id: 'x1', workspaceId: 'w1', boardId: 'b1', type: 'collection', collectionId: 'c1', span: 1, rowSpan: 1, row: 1, col: 1 } },
    bookmarks: {}, sessions: {}, trash: {} };
  for (let i = 0; i < 3000; i++) L.bookmarks['k' + i] = { id: 'k' + i, collectionId: 'c1', workspaceId: 'w1', title: 'T' + i, url: 'https://e.com/' + i, order: i, tags: ['a'] };
  store.tdb_data = L;
  const s1 = await DB.getState();
  assert.strictEqual(Object.keys(s1.bookmarks).length, 3000);
  // the legacy flat settings are carried into the workspace (per-workspace layout) and left out of meta
  assert.strictEqual(s1.meta.activeWorkspaceId, 'w1');
  assert.strictEqual(s1.meta.settings, undefined, 'no flat settings row after migration');
  assert.strictEqual(s1.workspaces.w1.settings.themeId, 'dark');
  assert.strictEqual(s1.workspaces.w1.settings.showPreviews, false);
  assert.strictEqual(s1.workspaces.w1.settings.dashboard.columns, 5);
  assert.strictEqual(DB.settingsOf(s1).dashboard.columns, 5);
  assert.deepStrictEqual(s1.bookmarks.k42, L.bookmarks.k42);
  assert.strictEqual(store.tdb_data, undefined, 'legacy blob removed after verified migration');
  console.log('1 migration ok (3000 bookmarks, legacy removed)');

  // ---- 2. only changed rows are written
  const revBefore = store.tdb_rev && store.tdb_rev.n || 0;
  await DB.updateBookmark('k7', { title: 'Renamed' });
  const s2 = await DB.getState();
  assert.strictEqual(s2.bookmarks.k7.title, 'Renamed');
  assert.strictEqual(s2.bookmarks.k8.title, 'T8');
  assert.ok(store.tdb_rev.n > revBefore, 'rev bumped');
  // no-op mutation must not notify
  const r = store.tdb_rev.n; await DB.setState(() => {}); assert.strictEqual(store.tdb_rev.n, r, 'no-op does not bump rev');
  console.log('2 partial update + no-op skip ok');

  // ---- 3. create / delete / settings merge
  const bm = await DB.createBookmark('c1', 'w1', { title: 'New', url: 'https://n.com' });
  let s3 = await DB.getState(); assert.ok(s3.bookmarks[bm.id]);
  await DB.softDeleteBookmarks([bm.id]);
  s3 = await DB.getState(); assert.ok(!s3.bookmarks[bm.id], 'deleted row removed'); assert.ok(Object.keys(s3.trash).length === 1, 'trash row added');
  await DB.updateSettings({ dashboard: { columns: 6 }, showPreviews: true });
  s3 = await DB.getState(); assert.strictEqual(DB.settingsOf(s3).dashboard.columns, 6); assert.strictEqual(DB.settingsOf(s3).themeId, 'dark');
  console.log('3 create/delete/trash/settings merge ok');

  // ---- 4. concurrent writers don't lose updates
  await Promise.all(Array.from({ length: 40 }, (_, i) => DB.updateBookmark('k' + (100 + i), { notes: 'n' + i })));
  const s4 = await DB.getState();
  for (let i = 0; i < 40; i++) assert.strictEqual(s4.bookmarks['k' + (100 + i)].notes, 'n' + i);
  console.log('4 40 concurrent writes all persisted');

  // ---- 5. export / import replace + merge
  const json = await DB.exportJSON();
  const parsed = JSON.parse(json); assert.strictEqual(Object.keys(parsed.bookmarks).length, 3000);
  await DB.importJSON(json, 'merge');
  const s5 = await DB.getState(); assert.strictEqual(Object.keys(s5.bookmarks).length, 6000);
  assert.strictEqual(Object.keys(s5.workspaces).length, 2);
  await DB.importJSON(json, 'replace');
  const s5b = await DB.getState(); assert.strictEqual(Object.keys(s5b.bookmarks).length, 3000); assert.strictEqual(Object.keys(s5b.workspaces).length, 1);
  assert.strictEqual(s5b.version, 1);
  console.log('5 import merge/replace ok');

  // ---- 6. clearAll + stats
  await DB.clearAll();
  const s6 = await DB.getState(); assert.strictEqual(Object.keys(s6.bookmarks).length, 0); assert.strictEqual(Object.keys(s6.workspaces).length, 1);
  const st = await DB.storageStats(); assert.strictEqual(st.counts.bookmarks, 0);
  console.log('6 clearAll ok');

  // ---- 7. onChange fires
  let fired = 0; DB.onChange(() => fired++); await DB.updateSettings({ density: 'compact' }); assert.strictEqual(fired, 1);
  console.log('7 onChange ok');

  // ---- 7b. importing browser bookmarks creates collections + widgets
  // Regression: this path referenced an undeclared `colOrder` and threw on the first new collection.
  const imp = await DB.importBrowserBookmarks([
    { title: 'A', url: 'https://a.test', collection: 'Work' },
    { title: 'B', url: 'https://b.test', collection: 'Work' },
    { title: 'C', url: 'https://c.test', collection: 'Home' },
    { title: 'no url' }
  ]);
  assert.strictEqual(imp.collections, 2); assert.strictEqual(imp.bookmarks, 3);
  const after = await DB.getState();
  const names = Object.values(after.collections).map(c => c.name).sort();
  assert.deepStrictEqual(names.filter(n => n === 'Work' || n === 'Home'), ['Home', 'Work']);
  const work = Object.values(after.collections).find(c => c.name === 'Work');
  assert.strictEqual(Object.values(after.bookmarks).filter(b => b.collectionId === work.id).length, 2);
  assert.ok(Object.values(after.widgets).some(w => w.collectionId === work.id), 'each imported collection gets a widget');
  console.log('7b importBrowserBookmarks ok');

  // ---- 8. timing
  await DB.setState(d2 => { for (let i = 0; i < 5000; i++) d2.bookmarks['p' + i] = { id: 'p' + i, collectionId: 'x', title: 'P' + i, url: 'https://p.com/' + i, order: i }; });
  let t = Date.now(); await DB.updateBookmark('p10', { title: 'z' }); console.log('8 single edit with 5000 bookmarks:', Date.now() - t, 'ms (fake-indexeddb, slower than real)');
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
