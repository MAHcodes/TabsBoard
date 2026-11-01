/* Per-workspace settings + settings-aware backup tests.
 * Needs: npm i -D dexie fake-indexeddb
 * Run:   node tests/workspace-settings.test.js */
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

const THEME = (id, name) => ({ id, name, type: 'dark', custom: true, bg: '#111111', main: '#22aa22', caret: '#22aa22', sub: '#555555', subAlt: '#181818', text: '#eeeeee', error: '#cc3333', errorExtra: '#992222', colorfulError: '#cc3333', colorfulErrorExtra: '#992222' });
let n = 0;
const ok = (name) => console.log(`${++n} ${name} ok`);

(async () => {
  await DB.clearAll();
  let s = await DB.getState();
  const A = s.meta.activeWorkspaceId;

  // ---- 1. fresh install: new layout, nothing flat left in meta
  assert.strictEqual(s.meta.settings, undefined);
  assert.ok(s.workspaces[A].settings && s.workspaces[A].settings.themeId === 'auto');
  assert.deepStrictEqual(Object.keys(s.meta.globalSettings).sort(), ['customThemes', 'trashBadgeSeen', 'trashRetentionDays']);
  assert.strictEqual(DB.settingsOf(s).dashboard.columns, 4);
  // default themes: Iceberg Light / Dark, following the system
  assert.strictEqual(DB.settingsOf(s).themeId, 'auto');
  assert.strictEqual(DB.settingsOf(s).lightThemeId, 'iceberg_light');
  assert.strictEqual(DB.settingsOf(s).darkThemeId, 'iceberg_dark');
  assert.strictEqual(DB.settingsOf(s).floatingBars, false, 'floating bars are off by default');
  ok('fresh install layout + Iceberg defaults');

  // ---- 2. isolation between workspaces
  await DB.updateSettings({ themeId: 'nord', density: 'dense', dashboard: { columns: 6 }, sidebarCollapsed: true });
  const B = (await DB.createWorkspace('Work')).id;                 // inherits the active workspace's settings
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, B).themeId, 'nord');
  assert.strictEqual(DB.settingsOf(s, B).dashboard.columns, 6);
  await DB.updateSettings({ themeId: 'dracula', density: 'spacious', dashboard: { columns: 3 }, sidebarCollapsed: false }, B);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, A).themeId, 'nord');
  assert.strictEqual(DB.settingsOf(s, A).dashboard.columns, 6);
  assert.strictEqual(DB.settingsOf(s, A).sidebarCollapsed, true);
  assert.strictEqual(DB.settingsOf(s, B).themeId, 'dracula');
  assert.strictEqual(DB.settingsOf(s, B).dashboard.columns, 3);
  assert.strictEqual(DB.settingsOf(s, B).sidebarCollapsed, false);
  assert.strictEqual(DB.settingsOf(s).themeId, 'nord', 'default = active workspace');
  await DB.setActiveWorkspace(B);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s).themeId, 'dracula', 'settings follow the active workspace');
  await DB.updateSettings({ density: 'compact' });                 // no id → active (B)
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, B).density, 'compact');
  assert.strictEqual(DB.settingsOf(s, A).density, 'dense');
  await DB.updateSettings({ floatingBars: true }, A);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, A).floatingBars, true);
  assert.strictEqual(DB.settingsOf(s, B).floatingBars, false, 'floating bars are per workspace');
  await DB.updateSettings({ floatingBars: false }, A);
  ok('workspaces are isolated; no id = active workspace');

  // ---- 3. createWorkspace settings sources
  const C = (await DB.createWorkspace('Defaults', { settingsFrom: 'defaults' })).id;
  const D2 = (await DB.createWorkspace('FromA', { settingsFrom: A })).id;
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, C).themeId, 'auto');
  assert.strictEqual(DB.settingsOf(s, C).dashboard.columns, 4);
  assert.strictEqual(DB.settingsOf(s, D2).themeId, 'nord');
  assert.strictEqual(DB.settingsOf(s, D2).dashboard.columns, 6);
  // an unknown source falls back to the active workspace instead of throwing
  const E = (await DB.createWorkspace('Odd', { settingsFrom: 'nope' })).id;
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, E).themeId, 'dracula');
  // copies are independent, not shared references
  await DB.updateSettings({ tabsList: { groupPinned: false }, notifications: { toastLevel: 'off' } }, D2);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, A).tabsList.groupPinned, true);
  assert.strictEqual(DB.settingsOf(s, A).notifications.toastLevel, 'all');
  ok('new workspace starts from active / chosen / defaults, then is independent');
  await DB.deleteWorkspace(E);

  // ---- 4. shared keys are not per workspace
  const themes = [THEME('custom-aaa', 'Mine')];
  await DB.updateSettings({ customThemes: themes, trashRetentionDays: 30 }, A);
  s = await DB.getState();
  for (const id of [A, B, C]) {
    assert.strictEqual(DB.settingsOf(s, id).trashRetentionDays, 30);
    assert.strictEqual(DB.settingsOf(s, id).customThemes.length, 1);
    assert.strictEqual(s.workspaces[id].settings.trashRetentionDays, undefined, 'not stored on the workspace');
    assert.strictEqual(s.workspaces[id].settings.customThemes, undefined);
  }
  assert.strictEqual(s.meta.globalSettings.trashRetentionDays, 30);
  ok('custom themes / trash retention are shared');

  // ---- 5. nested group merges keep siblings
  await DB.updateSettings({ tabsList: { groupPinned: false } }, A);
  await DB.updateSettings({ dashboard: { columns: 5 } }, A);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, A).tabsList.groupPinned, false);
  assert.strictEqual(DB.settingsOf(s, A).tabsList.inactiveOpacity, 55);
  assert.strictEqual(DB.settingsOf(s, A).dashboard.columns, 5);
  assert.ok(DB.settingsOf(s, A).notifications.toastMax === 4, 'notification defaults resolved');
  ok('nested settings groups merge');

  // ---- 6. board width and widget defaults are looked up per workspace
  await DB.updateSettings({ dashboard: { columns: 3 }, clockFormat: '12' }, A);
  await DB.updateSettings({ dashboard: { columns: 6 }, clockFormat: '24' }, B);
  await DB.setActiveWorkspace(B);                                   // create for A while B is active
  const wa = [];
  for (let i = 0; i < 3; i++) wa.push(await DB.createWidget(A, 'notes'));
  const wb = [];
  for (let i = 0; i < 5; i++) wb.push(await DB.createWidget(B, 'notes'));
  s = await DB.getState();
  const cellsA = Object.values(s.widgets).filter(w => w.workspaceId === A).map(w => w.col);
  const cellsB = Object.values(s.widgets).filter(w => w.workspaceId === B).map(w => w.col);
  assert.ok(Math.max(...cellsA) <= 3, 'A (3 cols) never places beyond column 3: ' + cellsA);
  assert.ok(Math.max(...cellsB) === 5 || Math.max(...cellsB) === 6, 'B (6 cols) uses wider rows: ' + cellsB);
  assert.strictEqual((await DB.createWidget(A, 'clock')).format, '12');
  assert.strictEqual((await DB.createWidget(B, 'clock')).format, '24');
  // moving into a column only the wider workspace has
  const nb = wb[wb.length - 1];
  await DB.moveWidgetTo(nb.id, 9, 6);
  s = await DB.getState();
  assert.strictEqual(s.widgets[nb.id].col, 6);
  const na = wa[0];
  await DB.moveWidgetTo(na.id, 9, 6);
  s = await DB.getState();
  assert.strictEqual(s.widgets[na.id].col, 3, 'clamped to A\'s 3 columns');
  ok('column count + widget defaults follow the widget\'s workspace');

  // ---- 7. copy / reset / replace
  await DB.updateSettings({ themeId: 'nord', density: 'dense', borders: false }, A);
  await DB.copyWorkspaceSettings(A, C);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, C).density, 'dense');
  assert.strictEqual(DB.settingsOf(s, C).borders, false);
  assert.strictEqual(await DB.copyWorkspaceSettings(A, A), false);
  assert.strictEqual(await DB.copyWorkspaceSettings(A, 'missing'), false);
  const before = DB.settingsOf(s, C);
  await DB.resetWorkspaceSettings(C);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, C).density, 'comfortable');
  assert.strictEqual(DB.settingsOf(s, C).darkThemeId, 'iceberg_dark', 'reset restores the default themes');
  assert.strictEqual(DB.settingsOf(s, C).trashRetentionDays, 30, 'shared settings survive a reset');
  assert.strictEqual(DB.settingsOf(s, A).density, 'dense', 'other workspaces untouched');
  await DB.replaceWorkspaceSettings(C, before);                      // the Undo path
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, C).density, 'dense');
  assert.strictEqual(s.workspaces[C].settings.customThemes, undefined, 'shared keys never leak into a workspace');
  ok('copy / reset / undo');

  // ---- 8. deleting a custom theme repoints every workspace that used it
  await DB.updateSettings({ themeId: 'custom-aaa' }, A);
  await DB.updateSettings({ themeId: 'auto', lightThemeId: 'custom-aaa' }, B);
  const touched = await DB.deleteCustomTheme('custom-aaa');
  s = await DB.getState();
  assert.deepStrictEqual(touched.slice().sort(), ['Personal', 'Work']);
  assert.ok(!/^custom-/.test(DB.settingsOf(s, A).themeId));
  assert.strictEqual(DB.settingsOf(s, B).lightThemeId, DB.DEFAULT_LIGHT_THEME_ID);
  assert.strictEqual(DB.settingsOf(s).customThemes.length, 0);
  ok('deleting a shared theme fixes all workspaces');

  // ---- 9. deleting a workspace removes its settings with it
  const X = (await DB.createWorkspace('Temp')).id;
  await DB.updateSettings({ density: 'spacious' }, X);
  await DB.deleteWorkspace(X);
  s = await DB.getState();
  assert.ok(!s.workspaces[X]);
  assert.strictEqual(DB.settingsOf(s, X).density, 'comfortable', 'unknown workspace resolves to defaults, never throws');
  ok('workspace delete + unknown id');

  // ---- 10. export carries every workspace's settings, in full
  await DB.updateSettings({ customThemes: [THEME('custom-bbb', 'Teal')], trashRetentionDays: 7 });
  await DB.updateSettings({ themeId: 'custom-bbb', dashboard: { columns: 5 } }, A);
  const json = await DB.exportJSON();
  const file = JSON.parse(json);
  assert.strictEqual(file.backup.app, 'TabsBoard');
  assert.strictEqual(file.meta.settings, undefined, 'no stale flat settings in the file');
  assert.strictEqual(file.workspaces[A].settings.themeId, 'custom-bbb');
  assert.strictEqual(file.workspaces[A].settings.dashboard.columns, 5);
  assert.strictEqual(file.workspaces[B].settings.dashboard.columns, 6);
  assert.ok(file.workspaces[B].settings.notifications.toastMax === 4, 'written out in full, not sparse');
  assert.strictEqual(file.workspaces[A].settings.trashRetentionDays, undefined);
  assert.strictEqual(file.meta.globalSettings.trashRetentionDays, 7);
  assert.strictEqual(file.meta.globalSettings.customThemes[0].id, 'custom-bbb');
  ok('export includes per-workspace + shared settings');

  // ---- 11. inspectBackup
  const info = DB.inspectBackup(json);
  assert.strictEqual(info.workspaces, Object.keys(file.workspaces).length);
  assert.strictEqual(info.hasSettings, true);
  assert.strictEqual(info.customThemes, 1);
  assert.ok(info.exportedAt);
  assert.throws(() => DB.inspectBackup('not json {'), (e) => e.code === 'not-json');
  assert.throws(() => DB.inspectBackup('{"hello":1}'), (e) => e.code === 'not-backup');
  assert.throws(() => DB.inspectBackup('[]'), (e) => e.code === 'not-backup');
  assert.throws(() => DB.inspectBackup(JSON.stringify({ workspaces: {} })), (e) => e.code === 'not-backup', 'a backup with no workspace is unusable');
  const wsCount = Object.keys((await DB.getState()).workspaces).length;
  await assert.rejects(() => DB.importJSON('garbage', 'merge'), (e) => e.code === 'not-json');
  assert.strictEqual(Object.keys((await DB.getState()).workspaces).length, wsCount, 'a rejected file changes nothing');
  ok('inspectBackup + invalid files rejected without side effects');

  // ---- 12. merge import: settings come along, existing untouched
  await DB.clearAll();
  s = await DB.getState();
  const P = s.meta.activeWorkspaceId;
  await DB.updateSettings({ themeId: 'serika_dark', density: 'comfortable' });
  const res = await DB.importJSON(json, 'merge');
  s = await DB.getState();
  assert.strictEqual(res.mode, 'merge');
  assert.ok(res.settingsImported);
  assert.strictEqual(DB.settingsOf(s, P).themeId, 'serika_dark', 'existing workspace untouched');
  const imported = Object.values(s.workspaces).filter(w => w.id !== P);
  assert.strictEqual(imported.length, Object.keys(file.workspaces).length);
  const iA = imported.find(w => w.name === 'Personal'), iB = imported.find(w => w.name === 'Work');
  assert.strictEqual(DB.settingsOf(s, iA.id).dashboard.columns, 5);
  assert.strictEqual(DB.settingsOf(s, iB.id).dashboard.columns, 6);
  assert.strictEqual(DB.settingsOf(s, iA.id).themeId, 'custom-bbb');
  assert.strictEqual(DB.settingsOf(s).customThemes.length, 1, 'theme library merged');
  assert.strictEqual(res.themesAdded, 1);
  // workspaces got fresh ids; their active board points at a board that exists
  for (const w of imported) { assert.ok(s.boards[w.activeBoardId], 'activeBoardId valid'); assert.ok(!file.workspaces[w.id]); }
  // orders are unique and appended
  const orders = Object.values(s.workspaces).map(w => w.order);
  assert.strictEqual(new Set(orders).size, orders.length);
  ok('merge import brings each workspace\'s settings + themes');

  // importing the same file again must not duplicate the theme, and conflicting ids are remapped
  const again = await DB.importJSON(json, 'merge');
  s = await DB.getState();
  assert.strictEqual(again.themesAdded, 0);
  assert.strictEqual(DB.settingsOf(s).customThemes.length, 1);
  const conflicting = JSON.parse(json);
  conflicting.meta.globalSettings.customThemes[0].name = 'Same id, different theme';
  conflicting.meta.globalSettings.customThemes[0].bg = '#000000';
  const r3 = await DB.importJSON(JSON.stringify(conflicting), 'merge');
  s = await DB.getState();
  assert.strictEqual(r3.themesAdded, 1);
  const lib = DB.settingsOf(s).customThemes;
  assert.strictEqual(lib.length, 2);
  const remapped = lib.find(t => t.name === 'Same id, different theme');
  assert.notStrictEqual(remapped.id, 'custom-bbb');
  const usingRemapped = Object.values(s.workspaces).filter(w => DB.settingsOf(s, w.id).themeId === remapped.id);
  assert.ok(usingRemapped.length >= 1, 'imported workspaces point at the remapped theme');
  ok('theme library: dedup + id-conflict remap');

  // ---- 13. merge without settings: inherit the active workspace's look
  await DB.clearAll();
  s = await DB.getState();
  const Q = s.meta.activeWorkspaceId;
  await DB.updateSettings({ themeId: 'nord', dashboard: { columns: 4 } });
  const r4 = await DB.importJSON(json, 'merge', { settings: false });
  s = await DB.getState();
  assert.strictEqual(r4.settingsImported, false);
  for (const w of Object.values(s.workspaces).filter(w => w.id !== Q)) {
    assert.strictEqual(DB.settingsOf(s, w.id).themeId, 'nord');
    assert.strictEqual(DB.settingsOf(s, w.id).dashboard.columns, 4);
  }
  assert.strictEqual(DB.settingsOf(s).customThemes.length, 0, 'themes not imported when settings are left out');
  ok('settings can be left out of an import');

  // ---- 14. imported widgets keep their cells (the imported workspace brings its own width)
  await DB.clearAll();
  const wide = JSON.parse(json);
  const wsIdA = Object.keys(wide.workspaces).find(id => wide.workspaces[id].name === 'Personal');
  const boardsA = Object.values(wide.boards).filter(b => b.workspaceId === wsIdA).map(b => b.id);
  const placed = Object.values(wide.widgets).filter(w => boardsA.includes(w.boardId));
  placed.forEach((w, i) => { w.row = 2; w.col = 1 + (i % 5); });       // a layout with an open row above
  await DB.importJSON(JSON.stringify(wide), 'merge');
  s = await DB.getState();
  const iPers = Object.values(s.workspaces).find(w => w.name === 'Personal' && w.id !== s.meta.activeWorkspaceId);
  const back = Object.values(s.widgets).filter(w => w.workspaceId === iPers.id);
  assert.strictEqual(back.length, placed.length);
  assert.ok(back.every(w => w.row === 2), 'row preserved (gap above kept)');
  ok('imported widget layout preserved');

  // ---- 15. replace import, with and without settings
  await DB.clearAll();
  await DB.updateSettings({ themeId: 'monokai', density: 'spacious', trashRetentionDays: 90 });
  const keep = await DB.importJSON(json, 'replace', { settings: false });
  s = await DB.getState();
  assert.strictEqual(keep.mode, 'replace');
  assert.strictEqual(Object.keys(s.workspaces).length, Object.keys(file.workspaces).length);
  for (const w of Object.values(s.workspaces)) assert.strictEqual(DB.settingsOf(s, w.id).density, 'spacious', 'current look kept');
  assert.strictEqual(DB.settingsOf(s).trashRetentionDays, 90, 'current shared settings kept');
  assert.ok(s.workspaces[s.meta.activeWorkspaceId], 'active workspace is valid');
  await DB.importJSON(json, 'replace');
  s = await DB.getState();
  assert.strictEqual(s.meta.activeWorkspaceId, file.meta.activeWorkspaceId);
  assert.strictEqual(DB.settingsOf(s, A).dashboard.columns, 5);
  assert.strictEqual(DB.settingsOf(s, B).dashboard.columns, 6);
  assert.strictEqual(DB.settingsOf(s).trashRetentionDays, 7);
  assert.strictEqual(s.version, 1);
  ok('replace import (settings kept / restored)');

  // ---- 16. full round trip is lossless for settings
  const snapshot = {}; for (const id of Object.keys(s.workspaces)) snapshot[id] = DB.settingsOf(s, id);
  const json2 = await DB.exportJSON();
  await DB.clearAll();
  await DB.importJSON(json2, 'replace');
  s = await DB.getState();
  for (const id of Object.keys(snapshot)) assert.deepStrictEqual(DB.settingsOf(s, id), snapshot[id], 'workspace ' + id);
  ok('export → clear → restore round trip');

  // ---- 17. old-format backups (one flat meta.settings) still import
  const old = {
    version: 1,
    meta: { activeWorkspaceId: 'ow', settings: { themeId: 'gruvbox', density: 'compact', dashboard: { columns: 5 }, trashRetentionDays: 14, customThemes: [THEME('custom-old', 'Old')], showPreviews: false } },
    workspaces: { ow: { id: 'ow', name: 'Legacy', order: 0, activeBoardId: 'ob' }, ow2: { id: 'ow2', name: 'Legacy 2', order: 1, activeBoardId: 'ob2' } },
    boards: { ob: { id: 'ob', workspaceId: 'ow', name: 'B', order: 0 }, ob2: { id: 'ob2', workspaceId: 'ow2', name: 'B', order: 0 } },
    collections: { oc: { id: 'oc', workspaceId: 'ow', name: 'C', order: 0 } },
    widgets: { owd: { id: 'owd', workspaceId: 'ow', boardId: 'ob', type: 'collection', collectionId: 'oc', span: 1, rowSpan: 1 } },
    bookmarks: { obm: { id: 'obm', collectionId: 'oc', workspaceId: 'ow', title: 'T', url: 'https://old.example', order: 0 } },
    sessions: {}, trash: {}
  };
  const oi = DB.inspectBackup(JSON.stringify(old));
  assert.strictEqual(oi.hasSettings, true);
  await DB.clearAll();
  s = await DB.getState();
  const R = s.meta.activeWorkspaceId;
  await DB.importJSON(JSON.stringify(old), 'merge');
  s = await DB.getState();
  const legacyWs = Object.values(s.workspaces).filter(w => w.name.startsWith('Legacy'));
  assert.strictEqual(legacyWs.length, 2);
  for (const w of legacyWs) {
    assert.strictEqual(DB.settingsOf(s, w.id).themeId, 'gruvbox');
    assert.strictEqual(DB.settingsOf(s, w.id).density, 'compact');
    assert.strictEqual(DB.settingsOf(s, w.id).dashboard.columns, 5);
    assert.strictEqual(DB.settingsOf(s, w.id).showPreviews, false);
  }
  assert.strictEqual(DB.settingsOf(s).trashRetentionDays, 0, 'merge never changes shared policy');
  assert.strictEqual(DB.settingsOf(s).customThemes.length, 1, 'legacy custom themes join the library');
  assert.strictEqual(DB.settingsOf(s, R).density, 'comfortable', 'existing workspace untouched');
  await DB.importJSON(JSON.stringify(old), 'replace');
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s).trashRetentionDays, 14);
  assert.strictEqual(DB.settingsOf(s, 'ow').themeId, 'gruvbox');
  assert.strictEqual(s.meta.settings, undefined);
  ok('pre-per-workspace backups import (merge + replace)');

  // ---- 18. a backup is untrusted: bad settings are dropped, not applied
  const evil = JSON.parse(await DB.exportJSON());
  const wid = Object.keys(evil.workspaces)[0];
  evil.workspaces[wid].settings = {
    interfaceFont: 'x"; } body { display:none } /*', density: 'ginormous', dashboard: { columns: 9999 },
    interfaceFontSize: 'big', themeId: '</style><script>', searchEngine: 'evil', sidebarCollapsed: 'yes',
    notifications: { toastLevel: 'loud', toastMax: 5000, toastProgress: false }, tabsList: { inactiveOpacity: -3, dimInactive: false },
    unknownKey: 1, pomodoroFocus: 25, floatingBars: 'yes please'
  };
  evil.meta.globalSettings = { customThemes: [{ id: 'not-custom', name: 'x' }, { id: 'custom-ok', name: 'Ok', bg: 'red', main: '#abc' }], trashRetentionDays: -5 };
  await DB.clearAll();
  await DB.importJSON(JSON.stringify(evil), 'replace');
  s = await DB.getState();
  const es = DB.settingsOf(s, wid);
  assert.strictEqual(es.interfaceFont, '');
  assert.strictEqual(es.density, 'comfortable');
  assert.strictEqual(es.dashboard.columns, 4);
  assert.strictEqual(es.interfaceFontSize, 100);
  assert.strictEqual(es.themeId, 'auto');
  assert.strictEqual(es.searchEngine, 'google');
  assert.strictEqual(es.sidebarCollapsed, false);
  assert.strictEqual(es.floatingBars, false, 'non-boolean floatingBars is dropped');
  assert.strictEqual(es.notifications.toastLevel, 'all');
  assert.strictEqual(es.notifications.toastMax, 4);
  assert.strictEqual(es.notifications.toastProgress, false, 'valid values in the same group survive');
  assert.strictEqual(es.tabsList.inactiveOpacity, 55);
  assert.strictEqual(es.tabsList.dimInactive, false);
  assert.strictEqual(es.pomodoroFocus, 25);
  assert.strictEqual(s.workspaces[wid].settings.unknownKey, undefined);
  assert.strictEqual(es.trashRetentionDays, 0);
  assert.deepStrictEqual(es.customThemes.map(t => t.id), ['custom-ok']);
  assert.strictEqual(es.customThemes[0].bg, undefined, 'non-hex colour dropped');
  assert.strictEqual(es.customThemes[0].main, '#abc');
  ok('hostile settings in a backup are sanitised');

  // ---- 19. concurrent writes to different workspaces don't clobber each other
  await DB.clearAll();
  s = await DB.getState();
  const W1 = s.meta.activeWorkspaceId;
  const W2 = (await DB.createWorkspace('Two')).id;
  await Promise.all([
    DB.updateSettings({ density: 'dense' }, W1), DB.updateSettings({ density: 'spacious' }, W2),
    DB.updateSettings({ dashboard: { columns: 5 } }, W1), DB.updateSettings({ dashboard: { columns: 3 } }, W2),
    DB.updateSettings({ trashRetentionDays: 30 }), DB.updateSettings({ tabsList: { groupPinned: false } }, W1)
  ]);
  s = await DB.getState();
  assert.strictEqual(DB.settingsOf(s, W1).density, 'dense'); assert.strictEqual(DB.settingsOf(s, W2).density, 'spacious');
  assert.strictEqual(DB.settingsOf(s, W1).dashboard.columns, 5); assert.strictEqual(DB.settingsOf(s, W2).dashboard.columns, 3);
  assert.strictEqual(DB.settingsOf(s, W1).tabsList.groupPinned, false); assert.strictEqual(DB.settingsOf(s, W2).tabsList.groupPinned, true);
  assert.strictEqual(DB.settingsOf(s).trashRetentionDays, 30);
  ok('concurrent settings writes');

  // ---- 20. only the touched workspace row is rewritten; change signal fires
  let fired = 0; DB.onChange(() => fired++);
  await DB.updateSettings({ density: 'compact' }, W2);
  assert.strictEqual(fired, 1);
  const r = store.tdb_rev.n; await DB.updateSettings({ density: 'compact' }, W2);
  assert.strictEqual(store.tdb_rev.n, r, 'setting a value to what it already is writes nothing');
  ok('change signal / no-op writes');

  // ---- 21. settingsOf is cached per state object and never stale across states
  const st1 = await DB.getState();
  assert.strictEqual(DB.settingsOf(st1), DB.settingsOf(st1), 'cached');
  await DB.updateSettings({ density: 'dense' }, W2);
  const st2 = await DB.getState();
  assert.notStrictEqual(DB.settingsOf(st1, W2).density, DB.settingsOf(st2, W2).density, 'new state, new view');
  assert.strictEqual(DB.settingsOf(null).density, 'comfortable', 'defensive against a missing state');
  ok('settingsOf caching');

  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
