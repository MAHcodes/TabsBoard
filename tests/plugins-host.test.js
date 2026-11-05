/* Host smoke test: loads the real newtab/plugins.js into jsdom, fakes the
 * iframe's window, and drives the handshake + RPC with the real SDK over a
 * real MessageChannel. It checks the host's wiring and lifecycle. It does NOT
 * prove browser sandbox enforcement (jsdom has none) — that needs a real browser.
 * Needs: npm i -D jsdom     Run: node tests/plugins-host.test.js */
let JSDOM; try { ({ JSDOM } = require('jsdom')); } catch (e) { console.error('Install dev deps first: npm i -D jsdom'); process.exit(2); }
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PP = require('../src/common/plugin-protocol.js');
const SDK = require('../sdk/tabsboard-widget-sdk.js');

const dom = new JSDOM('<!doctype html><html><body><div id="board"></div><div id="plugin-list"></div></body></html>', { runScripts: 'outside-only', url: 'chrome-extension://abc/newtab/index.html' });
const win = dom.window;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Values built inside jsdom's realm have a different Object.prototype, so compare structurally via JSON.
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);

// ---- environment the real dashboard provides ----
const calls = { updateWidget: [], tabs: [], toasts: [], deleted: [] };
win.PluginProtocol = PP;
win.MessageChannel = MessageChannel;
win.CSS = { escape: (s) => String(s) };
win.requestAnimationFrame = (f) => setTimeout(f, 0);
win.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
win.el = (tag, cls) => { const n = win.document.createElement(tag); if (cls) n.className = cls; return n; };
win.$ = (sel, root) => (root || win.document).querySelector(sel);
win.$$ = (sel, root) => Array.from((root || win.document).querySelectorAll(sel));
win.ICONS = new Proxy({}, { get: () => '<i></i>' });
win.widgetShell = (w, icon, titleHtml) => {
  const card = win.el('div', 'widget'); card.dataset.widgetId = w.id;
  const header = win.el('div', 'widget-header');
  header.innerHTML = `${titleHtml}<button data-act="menu"></button>`;
  card.appendChild(header);
  return { card, header };
};
win.toast = (t, o) => calls.toasts.push([t, o]);
win.DB = { updateWidget: async (id, patch) => { calls.updateWidget.push([id, patch]); win.STATE.widgets[id] = Object.assign(win.STATE.widgets[id] || {}, patch); }, deleteWidget: async (id) => calls.deleted.push(id) };
win.reload = async () => {};
win.chrome = { tabs: { create: (o, cb) => { calls.tabs.push(o); cb({ id: 1 }); } }, runtime: {} };
win.getComputedStyle = () => ({ getPropertyValue: (n) => ({ '--bg-color': '#111111', '--text-color': '#eeeeee' }[n] || '') });

const plugin = { id: 'com.example.hello', name: 'Hello', version: '1.0.0', entry: 'https://example.com/w/index.html', permissions: ['storage', 'tabs.open', 'bookmarks.read'], granted: ['storage', 'tabs.open'], approved: true };
const W = { id: 'w1', workspaceId: 'ws1', type: 'plugin', pluginId: plugin.id, span: 1, rowSpan: 1, data: { seeded: 1 } };
win.STATE = {
  meta: { plugins: { [plugin.id]: plugin } },
  widgets: { w1: W },
  collections: { c1: { id: 'c1', workspaceId: 'ws1', name: 'Reads', order: 0 } },
  bookmarks: { b1: { id: 'b1', workspaceId: 'ws1', collectionId: 'c1', title: 'React', url: 'https://react.dev', order: 0 } }
};

win.eval(fs.readFileSync(path.join(__dirname, '../src/newtab/plugins.js'), 'utf8'));
win.initPlugins();

/* Simulate what a browser does for a sandboxed frame: the frame's window gets
   our init message (with the transferred port); the frame sends hello. */
function fakeWidgetWindow(frame) {
  const inbox = [];
  const cw = frame.contentWindow;
  cw.postMessage = (data, targetOrigin, transfer) => inbox.push({ data, targetOrigin, ports: transfer || [] });
  return { inbox, hello(over) {
    win.dispatchEvent(new win.MessageEvent('message', Object.assign({ data: { type: 'tb:hello', protocol: 1 }, origin: 'null', source: cw }, over || {})));
  } };
}

