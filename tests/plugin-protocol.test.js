/* Plugin protocol tests (pure node, no deps).  Run: node tests/plugin-protocol.test.js */
const assert = require('assert');
const PP = require('../src/common/plugin-protocol.js');
const SDK = require('../sdk/tabsboard-widget-sdk.js');

const good = { id: 'com.example.hello', name: 'Hello', version: '1.0.0', entry: 'https://example.com/w/index.html', permissions: ['storage'] };

function makeCtx(over) {
  let data = {};
  const log = { tabs: [], toasts: [], titles: [] };
  const ctx = Object.assign({
    info: () => ({ protocol: 1 }), theme: () => ({ colors: {}, scheme: 'dark', font: '' }),
    getData: () => data, setData: (d) => { data = d; },
    listCollections: () => [{ id: 'c1', name: 'Reads' }],
    listBookmarks: () => [
      { id: 'b1', title: 'React', url: 'https://react.dev', collectionId: 'c1' },
      { id: 'b2', title: 'Evil', url: 'javascript:alert(1)', collectionId: 'c1' },
      { id: 'b3', title: 'Bread', url: 'https://example.com/bread', collectionId: 'c2' }
    ],
    openTab: async (u) => { log.tabs.push(u); }, toast: (t, ty) => log.toasts.push([t, ty]), setTitle: (t) => log.titles.push(t)
  }, over || {});
  return { ctx, log, getData: () => data };
}
function dispatcher(granted, over, clock) {
  const { ctx, log, getData } = makeCtx(over);
  const d = PP.createDispatcher({ handlers: PP.createHandlers(), granted, ctx, now: clock, onAbuse: () => { d.abused = true; } });
  return { d, log, getData };
}

