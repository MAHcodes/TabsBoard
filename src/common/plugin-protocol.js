/* Widget plugin protocol — the pure, DOM-free half of the plugin API.
 *
 * Third-party widgets run in sandboxed iframes (see newtab/plugins.js). This
 * file holds everything about the *contract* between the dashboard ("host")
 * and a widget, so it can be unit-tested in node:
 *
 *   - the permission catalog and manifest validation
 *   - entry-URL rules (what a widget may be loaded from)
 *   - the RPC dispatcher: envelope validation, permission gating, per-method
 *     rate limits, abuse detection, JSON-only payloads with size caps
 *   - the handler table (storage, bookmarks, tabs, ui, theme) written against
 *     an abstract `ctx`, so the browser supplies the real implementations
 *
 * Nothing here trusts the widget. Every message arriving from an iframe is
 * treated as hostile input until it passes `Dispatcher.handle`.
 *
 * Exposes `self.PluginProtocol` in the browser and `module.exports` in node. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PluginProtocol = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const PROTOCOL_VERSION = 1;

  /* ---------- limits ---------- */
  const LIMITS = Object.freeze({
    manifestBytes: 32 * 1024,
    entryUrlLength: 2048,
    messageBytes: 128 * 1024,     // one RPC request, measured structurally
    storageKeys: 100,
    storageKeyLength: 64,
    storageValueBytes: 64 * 1024, // one value
    storageTotalBytes: 256 * 1024,// all values of one widget instance
    jsonDepth: 6,
    titleLength: 60,
    toastLength: 120,
    queryLength: 100,
    bookmarkResults: 200,
    bookmarkDefaultResults: 50,
    // global token bucket per widget instance
    burst: 40,
    perSecond: 20,
    // after this many rate-limit rejections inside `abuseWindowMs` the host
    // suspends the widget instead of continuing to answer it
    abuseViolations: 60,
    abuseWindowMs: 10 * 1000
  });

  /* ---------- permission catalog ----------
     The *only* things a widget can ask for. Anything not listed here cannot be
     requested, so a manifest naming it is rejected rather than ignored. Note
     what is deliberately absent: history, downloads, cookies, tab contents,
     arbitrary host access. A widget's own network access is governed by its
     own page (and the browser's cross-origin rules), not by this table. */
  const PERMISSIONS = Object.freeze({
    'storage': {
      label: 'Remember data',
      description: 'Save a small amount of data (up to 256 KB) for this widget on this device.',
      risk: 'low'
    },
    'ui.toast': {
      label: 'Show notifications',
      description: 'Show brief in-dashboard notices, labelled with the widget name.',
      risk: 'low'
    },
    'bookmarks.read': {
      label: 'Read your bookmarks',
      description: 'See the titles and URLs of bookmarks and collections in the current workspace (read-only). The widget can send what it reads to its own server.',
      risk: 'medium'
    },
    'tabs.open': {
      label: 'Open links in new tabs',
      description: 'Open http(s) links in background tabs (rate-limited).',
      risk: 'medium'
    }
  });

  const PERMISSION_IDS = Object.freeze(Object.keys(PERMISSIONS));

  /* ---------- small helpers ---------- */
  function isPlainObject(v) {
    if (v === null || typeof v !== 'object') return false;
    if (Object.prototype.toString.call(v) !== '[object Object]') return false;
    const proto = Object.getPrototypeOf(v);
    return proto === null || proto === Object.prototype;
  }
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function cleanText(v, max) {
    // Strip control chars (incl. bidi overrides) and collapse whitespace so a
    // widget can't spoof host UI via the title / toast text.
    let s = String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    if (s.length > max) s = s.slice(0, max);
    return s;
  }

  /* Structural size of a JSON-like value, in characters. Returns -1 when the
     value contains anything that is not plain JSON (functions, symbols,
     undefined, NaN/Infinity, Map/Date/class instances, cycles-by-depth, over-
     long keys) and Infinity when it exceeds `max`. Bails out early so a giant
     payload can't make the host burn CPU measuring it. */
  function measure(value, max, depthLimit) {
    const limit = depthLimit == null ? LIMITS.jsonDepth : depthLimit;
    let total = 0;
    let bad = false;
    (function walk(v, depth) {
      if (bad || total > max) return;
      if (v === null) { total += 4; return; }
      const t = typeof v;
      if (t === 'string') { total += v.length + 2; return; }
      if (t === 'boolean') { total += 5; return; }
      if (t === 'number') { if (!Number.isFinite(v)) bad = true; else total += String(v).length; return; }
      if (t !== 'object' || depth >= limit) { bad = true; return; }
      if (Array.isArray(v)) {
        total += 2;
        for (let i = 0; i < v.length; i++) { walk(v[i], depth + 1); if (bad || total > max) return; total += 1; }
        return;
      }
      if (!isPlainObject(v)) { bad = true; return; }
      total += 2;
      for (const k of Object.keys(v)) {
        if (k.length > LIMITS.storageKeyLength * 2 || FORBIDDEN_KEYS.has(k)) { bad = true; return; }
        total += k.length + 3;
        walk(v[k], depth + 1);
        if (bad || total > max) return;
      }
    })(value, 0);
    if (bad) return -1;
    return total > max ? Infinity : total;
  }

  /* ---------- errors ---------- */
  class ProtocolError extends Error {
    constructor(code, message) { super(message); this.name = 'ProtocolError'; this.code = code; }
  }

  /* ---------- entry URL rules ----------
     A widget is loaded from `entry`. Only https is accepted, plus plain http
     for loopback so developers can test against a local dev server. No
     credentials, no fragments (the host owns the fragment), bounded length.
     data:, blob:, javascript:, file:, chrome-extension:, moz-extension: and
     friends can never be an entry, so a widget can never be served from the
     extension's own origin. */
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  function parseEntryUrl(input, base) {
    if (typeof input !== 'string' || !input.trim()) return { ok: false, error: 'entry must be a URL string' };
    if (input.length > LIMITS.entryUrlLength) return { ok: false, error: 'entry URL is too long' };
    let u;
    try { u = base ? new URL(input.trim(), base) : new URL(input.trim()); }
    catch (e) { return { ok: false, error: 'entry is not a valid URL' }; }
    const dev = u.protocol === 'http:' && LOOPBACK.has(u.hostname);
    if (u.protocol !== 'https:' && !dev) {
      return { ok: false, error: 'entry must use https:// (http:// is only allowed for localhost)' };
    }
    if (u.username || u.password) return { ok: false, error: 'entry must not contain credentials' };
    if (!u.hostname) return { ok: false, error: 'entry has no host' };
    u.hash = '';
    return { ok: true, url: u.href, origin: u.origin, host: u.host, dev };
  }

  /* ---------- manifest ----------
     {
       "id": "com.example.hello",          // reverse-DNS-ish, [a-z0-9._-], 3–64
       "name": "Hello",                    // ≤ 40 chars
       "version": "1.0.0",
       "description": "…",                 // optional, ≤ 200
       "author": "…",                      // optional, ≤ 60
       "entry": "https://example.com/hello/index.html",
       "permissions": ["storage"],         // subset of PERMISSIONS
       "defaultSpan": 1, "defaultRowSpan": 1  // 1–4
     }
     Unknown fields are dropped (not preserved), unknown permissions are an
     error, so a manifest can't smuggle in a capability the host doesn't know
     how to gate. */
  const ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
  const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,24})?$/;

  function validateManifest(raw, opts) {
    const errors = [];
    if (!isPlainObject(raw)) return { ok: false, errors: ['manifest must be a JSON object'] };
    const base = opts && opts.baseUrl;

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!ID_RE.test(id)) errors.push('id must be 3–64 chars of a–z, 0–9, "." "_" "-" (starting with a letter or digit)');

    const name = cleanText(raw.name, 200);
    if (!name) errors.push('name is required');
    else if (name.length > 40) errors.push('name must be at most 40 characters');

    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    if (!VERSION_RE.test(version)) errors.push('version must look like 1.2.3');

    let description = '';
    if (raw.description != null) {
      description = cleanText(raw.description, 400);
      if (description.length > 200) errors.push('description must be at most 200 characters');
    }
    let author = '';
    if (raw.author != null) {
      author = cleanText(raw.author, 200);
      if (author.length > 60) errors.push('author must be at most 60 characters');
    }

    const entry = parseEntryUrl(raw.entry, base);
    if (!entry.ok) errors.push(entry.error);

    let permissions = [];
    if (raw.permissions != null) {
      if (!Array.isArray(raw.permissions)) errors.push('permissions must be an array');
      else {
        for (const p of raw.permissions) {
          if (typeof p !== 'string' || !hasOwn(PERMISSIONS, p)) errors.push('unknown permission: ' + cleanText(p, 40));
          else if (!permissions.includes(p)) permissions.push(p);
        }
      }
    }

    const span = (v, field) => {
      if (v == null) return 1;
      if (!Number.isInteger(v) || v < 1 || v > 4) { errors.push(field + ' must be an integer from 1 to 4'); return 1; }
      return v;
    };
    const defaultSpan = span(raw.defaultSpan, 'defaultSpan');
    const defaultRowSpan = span(raw.defaultRowSpan, 'defaultRowSpan');

    if (errors.length) return { ok: false, errors };
    return {
      ok: true,
      manifest: {
        id, name, version, description, author,
        entry: entry.url, origin: entry.origin, dev: entry.dev,
        permissions, defaultSpan, defaultRowSpan
      }
    };
  }

  /* A stored plugin record = manifest + consent state. Re-validated every time
     it is read, so tampered storage or a hand-edited backup can't smuggle in a
     bad entry URL or a grant the manifest never asked for. */
  function effectivePlugin(rec) {
    if (!isPlainObject(rec)) return null;
    const v = validateManifest(rec);
    if (!v.ok) return null;
    const m = v.manifest;
    const granted = Array.isArray(rec.granted) ? rec.granted.filter((p, i, a) => m.permissions.includes(p) && a.indexOf(p) === i) : [];
    return Object.assign({}, m, {
      granted,
      approved: rec.approved === true,
      installedAt: Number(rec.installedAt) || 0,
      updatedAt: Number(rec.updatedAt) || 0
    });
  }

  /* ---------- token bucket ---------- */
  class TokenBucket {
    constructor(burst, perSecond, now) {
      this.burst = burst; this.perSecond = perSecond; this.now = now || Date.now;
      this.tokens = burst; this.last = this.now();
    }
    take(cost) {
      const t = this.now();
      this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSecond);
      this.last = t;
      const c = cost == null ? 1 : cost;
      if (this.tokens < c) return false;
      this.tokens -= c;
      return true;
    }
  }

  /* ---------- dispatcher ----------
     handlers: Map<method, { permission?: string, limit?: {burst, perSecond},
                              fn: async (params, ctx) => result }>
     A Map (not an object) so a method named "__proto__" or "constructor"
     can never resolve to something inherited. */
  function createDispatcher(opts) {
    const handlers = opts.handlers;
    const granted = new Set(opts.granted || []);
    const now = opts.now || Date.now;
    const onAbuse = opts.onAbuse || function () {};
    const ctx = opts.ctx;
    const bucket = new TokenBucket(LIMITS.burst, LIMITS.perSecond, now);
    const methodBuckets = new Map();
    let violations = [];
    let suspended = false;

    function violation() {
      const t = now();
      violations.push(t);
      violations = violations.filter(x => t - x <= LIMITS.abuseWindowMs);
      if (!suspended && violations.length >= LIMITS.abuseViolations) {
        suspended = true;
        try { onAbuse('rate_limit'); } catch (e) { /* host bug must not break the dispatcher */ }
      }
    }
    const fail = (id, code, message) => ({ id, error: { code, message } });

    async function handle(msg) {
      if (suspended) return null; // a suspended widget gets silence, not work
      if (!isPlainObject(msg)) return null; // not even addressable — drop
      const id = msg.id;
      const idOk = (typeof id === 'number' && Number.isSafeInteger(id)) || (typeof id === 'string' && id.length > 0 && id.length <= 64);
      if (!idOk) return null;

      if (!bucket.take(1)) { violation(); return fail(id, 'rate_limited', 'Too many requests'); }

      if (typeof msg.method !== 'string' || msg.method.length > 64) return fail(id, 'bad_request', 'method must be a string');
      const h = handlers.get(msg.method);
      if (!h) return fail(id, 'unknown_method', 'Unknown method: ' + cleanText(msg.method, 64));
      if (h.permission && !granted.has(h.permission)) {
        return fail(id, 'permission_denied', 'This widget was not granted the "' + h.permission + '" permission');
      }
      if (h.limit) {
        let mb = methodBuckets.get(msg.method);
        if (!mb) { mb = new TokenBucket(h.limit.burst, h.limit.perSecond, now); methodBuckets.set(msg.method, mb); }
        if (!mb.take(1)) { violation(); return fail(id, 'rate_limited', 'Too many "' + msg.method + '" calls'); }
      }
      let params = msg.params;
      if (params == null) params = {};
      if (!isPlainObject(params)) return fail(id, 'invalid_params', 'params must be an object');
      const size = measure(params, LIMITS.messageBytes);
      if (size < 0) return fail(id, 'invalid_params', 'params must be plain JSON');
      if (size === Infinity) return fail(id, 'invalid_params', 'params are too large');

      try {
        const result = await h.fn(params, ctx);
        return { id, result: result === undefined ? null : result };
      } catch (e) {
        if (e instanceof ProtocolError) return fail(id, e.code, e.message);
        return fail(id, 'internal', 'Internal error'); // never leak host stack/internal messages
      }
    }
    return { handle, isSuspended: () => suspended, granted };
  }

  /* Bind a dispatcher to one end of a MessageChannel. */
  function serveRpc(port, dispatcher) {
    port.onmessage = async (e) => {
      let res = null;
      try { res = await dispatcher.handle(e.data); } catch (err) { res = null; }
      if (res) { try { port.postMessage(res); } catch (err) { /* port closed */ } }
    };
  }

  /* ---------- param validators ---------- */
  function reqString(params, key, max, { allowEmpty } = {}) {
    const v = params[key];
    if (typeof v !== 'string') throw new ProtocolError('invalid_params', key + ' must be a string');
    if (!allowEmpty && !v) throw new ProtocolError('invalid_params', key + ' must not be empty');
    if (v.length > max) throw new ProtocolError('invalid_params', key + ' is too long');
    return v;
  }
  function validKey(key) {
    if (typeof key !== 'string' || !key || key.length > LIMITS.storageKeyLength || !/^[A-Za-z0-9._:-]+$/.test(key) || FORBIDDEN_KEYS.has(key)) {
      throw new ProtocolError('invalid_params', 'key must be 1–' + LIMITS.storageKeyLength + ' chars of A–Z a–z 0–9 . _ : - ');
    }
    return key;
  }
  function httpUrl(v) {
    if (typeof v !== 'string' || v.length > LIMITS.entryUrlLength) throw new ProtocolError('invalid_params', 'url must be a string up to ' + LIMITS.entryUrlLength + ' chars');
    let u;
    try { u = new URL(v); } catch (e) { throw new ProtocolError('invalid_params', 'url is not valid'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ProtocolError('invalid_params', 'only http(s) URLs can be opened');
    if (u.username || u.password) throw new ProtocolError('invalid_params', 'url must not contain credentials');
    return u.href;
  }

  /* ---------- storage (pure) ---------- */
  function storageTotal(data) {
    let n = 0;
    for (const k of Object.keys(data)) n += k.length + Math.max(0, measure(data[k], Infinity - 1));
    return n;
  }
  function storageGet(data, key) { return hasOwn(data, key) ? data[key] : null; }
  function storageSet(data, key, value) {
    validKey(key);
    const size = measure(value, LIMITS.storageValueBytes);
    if (size < 0) throw new ProtocolError('invalid_params', 'value must be plain JSON (no undefined, functions, NaN or class instances; max depth ' + LIMITS.jsonDepth + ')');
    if (size === Infinity) throw new ProtocolError('quota_exceeded', 'value exceeds ' + (LIMITS.storageValueBytes / 1024) + ' KB');
    const next = Object.assign({}, data);
    const isNew = !hasOwn(next, key);
    next[key] = value;
    if (isNew && Object.keys(next).length > LIMITS.storageKeys) throw new ProtocolError('quota_exceeded', 'too many keys (max ' + LIMITS.storageKeys + ')');
    if (storageTotal(next) > LIMITS.storageTotalBytes) throw new ProtocolError('quota_exceeded', 'storage is full (max ' + (LIMITS.storageTotalBytes / 1024) + ' KB)');
    return next;
  }
  function storageRemove(data, key) {
    validKey(key);
    if (!hasOwn(data, key)) return data;
    const next = Object.assign({}, data);
    delete next[key];
    return next;
  }

  /* ---------- host → widget theme payload ---------- */
  const THEME_VARS = Object.freeze({
    bg: '--bg-color', main: '--main-color', caret: '--caret-color', sub: '--sub-color',
    subAlt: '--sub-alt-color', text: '--text-color', error: '--error-color', border: '--border-color'
  });
  const SAFE_CSS_VALUE = /^[#a-zA-Z0-9(),.%\s/-]{1,64}$/;
  function hexLuminance(hex) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function themeFromVars(readVar) {
    const colors = {};
    for (const [key, cssVar] of Object.entries(THEME_VARS)) {
      const v = String(readVar(cssVar) || '').trim();
      if (SAFE_CSS_VALUE.test(v)) colors[key] = v;
    }
    const lum = colors.bg ? hexLuminance(colors.bg) : null;
    const font = String(readVar('--fb-font') || '').trim();
    return {
      colors,
      scheme: lum != null && lum > 0.5 ? 'light' : 'dark',
      font: /^[^;{}<>]{1,300}$/.test(font) ? font : ''
    };
  }

  /* ---------- handler table ----------
     ctx supplies the host-specific pieces; nothing below touches the DOM or
     chrome.* directly:
       ctx.info()                      -> object
       ctx.theme()                     -> object
       ctx.getData() / ctx.setData(o)  -> widget-private storage object
       ctx.listBookmarks()             -> raw bookmark records
       ctx.listCollections()           -> raw collection records
       ctx.openTab(url)                -> Promise
       ctx.toast(text, type)           -> void
       ctx.setTitle(text)              -> void                                */
  function createHandlers() {
    const H = new Map();
    const add = (method, spec) => H.set(method, spec);

    add('host.info', { fn: async (_p, ctx) => ctx.info() });
    add('theme.get', { fn: async (_p, ctx) => ctx.theme() });

    add('ui.setTitle', {
      limit: { burst: 5, perSecond: 2 },
      fn: async (p, ctx) => { ctx.setTitle(cleanText(reqString(p, 'title', 500, { allowEmpty: true }), LIMITS.titleLength)); }
    });
    add('ui.toast', {
      permission: 'ui.toast', limit: { burst: 3, perSecond: 1 / 3 },
      fn: async (p, ctx) => {
        const text = cleanText(reqString(p, 'text', 1000), LIMITS.toastLength);
        if (!text) throw new ProtocolError('invalid_params', 'text must not be empty');
        const type = ['info', 'success', 'warning', 'error'].includes(p.type) ? p.type : 'info';
        ctx.toast(text, type);
      }
    });

    add('storage.get', { permission: 'storage', fn: async (p, ctx) => storageGet(ctx.getData(), validKey(p.key)) });
    add('storage.set', {
      permission: 'storage', limit: { burst: 20, perSecond: 10 },
      fn: async (p, ctx) => { if (!hasOwn(p, 'value')) throw new ProtocolError('invalid_params', 'value is required'); ctx.setData(storageSet(ctx.getData(), p.key, p.value)); }
    });
    add('storage.remove', { permission: 'storage', fn: async (p, ctx) => { ctx.setData(storageRemove(ctx.getData(), p.key)); } });
    add('storage.keys', { permission: 'storage', fn: async (_p, ctx) => Object.keys(ctx.getData()) });
    add('storage.clear', { permission: 'storage', fn: async (_p, ctx) => { ctx.setData({}); } });

    add('collections.list', {
      permission: 'bookmarks.read', limit: { burst: 10, perSecond: 2 },
      fn: async (_p, ctx) => ctx.listCollections().slice(0, LIMITS.bookmarkResults).map(c => ({
        id: cleanText(c.id, 64), name: cleanText(c.name, 200)
      }))
    });
    add('bookmarks.list', {
      permission: 'bookmarks.read', limit: { burst: 10, perSecond: 2 },
      fn: async (p, ctx) => {
        let limit = LIMITS.bookmarkDefaultResults;
        if (p.limit != null) {
          if (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > LIMITS.bookmarkResults) throw new ProtocolError('invalid_params', 'limit must be an integer 1–' + LIMITS.bookmarkResults);
          limit = p.limit;
        }
        const q = p.query == null ? '' : reqString(p, 'query', LIMITS.queryLength, { allowEmpty: true }).toLowerCase();
        const colId = p.collectionId == null ? null : reqString(p, 'collectionId', 64);
        const cols = new Map(ctx.listCollections().map(c => [c.id, c.name]));
        const out = [];
        for (const b of ctx.listBookmarks()) {
          if (out.length >= limit) break;
          if (colId && b.collectionId !== colId) continue;
          const title = cleanText(b.title || b.url, 200);
          const url = String(b.url || '').slice(0, LIMITS.entryUrlLength);
          if (q && !(title.toLowerCase().includes(q) || url.toLowerCase().includes(q))) continue;
          // only http(s) URLs leave the host; keeps javascript:/data: strings out of widgets
          if (!/^https?:\/\//i.test(url)) continue;
          out.push({ id: cleanText(b.id, 64), title, url, collectionId: cleanText(b.collectionId, 64), collection: cleanText(cols.get(b.collectionId) || '', 200) });
        }
        return out;
      }
    });

    add('tabs.open', {
      permission: 'tabs.open', limit: { burst: 3, perSecond: 1 / 20 },
      fn: async (p, ctx) => { await ctx.openTab(httpUrl(p.url)); }
    });

    return H;
  }

  return {
    PROTOCOL_VERSION, LIMITS, PERMISSIONS, PERMISSION_IDS, THEME_VARS,
    ProtocolError, TokenBucket,
    isPlainObject, cleanText, measure,
    parseEntryUrl, validateManifest, effectivePlugin,
    createDispatcher, serveRpc, createHandlers,
    storageGet, storageSet, storageRemove, storageTotal,
    themeFromVars
  };
});
