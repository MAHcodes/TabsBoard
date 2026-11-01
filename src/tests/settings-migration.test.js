/* Upgrade test: an install whose IndexedDB already holds the pre-per-workspace
 * layout (one flat `settings` row in meta) is migrated in place, losslessly and once.
 * Needs: npm i -D dexie fake-indexeddb      Run: node tests/settings-migration.test.js */
try { require('fake-indexeddb/auto'); global.Dexie = require('dexie'); }
catch (e) { console.error('Install dev deps first: npm i -D dexie fake-indexeddb'); process.exit(2); }
const assert = require('assert');
const store = {}; const listeners = [];
global.chrome = { runtime: {}, storage: {
  local: {
    get(k, cb) { cb(k in store ? { [k]: JSON.parse(JSON.stringify(store[k])) } : {}); },
    set(o, cb) { const ch = {}; for (const [k, v] of Object.entries(o)) { ch[k] = { oldValue: store[k], newValue: v }; store[k] = JSON.parse(JSON.stringify(v)); } listeners.forEach(l => l(ch, 'local')); cb && cb(); },
    remove(k, cb) { delete store[k]; cb && cb(); }
  },
  onChanged: { addListener(l) { listeners.push(l); } }
}};

(async () => {
  // Build the OLD on-disk layout by hand, exactly as the previous version stored it.
  const tables = ['workspaces', 'boards', 'collections', 'widgets', 'bookmarks', 'sessions', 'trash'];
  const old = new Dexie('tdb_store');
  old.version(1).stores(Object.fromEntries(['meta'].concat(tables).map(t => [t, ''])));
  await old.open();
  await old.meta.bulkPut([1, 0, 'w1', { themeId: 'nord', density: 'dense', dashboard: { columns: 6 }, trashRetentionDays: 30, trashBadgeSeen: 2, customThemes: [{ id: 'custom-x', name: 'X', type: 'dark', bg: '#101010' }], notifications: { toastLevel: 'errors' }, rssRefreshInterval: 15, hypotheticalLeftover: 1 }, { 'a.b': { id: 'a.b', approved: true } }],
    ['__version', '__rev', 'activeWorkspaceId', 'settings', 'plugins']);
  await old.workspaces.bulkPut([{ id: 'w1', name: 'Home', order: 0, activeBoardId: 'b1' }, { id: 'w2', name: 'Work', order: 1, activeBoardId: 'b2' }], ['w1', 'w2']);
  await old.boards.bulkPut([{ id: 'b1', workspaceId: 'w1', order: 0 }, { id: 'b2', workspaceId: 'w2', order: 0 }], ['b1', 'b2']);
  await old.bookmarks.put({ id: 'k', collectionId: 'c', workspaceId: 'w2', title: 'T', url: 'https://e.com' }, 'k');
  old.close();
  // Fresh Dexie handle used by the app must not be the one above.
  const DB = require('../common/storage.js');

  const s = await DB.getState();
  assert.strictEqual(s.meta.settings, undefined, 'flat row gone');
  assert.strictEqual(s.meta.activeWorkspaceId, 'w1');
  for (const id of ['w1', 'w2']) {
    const e = DB.settingsOf(s, id);
    assert.strictEqual(e.themeId, 'nord'); assert.strictEqual(e.density, 'dense');
    assert.strictEqual(e.dashboard.columns, 6); assert.strictEqual(e.notifications.toastLevel, 'errors');
    assert.strictEqual(e.rssRefreshInterval, 15);
    assert.strictEqual(e.trashRetentionDays, 30); assert.strictEqual(e.trashBadgeSeen, 2);
    assert.strictEqual(e.customThemes[0].id, 'custom-x');
    assert.strictEqual(s.workspaces[id].settings.customThemes, undefined, 'shared keys moved out of the workspace');
    assert.strictEqual(s.workspaces[id].settings.hypotheticalLeftover, undefined, 'unknown keys dropped');
  }
  assert.strictEqual(s.bookmarks.k.title, 'T', 'data untouched');
  assert.ok(s.meta.plugins['a.b'], 'plugin registry untouched');
  assert.ok(store.tdb_rev && store.tdb_rev.n >= 1, 'other contexts are told');

  // Independent from here on, and a second start does not redo or undo anything.
  await DB.updateSettings({ density: 'spacious' }, 'w2');
  const s2 = await DB.getState();
  assert.strictEqual(DB.settingsOf(s2, 'w1').density, 'dense');
  assert.strictEqual(DB.settingsOf(s2, 'w2').density, 'spacious');
  console.log('settings-migration tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
