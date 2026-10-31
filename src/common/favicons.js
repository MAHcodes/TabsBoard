/* TabsBoard — favicon service.
 *
 * Why this exists: the old code rendered <img onerror="..."> inline. Extension
 * pages run under a CSP that forbids inline event handlers, so those handlers
 * never fired and a failed icon showed as a broken image instead of falling
 * back. This module replaces that with:
 *
 *   - a candidate chain per page (cached copy -> stored icon -> provider ->
 *     other provider -> generated letter tile), walked by ONE delegated,
 *     CSP-safe `error` listener (no inline handlers anywhere);
 *   - a persistent cache of icons as small data: URIs (own storage key, so
 *     writing it never triggers a board re-render), with a TTL, an LRU cap,
 *     and negative caching so dead hosts aren't re-probed on every render;
 *   - refetchMeta(): re-reads a page's <title> and best icon.
 *
 * Plain classic script; exposes self.Favicons.
 */
(function () {
  const CACHE_KEY = 'tdb_favicon_cache';
  const TTL_MS = 14 * 24 * 3600 * 1000;       // serve stale after this, refresh in background
  const MISS_TTL_MS = 24 * 3600 * 1000;       // don't re-probe a failed host for a day
  const MAX_ENTRIES = 400;
  const MAX_BYTES = 24 * 1024;                // skip oversized icons
  const FETCH_TIMEOUT = 8000;
  const CONCURRENCY = 4;

  const api = (typeof chrome !== 'undefined' && chrome.storage) ? chrome : null;
  let source = 'google';                      // google | duckduckgo | none (kept in sync by setSource)
  let cache = {};                             // host -> { d: dataUri|'' , t: ms, m?: 1 (miss) , u?: sourceUrl }
  let ready = false;
  let dirty = false;
  let saveTimer = null;
  const bad = new Set();                      // URLs that errored this session
  const inflight = new Map();                 // host -> Promise
  const queue = [];
  let active = 0;

  /* ---------- helpers ---------- */
  function hostOf(url) {
    try {
      const u = new URL(url);
      // u.host includes a non-default port, so services on different ports of
      // the same host (e.g. localhost:3000 vs localhost:4000) keep separate
      // favicons instead of sharing whichever one was cached first.
      return /^https?:$/.test(u.protocol) ? u.host.toLowerCase() : '';
    } catch (e) { return ''; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function usable(u) {
    // Only things an <img> on an extension page can really load. chrome://,
    // about:, chrome-extension://other-id/... and blob: from dead pages can't.
    return typeof u === 'string' && (/^https?:\/\//i.test(u) || /^data:image\//i.test(u));
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

  /* Generated tile: rounded square in the theme's accent colour with the
     site's first letter in the theme's background colour. A data: URI can't see
     CSS variables, so the live theme colours are baked in and the tiles are
     rebuilt by refreshTheme() when the theme changes. */
  const letterCache = new Map();
  const letterUris = new Set();                // every tile URI we've handed out (to find them on theme change)
  function themeColors() {
    let main = '', bg = '';
    try {
      const cs = getComputedStyle(document.documentElement);
      main = cs.getPropertyValue('--main-color').trim();
      bg = cs.getPropertyValue('--bg-color').trim();
    } catch (e) { /* no DOM */ }
    return { main: main || '#e2b714', bg: bg || '#323437' };
  }
  function letter(url) {
    const host = hostOf(url) || String(url || '?');
    if (letterCache.has(host)) return letterCache.get(host);
    const ch = (host.replace(/^www\./, '')[0] || '?').toUpperCase();
    const { main, bg } = themeColors();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${esc(main)}"/><text x="16" y="22.5" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="${esc(bg)}">${esc(ch)}</text></svg>`;
    const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
    letterCache.set(host, uri);
    letterUris.add(uri);
    return uri;
  }
  /* Call after the theme's CSS variables change: rebuild tiles and swap the
     ones already on screen. */
  function refreshTheme() {
    const old = new Set(letterUris);
    letterCache.clear();
    if (typeof document === 'undefined') return;
    document.querySelectorAll('img[data-fav-url]').forEach(i => {
      if (old.has(i.getAttribute('src'))) i.src = letter(i.dataset.favUrl);
    });
  }

  function providerUrl(which, host) {
    if (which === 'duckduckgo') return `https://icons.duckduckgo.com/ip3/${host}.ico`;
    // faviconV2 answers 404 when a site has no icon (the older s2 endpoint
    // returns a generic globe with 200, which can't be told apart).
    return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent('https://' + host)}&size=32`;
  }
  function providers() {
    if (source === 'none') return [];
    return source === 'duckduckgo' ? ['duckduckgo', 'google'] : ['google', 'duckduckgo'];
  }

  /* ---------- cache persistence ---------- */
  function scheduleSave() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(save, 1500);
  }
  function save() {
    saveTimer = null;
    if (!dirty || !api) return;
    dirty = false;
    // LRU cap: drop the oldest-touched entries.
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => (cache[a].a || cache[a].t) - (cache[b].a || cache[b].t));
      keys.slice(0, keys.length - MAX_ENTRIES).forEach(k => delete cache[k]);
    }
    try { api.storage.local.set({ [CACHE_KEY]: cache }, () => { void (chrome.runtime && chrome.runtime.lastError); }); } catch (e) { /* quota: cache is best-effort */ }
  }
  function init(initialSource) {
    if (initialSource) source = initialSource;
    return new Promise((resolve) => {
      if (!api) { ready = true; return resolve(); }
      try {
        api.storage.local.get(CACHE_KEY, (res) => {
          cache = (res && res[CACHE_KEY]) || {};
          ready = true;
          resolve();
        });
      } catch (e) { ready = true; resolve(); }
    });
  }
  function setSource(s) { source = s || 'google'; }

  /* ---------- resolving for display ---------- */
  function fresh(entry) { return entry && !entry.m && entry.d && (Date.now() - entry.t) < TTL_MS; }

  /* Ordered list of things to try for <img src>, best first. The last entry is
     always the letter tile, which cannot fail. */
  function candidates(pageUrl, stored) {
    const out = [];
    const host = hostOf(pageUrl);
    const c = host && cache[host];
    if (c && c.d && !c.m) out.push(c.d);
    if (usable(stored) && !bad.has(stored)) out.push(stored);
    if (host && !(c && c.m && (Date.now() - c.t) < MISS_TTL_MS)) {
      providers().forEach(p => out.push(providerUrl(p, host)));
    }
    out.push(letter(pageUrl));
    return out.filter((u, i) => !bad.has(u) && out.indexOf(u) === i);
  }

  /* Synchronous best src for a page. Also kicks off a background caching job
     when there's no fresh cached copy yet. */
  function src(pageUrl, stored) {
    const host = hostOf(pageUrl);
    if (host && source !== 'none' && !fresh(cache[host])) ensure(pageUrl, stored);
    const list = candidates(pageUrl, stored);
    if (host && cache[host]) cache[host].a = Date.now();
    return list[0] || letter(pageUrl);
  }

  /* <img> markup. data-fav-url + data-fav-step let the delegated error handler
     advance through the chain; data-fav-host lets a finished download swap the
     already-rendered icon in place without re-rendering the board. */
  function img(pageUrl, stored, cls, extra) {
    const host = hostOf(pageUrl);
    return `<img class="${esc(cls || 'favicon')}" src="${esc(src(pageUrl, stored))}" alt="" loading="lazy" decoding="async"` +
      ` data-fav-url="${esc(pageUrl || '')}" data-fav-stored="${esc(usable(stored) ? stored : '')}" data-fav-step="0"` +
      (host ? ` data-fav-host="${esc(host)}"` : '') + (extra ? ' ' + extra : '') + '>';
  }

  /* One capture-phase listener replaces every inline onerror. */
  function onImgError(e) {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || t.dataset.favUrl === undefined) return;
    const failed = t.getAttribute('src');
    if (failed && failed !== letter(t.dataset.favUrl)) bad.add(failed);
    const list = candidates(t.dataset.favUrl, t.dataset.favStored);
    const next = list.find(u => u !== failed);
    if (next && next !== failed) t.src = next;
    else if (t.src !== letter(t.dataset.favUrl)) t.src = letter(t.dataset.favUrl);
  }
  function swapRendered(host, dataUri) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('img[data-fav-host]').forEach(i => {
      if (i.dataset.favHost === host) i.src = dataUri;
    });
  }

  /* ---------- downloading + caching ---------- */
  function withTimeout(promise, ms, controller) {
    const timer = setTimeout(() => controller.abort(), ms);
    return promise.finally ? promise.finally(() => clearTimeout(timer)) : promise.then(v => { clearTimeout(timer); return v; }, e => { clearTimeout(timer); throw e; });
  }
  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  /* Downscale big icons (apple-touch-icons are often 180px) to keep storage small. */
  async function shrink(blob) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined' || /svg|x-icon|vnd.microsoft.icon/i.test(blob.type)) return blob;
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp.width <= 64 && bmp.height <= 64) { bmp.close && bmp.close(); return blob; }
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d').drawImage(bmp, 0, 0, 64, 64);
      bmp.close && bmp.close();
      return await new Promise(res => c.toBlob(b => res(b || blob), 'image/png'));
    } catch (e) { return blob; }
  }
  async function downloadIcon(url) {
    const ctl = new AbortController();
    const res = await withTimeout(fetch(url, { credentials: 'omit', signal: ctl.signal, cache: 'force-cache' }), FETCH_TIMEOUT, ctl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let blob = await res.blob();
    const type = (blob.type || '').toLowerCase();
    if (type && !/^image\//.test(type) && !/octet-stream/.test(type)) throw new Error('not an image');
    if (blob.size < 20) throw new Error('empty');
    blob = await shrink(blob);
    if (blob.size > MAX_BYTES) throw new Error('too large');
    let uri = await blobToDataUri(blob);
    if (/^data:application\/octet-stream/.test(uri)) uri = uri.replace('application/octet-stream', 'image/x-icon');
    return uri;
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  }
  function enqueue(fn) {
    return new Promise((resolve) => { queue.push(() => fn().then(resolve, resolve)); pump(); });
  }

  /* Download + cache the icon for a page's host (deduped, throttled, silent on
     failure). Never throws. */
  function ensure(pageUrl, stored, force) {
    const host = hostOf(pageUrl);
    if (!host || source === 'none' || !ready) return Promise.resolve(null);
    const c = cache[host];
    if (!force && (fresh(c) || (c && c.m && Date.now() - c.t < MISS_TTL_MS))) return Promise.resolve(c && c.d || null);
    if (inflight.has(host)) return inflight.get(host);
    const urls = [];
    if (usable(stored) && /^https?:/i.test(stored)) urls.push(stored);
    providers().forEach(p => urls.push(providerUrl(p, host)));
    const p = enqueue(async () => {
      for (const u of urls) {
        try {
          const uri = await downloadIcon(u);
          cache[host] = { d: uri, t: Date.now(), a: Date.now(), u };
          scheduleSave();
          swapRendered(host, uri);
          return uri;
        } catch (e) { /* try next */ }
      }
      // Keep any stale copy; only record a miss when we have nothing.
      if (!(cache[host] && cache[host].d)) { cache[host] = { d: '', t: Date.now(), m: 1 }; scheduleSave(); }
      return null;
    }).finally(() => inflight.delete(host));
    inflight.set(host, p);
    return p;
  }

  function put(pageUrl, dataUri) {
    const host = hostOf(pageUrl);
    if (!host || !dataUri) return;
    cache[host] = { d: dataUri, t: Date.now(), a: Date.now() };
    scheduleSave();
    swapRendered(host, dataUri);
  }
  function clear() {
    cache = {}; bad.clear(); dirty = false;
    return new Promise((resolve) => {
      if (!api) return resolve();
      try { api.storage.local.remove(CACHE_KEY, () => resolve()); } catch (e) { resolve(); }
    });
  }
  function stats() {
    const keys = Object.keys(cache).filter(k => cache[k].d);
    return { count: keys.length, bytes: keys.reduce((n, k) => n + cache[k].d.length, 0) };
  }

  /* ---------- refetch title + icon ---------- */
  function hasAccess(url) {
    return new Promise((resolve) => {
      if (!chrome.permissions || !chrome.permissions.contains) return resolve(true);
      let origin;
      try { origin = new URL(url).origin + '/*'; } catch (e) { return resolve(false); }
      chrome.permissions.contains({ origins: [origin] }, (ok) => resolve(!!ok));
    });
  }
  /* Must be called from a click handler (user gesture). Asks once for all-sites
     access, since refetching reads arbitrary bookmarked pages. */
  function requestAccess() {
    return new Promise((resolve) => {
      if (!chrome.permissions || !chrome.permissions.request) return resolve(true);
      // Call request() immediately: Firefox only honors it synchronously inside
      // the click handler (checking contains() first used up the gesture and made
      // it always come back denied). It resolves true without a prompt when the
      // access is already granted.
      try {
        chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
          void chrome.runtime.lastError;
          resolve(!!granted);
        });
      } catch (e) { resolve(false); }
    });
  }

  async function readCapped(res, cap) {
    if (!res.body || !res.body.getReader) return (await res.text()).slice(0, cap);
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let out = '';
    while (out.length < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(out)) break;
    }
    try { reader.cancel(); } catch (e) { /* ignore */ }
    return out;
  }
  function pickIcon(doc, base) {
    const links = Array.from(doc.querySelectorAll('link[rel][href]')).filter(l => /(^|\s)(icon|shortcut|apple-touch-icon(-precomposed)?)(\s|$)/i.test(l.getAttribute('rel')));
    const scored = links.map(l => {
      const sizes = (l.getAttribute('sizes') || '').match(/(\d+)x\d+/);
      const px = sizes ? parseInt(sizes[1], 10) : 0;
      const rel = l.getAttribute('rel').toLowerCase();
      const isApple = rel.indexOf('apple') !== -1;
      const isSvg = /svg/i.test(l.getAttribute('type') || '') || /\.svg(\?|$)/i.test(l.getAttribute('href'));
      // Prefer something near 32-64px; apple icons are a good (large, clean) fallback.
      let score = px ? 100 - Math.abs(48 - px) : 40;
      if (isApple) score -= 10;
      if (isSvg) score += 15;
      return { href: l.getAttribute('href'), score };
    }).sort((a, b) => b.score - a.score);
    const out = [];
    for (const s of scored) { try { out.push(new URL(s.href, base).href); } catch (e) { /* skip */ } }
    try { out.push(new URL('/favicon.ico', base).href); } catch (e) { /* skip */ }
    return out.filter((u, i) => out.indexOf(u) === i && /^https?:/i.test(u));
  }

  function metaContent(doc, selectors) {
    for (const sel of selectors) {
      const m = doc.querySelector(sel);
      const v = m && (m.getAttribute('content') || '').replace(/\s+/g, ' ').trim();
      if (v) return v;
    }
    return '';
  }
  function absUrl(u, base) {
    try { const a = new URL(u, base); return /^https?:$/.test(a.protocol) ? a.href : ''; } catch (e) { return ''; }
  }

  /* Returns { title, description, siteName, image (absolute url), favicon (url),
     iconData } — any field may be '' if the page doesn't declare it. Throws on
     network/permission failure. */
  async function refetchMeta(pageUrl) {
    if (!hostOf(pageUrl)) throw new Error('Not a web page');
    const ctl = new AbortController();
    const res = await withTimeout(fetch(pageUrl, { credentials: 'omit', redirect: 'follow', signal: ctl.signal, headers: { Accept: 'text/html,application/xhtml+xml' } }), FETCH_TIMEOUT, ctl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ctype = res.headers.get('content-type') || '';
    let title = '', description = '', siteName = '', image = '', icons = [];
    if (/html|xml/i.test(ctype) || !ctype) {
      const html = await readCapped(res, 300 * 1024);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const base = res.url || pageUrl;
      const t = (doc.querySelector('title') && doc.querySelector('title').textContent)
        || metaContent(doc, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
      title = t.replace(/\s+/g, ' ').trim();
      description = metaContent(doc, ['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']).slice(0, 300);
      siteName = metaContent(doc, ['meta[property="og:site_name"]', 'meta[name="application-name"]']).slice(0, 80);
      const img = metaContent(doc, ['meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]']);
      if (img) image = absUrl(img, base);
      if (!image) { const l = doc.querySelector('link[rel="image_src"][href]'); if (l) image = absUrl(l.getAttribute('href'), base); }
      icons = pickIcon(doc, base);
    } else {
      try { icons = [new URL('/favicon.ico', res.url || pageUrl).href]; } catch (e) { /* ignore */ }
    }
    let favicon = '', iconData = '';
    for (const u of icons) {
      try { iconData = await downloadIcon(u); favicon = u; break; } catch (e) { /* next */ }
    }
    if (iconData) put(pageUrl, iconData);
    return { title, description, siteName, image, favicon, iconData };
  }

  if (typeof document !== 'undefined') document.addEventListener('error', onImgError, true);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (dirty) save(); });

  self.Favicons = { init, setSource, refreshTheme, src, img, letter, candidates, ensure, put, clear, stats, hostOf, usable, hasAccess, requestAccess, refetchMeta };
})();
