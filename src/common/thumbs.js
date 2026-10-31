/* TabsBoard — page preview thumbnails.
 *
 * The "refetch" action reads a page's og:image / twitter:image; this stores a
 * downscaled copy per bookmark so grid tiles can show a preview instantly and
 * offline, without hot-linking the original site on every new tab.
 *
 * Images live in IndexedDB as Blobs (not chrome.storage.local): previews are
 * tens of KB each, which would eat the 10 MB storage quota the bookmarks
 * themselves depend on. Tiles carry <img data-thumb="BOOKMARK_ID">; a
 * MutationObserver fills in their src, so render code never has to await.
 *
 * Plain classic script; exposes self.Thumbs.
 */
(function () {
  const DB_NAME = 'tdb_thumbs';
  const STORE = 'thumbs';
  const MAX_W = 480;                 // stored width (tiles are ~120-200px; 2x for hi-dpi)
  const MIN_W = 100;                 // smaller than this is a logo/pixel, not a preview
  const MAX_BYTES = 90 * 1024;
  const FETCH_TIMEOUT = 10000;
  const GC_MIN_AGE = 30 * 24 * 3600 * 1000;

  let dbPromise = null;
  const urlCache = new Map();        // bookmark id -> object URL
  const pending = new Map();         // bookmark id -> Promise<string|null>

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }
  function tx(mode, fn) {
    return open().then(db => new Promise((resolve) => {
      if (!db) return resolve(null);
      let out;
      try {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        out = fn(store);
        t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
        t.onerror = t.onabort = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }

  function revoke(id) {
    const u = urlCache.get(id);
    if (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } urlCache.delete(id); }
  }

  /* Object URL for a bookmark's stored preview, or null. Cached for the session. */
  function url(id) {
    if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
    if (pending.has(id)) return pending.get(id);
    const p = tx('readonly', s => s.get(id)).then(rec => {
      pending.delete(id);
      if (!rec || !rec.blob) return null;
      const u = URL.createObjectURL(rec.blob);
      urlCache.set(id, u);
      return u;
    });
    pending.set(id, p);
    return p;
  }

  function hydrate(root) {
    (root || document).querySelectorAll('img[data-thumb]:not([data-thumb-state])').forEach(img => {
      img.dataset.thumbState = 'loading';
      url(img.dataset.thumb).then(u => {
        if (u) { img.src = u; img.dataset.thumbState = 'ready'; }
        else { img.dataset.thumbState = 'missing'; }
      });
    });
  }

  /* ---------- creating a preview ---------- */
  async function toJpeg(blob) {
    if (typeof createImageBitmap !== 'function') throw new Error('unsupported');
    const bmp = await createImageBitmap(blob);
    if (bmp.width < MIN_W || bmp.height < MIN_W * 0.5) { bmp.close && bmp.close(); throw new Error('too small'); }
    const scale = Math.min(1, MAX_W / bmp.width);
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';            // JPEG has no alpha: flatten transparent PNGs onto white
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    for (const q of [0.82, 0.68, 0.52]) {
      const out = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
      if (out && out.size <= MAX_BYTES) return out;
    }
    throw new Error('too large');
  }

  /* Download imageUrl, shrink it, and store it for the bookmark. Resolves true
     when a preview was saved. Never throws. */
  async function fetchAndStore(id, imageUrl) {
    if (!id || !/^https?:\/\//i.test(imageUrl || '')) return false;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
      let res;
      try { res = await fetch(imageUrl, { credentials: 'omit', signal: ctl.signal }); } finally { clearTimeout(timer); }
      if (!res.ok) return false;
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (type && !/^image\/(png|jpe?g|webp|gif|avif|bmp)/.test(type)) return false; // not svg: can't be rasterised reliably here
      const src = await res.blob();
      if (src.size > 8 * 1024 * 1024) return false;
      const blob = await toJpeg(src);
      await tx('readwrite', s => s.put({ id, blob, t: Date.now() }));
      revoke(id);
      document.querySelectorAll('img[data-thumb]').forEach(img => {
        if (img.dataset.thumb === id) { delete img.dataset.thumbState; }
      });
      hydrate(document);
      return true;
    } catch (e) { return false; }
  }

  function remove(ids) {
    (ids || []).forEach(revoke);
    return tx('readwrite', s => { (ids || []).forEach(id => s.delete(id)); });
  }

  /* Drop previews whose bookmark no longer exists (and isn't sitting in the
     trash, where it can still be restored). Only touches entries older than 30
     days so a just-created preview is never raced away. */
  async function gc(isLive) {
    const keys = await tx('readonly', s => s.getAll());
    if (!keys) return 0;
    const dead = keys.filter(r => Date.now() - r.t > GC_MIN_AGE && !isLive(r.id)).map(r => r.id);
    if (dead.length) await remove(dead);
    return dead.length;
  }

  async function clear() {
    urlCache.forEach((_, id) => revoke(id));
    await tx('readwrite', s => s.clear());
    document.querySelectorAll('img[data-thumb]').forEach(i => { i.removeAttribute('src'); i.dataset.thumbState = 'missing'; });
  }
  async function stats() {
    const all = await tx('readonly', s => s.getAll());
    if (!all) return { count: 0, bytes: 0 };
    return { count: all.length, bytes: all.reduce((n, r) => n + (r.blob ? r.blob.size : 0), 0) };
  }

  if (typeof document !== 'undefined') {
    const start = () => {
      hydrate(document);
      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches('img[data-thumb]')) hydrate(n.parentNode);
            else if (n.querySelector && n.querySelector('img[data-thumb]')) hydrate(n);
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  self.Thumbs = { url, hydrate, fetchAndStore, remove, gc, clear, stats };
})();