(async () => {
  /* ---- manifest validation ---- */
  let v = PP.validateManifest(good);
  assert.ok(v.ok); assert.strictEqual(v.manifest.origin, 'https://example.com'); assert.strictEqual(v.manifest.defaultSpan, 1);
  assert.ok(!PP.validateManifest(null).ok);
  assert.ok(!PP.validateManifest({ ...good, id: 'AB' }).ok);                       // bad id
  assert.ok(!PP.validateManifest({ ...good, version: '1' }).ok);
  assert.ok(!PP.validateManifest({ ...good, name: 'x'.repeat(41) }).ok);
  assert.ok(!PP.validateManifest({ ...good, permissions: ['storage', 'history'] }).ok); // unknown permission rejected, not ignored
  assert.ok(!PP.validateManifest({ ...good, permissions: 'storage' }).ok);
  assert.ok(!PP.validateManifest({ ...good, defaultSpan: 9 }).ok);
  assert.deepStrictEqual(PP.validateManifest({ ...good, permissions: ['storage', 'storage'] }).manifest.permissions, ['storage']);
  assert.ok(!('evil' in PP.validateManifest({ ...good, evil: 1 }).manifest)); // unknown fields dropped
  // relative entry resolves against the manifest URL
  v = PP.validateManifest({ ...good, entry: 'index.html' }, { baseUrl: 'https://cdn.example.org/w/manifest.json' });
  assert.ok(v.ok); assert.strictEqual(v.manifest.entry, 'https://cdn.example.org/w/index.html');
  assert.ok(!PP.validateManifest({ ...good, entry: 'index.html' }).ok);            // relative with no base

  /* ---- entry URL rules ---- */
  for (const bad of ['http://example.com/x', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'blob:https://a/b',
    'file:///etc/passwd', 'chrome-extension://abc/newtab/index.html', 'moz-extension://abc/x.html', 'ftp://example.com/x',
    'https://user:pw@example.com/', 'https://', '', '   ', 'http://localhost.evil.com/', 'http://127.0.0.1.evil.com/']) {
    assert.ok(!PP.parseEntryUrl(bad).ok, 'should reject ' + bad);
  }
  assert.ok(PP.parseEntryUrl('http://localhost:8787/a.html').dev);
  assert.ok(PP.parseEntryUrl('http://127.0.0.1:3000/').ok);
  assert.ok(PP.parseEntryUrl('http://[::1]:3000/').ok);
  assert.strictEqual(PP.parseEntryUrl('https://example.com/a#frag').url, 'https://example.com/a'); // fragment stripped
  assert.ok(!PP.parseEntryUrl('https://example.com/' + 'a'.repeat(2100)).ok);

  /* ---- effectivePlugin re-validates stored records ---- */
  let rec = { ...good, granted: ['storage', 'tabs.open', 'bogus'], approved: true };
  let ep = PP.effectivePlugin(rec);
  assert.deepStrictEqual(ep.granted, ['storage']);                  // can't hold a grant the manifest never asked for
  assert.strictEqual(PP.effectivePlugin({ ...rec, entry: 'chrome-extension://x/y.html' }), null); // tampered entry → dropped
  assert.strictEqual(PP.effectivePlugin({ ...rec, approved: 'yes' }).approved, false);            // only literal true counts

  /* ---- dispatcher: envelope, permissions, unknown methods ---- */
  let { d } = dispatcher(['storage']);
  assert.strictEqual(await d.handle('nope'), null);
  assert.strictEqual(await d.handle({ method: 'host.info' }), null);               // no id → dropped
  assert.strictEqual(await d.handle({ id: {}, method: 'host.info' }), null);
  assert.strictEqual((await d.handle({ id: 1, method: 'host.info' })).result.protocol, 1);
  assert.strictEqual((await d.handle({ id: 2, method: 'nope.nope' })).error.code, 'unknown_method');
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.strictEqual((await d.handle({ id: 3, method: name })).error.code, 'unknown_method', name);
  }
  assert.strictEqual((await d.handle({ id: 4, method: 'tabs.open', params: { url: 'https://a.com' } })).error.code, 'permission_denied');
  assert.strictEqual((await d.handle({ id: 5, method: 'bookmarks.list' })).error.code, 'permission_denied');
  assert.strictEqual((await d.handle({ id: 6, method: 'storage.get', params: 'str' })).error.code, 'invalid_params');
  assert.strictEqual((await d.handle({ id: 7, method: 'storage.get', params: [] })).error.code, 'invalid_params');
  assert.strictEqual((await d.handle({ id: 8, method: 'x'.repeat(65) })).error.code, 'bad_request');

  /* ---- storage ---- */
  ({ d } = dispatcher(['storage']));
  assert.strictEqual((await d.handle({ id: 1, method: 'storage.get', params: { key: 'a' } })).result, null);
  assert.strictEqual((await d.handle({ id: 2, method: 'storage.set', params: { key: 'a', value: { n: [1, 2, { x: 'y' }] } } })).error, undefined);
  assert.deepStrictEqual((await d.handle({ id: 3, method: 'storage.get', params: { key: 'a' } })).result, { n: [1, 2, { x: 'y' }] });
  assert.deepStrictEqual((await d.handle({ id: 4, method: 'storage.keys' })).result, ['a']);
  for (const key of ['__proto__', 'constructor', 'prototype', '', 'a b', 'a/b', 'x'.repeat(65), 5]) {
    assert.strictEqual((await d.handle({ id: 9, method: 'storage.set', params: { key, value: 1 } })).error.code, 'invalid_params', String(key));
  }
  assert.strictEqual((await d.handle({ id: 5, method: 'storage.set', params: { key: 'k' } })).error.code, 'invalid_params'); // value required
  assert.strictEqual((await d.handle({ id: 6, method: 'storage.set', params: { key: 'k', value: 'x'.repeat(70 * 1024) } })).error.code, 'quota_exceeded');
  // non-JSON values / depth
  assert.strictEqual((await d.handle({ id: 7, method: 'storage.set', params: { key: 'k', value: NaN } })).error.code, 'invalid_params');
  assert.strictEqual((await d.handle({ id: 8, method: 'storage.set', params: { key: 'k', value: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } } })).error.code, 'invalid_params');
  assert.strictEqual((await d.handle({ id: 10, method: 'storage.set', params: { key: 'k', value: new Date() } })).error.code, 'invalid_params');
  // __proto__ as a JSON object key inside a value (prototype-pollution attempt)
  const polluted = JSON.parse('{"__proto__": {"admin": true}}');
  assert.strictEqual((await d.handle({ id: 11, method: 'storage.set', params: { key: 'k', value: polluted } })).error.code, 'invalid_params');
  assert.strictEqual(({}).admin, undefined);
  // key-count and total quotas (fresh dispatcher + clock so rate limits don't interfere)
  let t = 0; const clock = () => t;
  ({ d } = dispatcher(['storage'], null, clock));
  for (let i = 0; i < PP.LIMITS.storageKeys; i++) { t += 1000; const r = await d.handle({ id: 'k' + i, method: 'storage.set', params: { key: 'key' + i, value: 1 } }); assert.strictEqual(r.error, undefined, 'key ' + i); }
  t += 1000;
  assert.strictEqual((await d.handle({ id: 'over', method: 'storage.set', params: { key: 'one-too-many', value: 1 } })).error.code, 'quota_exceeded');
  t += 1000;
  assert.strictEqual((await d.handle({ id: 'rep', method: 'storage.set', params: { key: 'key0', value: 2 } })).error, undefined); // overwriting an existing key still works
  let fat = dispatcher(['storage'], null, clock).d;
  for (let i = 0; i < 4; i++) { t += 1000; const r = await fat.handle({ id: 'f' + i, method: 'storage.set', params: { key: 'f' + i, value: 'x'.repeat(60 * 1024) } }); assert.strictEqual(r.error, undefined, 'fat ' + i); }
  t += 1000;
  assert.strictEqual((await fat.handle({ id: 'f9', method: 'storage.set', params: { key: 'f9', value: 'x'.repeat(60 * 1024) } })).error.code, 'quota_exceeded'); // > 256 KB total

  /* ---- bookmarks / collections ---- */
  ({ d } = dispatcher(['bookmarks.read']));
  let r = await d.handle({ id: 1, method: 'bookmarks.list' });
  assert.deepStrictEqual(r.result.map(b => b.id), ['b1', 'b3']);                      // javascript: URL never leaves the host
  assert.strictEqual(r.result[0].collection, 'Reads');
  assert.ok(!('tags' in r.result[0]) && !('notes' in r.result[0]));                   // only whitelisted fields
  assert.deepStrictEqual((await d.handle({ id: 2, method: 'bookmarks.list', params: { query: 'bread' } })).result.map(b => b.id), ['b3']);
  assert.deepStrictEqual((await d.handle({ id: 3, method: 'bookmarks.list', params: { collectionId: 'c1' } })).result.map(b => b.id), ['b1']);
  assert.strictEqual((await d.handle({ id: 4, method: 'bookmarks.list', params: { limit: 9999 } })).error.code, 'invalid_params');
  assert.strictEqual((await d.handle({ id: 5, method: 'bookmarks.list', params: { limit: 1.5 } })).error.code, 'invalid_params');
  assert.deepStrictEqual((await d.handle({ id: 6, method: 'collections.list' })).result, [{ id: 'c1', name: 'Reads' }]);

  /* ---- tabs.open ---- */
  t = 0;
  let h = dispatcher(['tabs.open'], null, clock); d = h.d;
  assert.strictEqual((await d.handle({ id: 1, method: 'tabs.open', params: { url: 'https://example.com/a' } })).error, undefined);
  assert.deepStrictEqual(h.log.tabs, ['https://example.com/a']);
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://settings', 'file:///etc/passwd', 'https://u:p@example.com', 'not a url', 5, undefined]) {
    t += 60000; // refill bucket so we test validation, not rate limit
    const res = await d.handle({ id: 'u', method: 'tabs.open', params: { url } });
    assert.strictEqual(res.error && res.error.code, 'invalid_params', String(url));
  }
  assert.strictEqual(h.log.tabs.length, 1);
  // rate limit: burst of 3, then refused
  t = 1e6; h = dispatcher(['tabs.open'], null, clock); d = h.d;
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await d.handle({ id: i + 1, method: 'tabs.open', params: { url: 'https://example.com/' + i } })).error?.code || 'ok');
  assert.deepStrictEqual(codes, ['ok', 'ok', 'ok', 'rate_limited', 'rate_limited']);

  /* ---- ui ---- */
  t = 2e6; h = dispatcher(['ui.toast'], null, clock); d = h.d;
  await d.handle({ id: 1, method: 'ui.setTitle', params: { title: '  Hi\u202e there\n\n ' + 'x'.repeat(100) } });
  assert.ok(!/[\u202e\n]/.test(h.log.titles[0]) && h.log.titles[0].length <= 60);
  await d.handle({ id: 2, method: 'ui.toast', params: { text: 'hello', type: 'weird' } });
  assert.deepStrictEqual(h.log.toasts[0], ['hello', 'info']);
  assert.strictEqual((await d.handle({ id: 3, method: 'ui.toast', params: { text: '   ' } })).error.code, 'invalid_params');
  ({ d } = dispatcher([]));
  assert.strictEqual((await d.handle({ id: 4, method: 'ui.toast', params: { text: 'x' } })).error.code, 'permission_denied');

  /* ---- global rate limit + abuse suspension ---- */
  t = 3e6; h = dispatcher([], null, clock); d = h.d;
  let limited = 0, ok = 0;
  for (let i = 0; i < 100; i++) { const x = await d.handle({ id: i + 1, method: 'host.info' }); if (x && x.error && x.error.code === 'rate_limited') limited++; else if (x) ok++; }
  assert.ok(ok <= PP.LIMITS.burst + 1 && limited > 0, `ok=${ok} limited=${limited}`);
  assert.ok(d.isSuspended(), 'a flood must suspend the widget');
  assert.strictEqual(await d.handle({ id: 'z', method: 'host.info' }), null);   // suspended widgets get silence

  /* ---- oversize params ---- */
  t = 4e6; ({ d } = dispatcher(['storage'], null, clock));
  assert.strictEqual((await d.handle({ id: 1, method: 'storage.get', params: { key: 'a', junk: 'x'.repeat(200 * 1024) } })).error.code, 'invalid_params');

  /* ---- internal errors never leak ---- */
  ({ d } = dispatcher([], { info: () => { throw new Error('secret path /home/x'); } }));
  const ie = await d.handle({ id: 1, method: 'host.info' });
  assert.strictEqual(ie.error.code, 'internal'); assert.ok(!/secret/.test(JSON.stringify(ie)));

  /* ---- theme payload ---- */
  const th = PP.themeFromVars(n => ({ '--bg-color': '#ffffff', '--text-color': 'rgb(1, 2, 3)', '--main-color': 'red; background:url(x)', '--fb-font': 'system-ui, sans-serif' }[n]));
  assert.strictEqual(th.scheme, 'light'); assert.ok(!('main' in th.colors)); assert.strictEqual(th.colors.text, 'rgb(1, 2, 3)');
  assert.strictEqual(PP.themeFromVars(() => '#111111').scheme, 'dark');

  /* ---- END TO END: SDK client <-> dispatcher over a real MessageChannel ---- */
  {
    const ch = new MessageChannel();
    const e2e = makeCtx();
    const disp = PP.createDispatcher({ handlers: PP.createHandlers(), granted: ['storage', 'ui.toast'], ctx: e2e.ctx });
    PP.serveRpc(ch.port1, disp);
    const tb = SDK.createClient(ch.port2, { info: { protocol: 1, permissions: ['storage', 'ui.toast'], theme: { colors: {}, scheme: 'dark' } } });
    await tb.storage.set('count', 41);
    assert.strictEqual(await tb.storage.get('count'), 41);
    assert.deepStrictEqual(await tb.storage.keys(), ['count']);
    await tb.ui.toast('hi', 'success');
    assert.deepStrictEqual(e2e.log.toasts[0], ['hi', 'success']);
    await assert.rejects(() => tb.tabs.open('https://example.com'), (e) => e.name === 'TabsBoardError' && e.code === 'permission_denied');
    await assert.rejects(() => tb.bookmarks.list(), (e) => e.code === 'permission_denied');
    await assert.rejects(() => tb.storage.set('__proto__', 1), (e) => e.code === 'invalid_params');
    await assert.rejects(() => tb.storage.set('fn', () => 1), (e) => e.code === 'invalid_params'); // un-cloneable value is rejected client-side
    // host → widget events
    const got = new Promise(res => tb.on('theme', res));
    ch.port1.postMessage({ event: 'theme', data: { colors: { bg: '#000' }, scheme: 'dark' } });
    assert.strictEqual((await got).colors.bg, '#000'); assert.strictEqual(tb.info.theme.colors.bg, '#000');
    // events the SDK doesn't know are delivered to listeners but never break the client
    const vis = new Promise(res => tb.on('visibility', res));
    ch.port1.postMessage({ event: 'visibility', data: { visible: false } });
    assert.strictEqual((await vis).visible, false); assert.strictEqual(tb.info.visible, false);
    ch.port1.postMessage({ event: 'something-new', data: 1 }); ch.port1.postMessage('garbage'); ch.port1.postMessage(null);
    assert.strictEqual(await tb.storage.get('count'), 41); // still healthy
    ch.port1.close(); ch.port2.close();
  }

  console.log('plugin-protocol tests passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
