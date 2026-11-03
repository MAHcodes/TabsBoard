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

  // per-board view: an override wins, clearing it falls back to the workspace default
  const b1 = Object.values(s.boards)[0];
  const b2 = await DB.createBoard(ws, 'Second');
  await DB.setBoardMode(b1.id, 'canvas');
  s = await DB.getState();
  assert.strictEqual(s.boards[b1.id].boardMode, 'canvas'); assert.ok(!('boardMode' in s.boards[b2.id]));
  await DB.setBoardMode(b1.id, 'nonsense');                       // invalid values clear the override
  s = await DB.getState(); assert.ok(!('boardMode' in s.boards[b1.id]));
  await DB.setBoardMode(b1.id, 'split');
  // canvas positions don't follow widgets into another board
  const cw = await DB.createWidget(ws, 'notes');
  await DB.setWidgetRects({ [cw.id]: { cx: 20, cy: 20, cw: 200, ch: 120 } });
  s = await DB.getState();
  await DB.setActiveBoard(ws, b1.id);
  const cw2 = await DB.createWidget(ws, 'todo');
  await DB.setWidgetRects({ [cw2.id]: { cx: 40, cy: 40, cw: 200, ch: 120 } });
  await DB.deleteBoard(b1.id);
  s = await DB.getState();
  assert.ok(!('cx' in s.widgets[cw2.id]) && s.widgets[cw2.id].boardId === b2.id, 'moved widgets are re-packed');
  assert.strictEqual(s.widgets[cw.id].cx, 20, 'widgets already on the surviving board keep their position');

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
