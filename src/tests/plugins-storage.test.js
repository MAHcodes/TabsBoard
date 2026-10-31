/* Plugin registry + import-safety tests. Needs: npm i -D dexie fake-indexeddb
 * Run: node tests/plugins-storage.test.js */
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
const PP = require('../common/plugin-protocol.js');

const manifest = PP.validateManifest({
  id: 'com.example.hello', name: 'Hello', version: '1.0.0', entry: 'https://example.com/w.html',
  permissions: ['storage', 'tabs.open'], defaultSpan: 2
}).manifest;

(async () => {
  let s = await DB.getState();
  const wsId = s.meta.activeWorkspaceId;
  assert.ok(!s.meta.plugins || Object.keys(s.meta.plugins).length === 0);

  // install: grants are clipped to what the manifest requested
  await DB.installPlugin(manifest, ['storage', 'history', 'storage']);
  s = await DB.getState();
  let ep = PP.effectivePlugin(s.meta.plugins[manifest.id]);
  assert.deepStrictEqual(ep.granted, ['storage']);
  assert.strictEqual(ep.approved, true);
  assert.strictEqual(ep.defaultSpan, 2);
  assert.ok(!('origin' in s.meta.plugins[manifest.id]), 'derived fields are not persisted');

  // widget creation + private data
  const w = await DB.createWidget(wsId, 'plugin', { pluginId: manifest.id, span: 2 });
  assert.strictEqual(w.type, 'plugin'); assert.deepStrictEqual(w.data, {});
  await DB.updateWidget(w.id, { data: { count: 3 } });
  s = await DB.getState();
  assert.deepStrictEqual(s.widgets[w.id].data, { count: 3 });

  // grant changes: only permissions the manifest declared
  await DB.setPluginGrants(manifest.id, ['tabs.open', 'bookmarks.read']);
  s = await DB.getState();
  assert.deepStrictEqual(PP.effectivePlugin(s.meta.plugins[manifest.id]).granted, ['tabs.open']);

  // re-install (update) keeps installedAt
  const t0 = s.meta.plugins[manifest.id].installedAt;
  await DB.installPlugin({ ...manifest, version: '1.1.0' }, ['storage']);
  s = await DB.getState();
  assert.strictEqual(s.meta.plugins[manifest.id].installedAt, t0);
  assert.strictEqual(s.meta.plugins[manifest.id].version, '1.1.0');

  // export → replace-import: a backup can't smuggle in pre-approved grants
  const backup = JSON.parse(await DB.exportJSON());
  assert.strictEqual(backup.meta.plugins[manifest.id].approved, true);
  backup.meta.plugins['evil.plugin'] = { id: 'evil.plugin', name: 'Evil', version: '1.0.0', entry: 'https://evil.example/x.html', permissions: ['bookmarks.read', 'tabs.open'], granted: ['bookmarks.read', 'tabs.open'], approved: true };
  await DB.importJSON(JSON.stringify(backup), 'replace');
  s = await DB.getState();
  for (const id of ['evil.plugin', manifest.id]) {
    assert.strictEqual(s.meta.plugins[id].approved, false, id + ' must need re-approval after import');
    assert.strictEqual(PP.effectivePlugin(s.meta.plugins[id]).approved, false);
  }
  // …and re-approving works
  await DB.setPluginGrants(manifest.id, ['storage']);
  s = await DB.getState();
  assert.strictEqual(PP.effectivePlugin(s.meta.plugins[manifest.id]).approved, true);

  // tampered registry entry is dropped by effectivePlugin
  await DB.setState((d) => { d.meta.plugins['evil.plugin'].entry = 'chrome-extension://abc/newtab/index.html'; });
  s = await DB.getState();
  assert.strictEqual(PP.effectivePlugin(s.meta.plugins['evil.plugin']), null);

  // removal deletes the plugin and its widgets (and their saved data), nothing else
  const other = await DB.createWidget(wsId, 'notes');
  await DB.removePlugin(manifest.id);
  s = await DB.getState();
  assert.ok(!s.meta.plugins[manifest.id]);
  assert.ok(!s.widgets[w.id], 'plugin widget removed with its plugin');
  assert.ok(s.widgets[other.id], 'unrelated widgets untouched');

  console.log('plugins-storage tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
