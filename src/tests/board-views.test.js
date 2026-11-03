/* Board view setting and canvas rects.
 * Run: node tests/board-views.test.js (needs dexie + fake-indexeddb) */
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
const DB = require('../common/storage.js');

(async () => {
  let s = await DB.getState();
  const ws = s.meta.activeWorkspaceId;
  let st = DB.settingsOf(s);
  assert.strictEqual(st.boardMode, 'grid');
  assert.ok(!('layout' in st) && !('inspectorPanel' in st), 'removed settings are gone');

  // every board view survives a round trip
  for (const mode of ['canvas', 'split', 'grid']) {
    await DB.updateSettings({ boardMode: mode });
    st = DB.settingsOf(await DB.getState());
    assert.strictEqual(st.boardMode, mode);
  }

  // a workspace saved while "layout: explorer" existed becomes the split view
  const migrated = DB.sanitizeWorkspaceSettings ? DB.sanitizeWorkspaceSettings({ layout: 'explorer' }) : null;
  if (migrated) assert.strictEqual(migrated.boardMode, 'split');

  // bookmarks no longer carry an activity log
  const colId = Object.values(s.collections)[0].id;
  const bm = await DB.createBookmark(colId, ws, { title: 'A', url: 'https://a.test' });
  await DB.updateBookmark(bm.id, { notes: 'hello' });
  s = await DB.getState();
  assert.ok(!('history' in s.bookmarks[bm.id]) && !('updatedAt' in s.bookmarks[bm.id]));

  // canvas rectangles
  const w = await DB.createWidget(ws, 'notes');
  await DB.setWidgetRects({ [w.id]: { cx: 40, cy: 60.4, cw: 320, ch: 240, cz: 3, evil: 1 } });
  s = await DB.getState(); const rec = s.widgets[w.id];
  assert.deepStrictEqual([rec.cx, rec.cy, rec.cw, rec.ch, rec.cz], [40, 60, 320, 240, 3]);
  assert.ok(!('evil' in rec));
  console.log('board-views tests passed');
})().catch(e => { console.error(e); process.exit(1); });