(async () => {
  const card = win.renderPluginWidget(W);
  win.document.getElementById('board').appendChild(card);
  const frame = card.querySelector('iframe.plugin-frame');

  // ---- the frame is created sandboxed and locked down ----
  assert.ok(frame, 'iframe created');
  assert.strictEqual(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.ok(!/allow-same-origin/.test(frame.getAttribute('sandbox')), 'must never get allow-same-origin');
  assert.strictEqual(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.strictEqual(frame.getAttribute('allow'), '');
  assert.strictEqual(frame.getAttribute('src'), 'https://example.com/w/index.html');
  assert.ok(card.querySelector('.plugin-status'), 'loading status shown until handshake');

  const fw = fakeWidgetWindow(frame);

  // ---- hello from the wrong sender / wrong origin / wrong protocol is ignored ----
  const stranger = new JSDOM('').window;
  win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'tb:hello', protocol: 1 }, origin: 'null', source: stranger }));
  fw.hello({ origin: 'https://example.com' });            // frames in our sandbox always report "null"
  assert.strictEqual(fw.inbox.length, 0, 'no init for untrusted hello');
  fw.hello({ data: { type: 'tb:hello', protocol: 99 } });
  assert.strictEqual(fw.inbox[0].data.type, 'tb:error'); assert.strictEqual(fw.inbox[0].data.code, 'unsupported_protocol');
  fw.inbox.length = 0;

  // ---- real handshake ----
  fw.hello();
  assert.strictEqual(fw.inbox.length, 1);
  const init = fw.inbox[0];
  assert.strictEqual(init.data.type, 'tb:init'); assert.strictEqual(init.targetOrigin, '*'); assert.strictEqual(init.ports.length, 1);
  same(init.data.info.permissions, ['storage', 'tabs.open']);   // granted, not merely requested
  assert.strictEqual(init.data.info.theme.scheme, 'dark');
  assert.ok(!card.querySelector('.plugin-status'), 'status cleared after handshake');
  const tb = SDK.createClient(init.ports[0], init.data);

  // ---- RPC through the real dispatcher + host ctx ----
  assert.strictEqual(await tb.storage.get('seeded'), 1, 'seeded from widget.data');
  await tb.storage.set('count', 7);
  await tb.ui.setTitle('Counter');
  assert.strictEqual(card.querySelector('.widget-title').textContent, 'Counter');
  await tb.tabs.open('https://example.com/x');
  same(calls.tabs, [{ url: 'https://example.com/x', active: false }], 'tabs open in the background');
  await assert.rejects(() => tb.bookmarks.list(), (e) => e.code === 'permission_denied', 'requested-but-not-granted stays denied');
  await assert.rejects(() => tb.tabs.open('javascript:alert(1)'), (e) => e.code === 'invalid_params');

  // ---- storage is debounced and persisted onto the widget, once ----
  assert.strictEqual(calls.updateWidget.length, 0, 'not saved synchronously');
  await sleep(500);
  assert.strictEqual(calls.updateWidget.length, 1);
  same(calls.updateWidget[0][1].data, { seeded: 1, count: 7 });

  // ---- saving data must not change the card signature (would reload the iframe) ----
  const sigBefore = win.pluginRenderSig(win.STATE.widgets.w1);
  win.STATE.widgets.w1.data = { totally: 'different' };
  assert.strictEqual(win.pluginRenderSig(win.STATE.widgets.w1), sigBefore);
  // …but changing what the widget is allowed to do does
  win.STATE.meta.plugins[plugin.id] = Object.assign({}, plugin, { granted: ['storage'] });
  assert.notStrictEqual(win.pluginRenderSig(win.STATE.widgets.w1), sigBefore);
  win.STATE.meta.plugins[plugin.id] = plugin;

  // ---- re-handshake (widget reloaded itself) swaps the port, keeps limits ----
  fw.inbox.length = 0; fw.hello();
  assert.strictEqual(fw.inbox.length, 1);
  const tb2 = SDK.createClient(fw.inbox[0].ports[0], fw.inbox[0].data);
  assert.strictEqual(await tb2.storage.get('count'), 7);

  // ---- host → widget events reach the live port ----
  const theme = new Promise(res => tb2.on('theme', res));
  win.document.documentElement.setAttribute('style', '--bg-color:#fff');
  win.getComputedStyle = () => ({ getPropertyValue: (n) => ({ '--bg-color': '#ffffff' }[n] || '') });
  win.document.documentElement.setAttribute('style', '--bg-color:#ffffff');
  assert.strictEqual((await Promise.race([theme, sleep(1000).then(() => ({ scheme: 'TIMEOUT' }))])).scheme, 'light');

  // ---- flooding suspends the widget and shows a Reload action ----
  let rejected = 0;
  await Promise.all(Array.from({ length: 400 }, () => tb2.call('host.info', {}, 300).catch(() => { rejected++; })));
  await sleep(50);
  assert.ok(rejected > 0, 'calls beyond the rate limit are rejected, not silently dropped');
  assert.ok(card.querySelector('.plugin-status'), 'suspended widget shows status');
  assert.ok(!card.querySelector('iframe'), 'suspended widget has its iframe removed');
  assert.ok(/too many requests/i.test(card.querySelector('.plugin-status-msg').textContent));
  assert.ok(Array.from(card.querySelectorAll('.plugin-status button')).some(b => b.textContent === 'Reload widget'));

  // ---- board removal destroys the instance (and flushes data) ----
  const card2 = win.renderPluginWidget(W);
  win.document.getElementById('board').appendChild(card2);
  const fw2 = fakeWidgetWindow(card2.querySelector('iframe')); fw2.hello();
  const tb3 = SDK.createClient(fw2.inbox[0].ports[0], fw2.inbox[0].data);
  calls.updateWidget.length = 0;
  await tb3.storage.set('last', 'write');
  card2.remove();                                     // what renderBoard does for a widget that left the board
  await sleep(30);                                    // MutationObserver → destroyPluginInstance → flush
  assert.strictEqual(calls.updateWidget.length, 1, 'unsaved data flushed on destroy');
  assert.strictEqual(calls.updateWidget[0][1].data.last, 'write');
  // a write from the dying frame after teardown is dropped, never persisted
  calls.updateWidget.length = 0;
  await tb3.call('storage.set', { key: 'late', value: 1 }, 200).catch(() => {}); // port is closed → times out quickly
  await sleep(500);
  assert.strictEqual(calls.updateWidget.length, 0, 'late writes from a destroyed instance are dropped');

  // ---- missing / unapproved plugins never create a frame ----
  win.STATE.meta.plugins = {};
  const orphan = win.renderPluginWidget(W);
  assert.ok(!orphan.querySelector('iframe')); assert.ok(/no longer installed/.test(orphan.textContent));
  win.STATE.meta.plugins = { [plugin.id]: Object.assign({}, plugin, { approved: false }) };
  const unapproved = win.renderPluginWidget(W);
  assert.ok(!unapproved.querySelector('iframe')); assert.ok(/needs your approval/.test(unapproved.textContent));
  // a stored record with a tampered entry URL is treated as not installed
  win.STATE.meta.plugins = { [plugin.id]: Object.assign({}, plugin, { entry: 'chrome-extension://abc/newtab/index.html' }) };
  assert.ok(!win.renderPluginWidget(W).querySelector('iframe'), 'extension-origin entry must never be framed');

  // ---- XSS: hostile names are rendered as text everywhere ----
  const evil = Object.assign({}, plugin, { name: '<img src=x onerror=alert(1)>'.slice(0, 40), approved: true });
  win.STATE.meta.plugins = { [plugin.id]: evil };
  const evilCard = win.renderPluginWidget(W);
  assert.ok(!evilCard.querySelector('img'), 'plugin name must not be parsed as HTML in the card');
  win.renderPluginSettings();
  assert.ok(!win.document.querySelector('#plugin-list img'), 'plugin name must not be parsed as HTML in settings');
  assert.ok(!/<img/i.test(win.pluginAddMenuHtml().replace(/&lt;img/g, '')), 'add menu escapes names');

  console.log('plugins-host tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
