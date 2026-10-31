/* TabsBoard widget SDK (protocol v1)
 *
 * Include this in your widget page, then:
 *
 *   const tb = await TabsBoard.connect();
 *   tb.applyTheme();                         // optional: adopt the dashboard colours
 *   await tb.storage.set('count', 1);        // needs the "storage" permission
 *
 * Your page runs in a sandboxed iframe with an opaque origin: no access to the
 * dashboard's DOM, the extension APIs, or your own origin's cookies/localStorage.
 * Everything privileged goes through the calls below, and only works if the
 * user granted the matching permission (see tb.info.permissions).
 *
 * This file has no dependencies. Copy it next to your widget. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TabsBoard = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const PROTOCOL = 1;

  class TabsBoardError extends Error {
    constructor(code, message) { super(message); this.name = 'TabsBoardError'; this.code = code; }
  }

  /* Build the client around an already-open MessagePort. Exposed for tests;
     widget code should call connect(). */
  function createClient(port, init) {
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    const info = Object.assign({}, init.info);

    function call(method, params, timeoutMs) {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new TabsBoardError('timeout', method + ' timed out')); }, timeoutMs || 10000);
        pending.set(id, { resolve, reject, timer });
        try { port.postMessage({ id, method, params: params || {} }); }
        catch (e) { clearTimeout(timer); pending.delete(id); reject(new TabsBoardError('invalid_params', 'Could not send request: ' + e.message)); }
      });
    }

    function emit(event, data) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of Array.from(set)) { try { fn(data); } catch (e) { console.error('[TabsBoard] listener error', e); } }
    }

    port.onmessage = (e) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.id != null && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new TabsBoardError(m.error.code, m.error.message));
        else p.resolve(m.result);
      } else if (typeof m.event === 'string') {
        if (m.event === 'theme') info.theme = m.data;
        if (m.event === 'resize') { info.width = m.data.width; info.height = m.data.height; }
        if (m.event === 'visibility') info.visible = !!m.data.visible;
        emit(m.event, m.data);
      }
    };

    const client = {
      info,
      /* events: 'theme' | 'resize' | 'visibility'. Returns an unsubscribe fn.
         There is no 'destroy' event: when the dashboard removes your card the
         browser tears the frame down immediately. Save state as you go (the
         storage calls are debounced by the host) and use 'visibility' /
         document 'pagehide' to flush anything pending. */
      on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => listeners.get(event).delete(fn);
      },
      /* Copy the dashboard's colours onto :root as CSS variables
         (--tb-bg, --tb-text, --tb-main, --tb-sub, --tb-sub-alt, --tb-border,
         --tb-error, --tb-caret) and set color-scheme. Keeps itself updated. */
      applyTheme(target) {
        const el = (target || (typeof document !== 'undefined' && document.documentElement));
        if (!el) return;
        const apply = (t) => {
          if (!t || !t.colors) return;
          const map = { bg: '--tb-bg', main: '--tb-main', caret: '--tb-caret', sub: '--tb-sub', subAlt: '--tb-sub-alt', text: '--tb-text', error: '--tb-error', border: '--tb-border' };
          for (const [k, v] of Object.entries(t.colors)) if (map[k]) el.style.setProperty(map[k], v);
          if (t.font) el.style.setProperty('--tb-font', t.font);
          el.style.colorScheme = t.scheme || 'dark';
        };
        apply(info.theme);
        return client.on('theme', apply);
      },
      storage: {
        get: (key) => call('storage.get', { key }),
        set: (key, value) => call('storage.set', { key, value }),
        remove: (key) => call('storage.remove', { key }),
        keys: () => call('storage.keys'),
        clear: () => call('storage.clear')
      },
      bookmarks: {
        /* opts: { query?: string, collectionId?: string, limit?: 1–200 } */
        list: (opts) => call('bookmarks.list', opts || {}),
        collections: () => call('collections.list')
      },
      tabs: { open: (url) => call('tabs.open', { url }) },
      ui: {
        setTitle: (title) => call('ui.setTitle', { title }),
        /* type: 'info' | 'success' | 'warning' | 'error' */
        toast: (text, type) => call('ui.toast', { text, type })
      },
      call // escape hatch for methods newer than this SDK
    };
    return client;
  }

  /* Perform the handshake with the dashboard and resolve with a client. */
  function connect(options) {
    const timeoutMs = (options && options.timeoutMs) || 10000;
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || window.parent === window) {
        reject(new TabsBoardError('not_embedded', 'This page is not running inside a TabsBoard widget frame'));
        return;
      }
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); reject(new TabsBoardError('timeout', 'TabsBoard did not answer the handshake')); }, timeoutMs);
      function onMsg(e) {
        if (e.source !== window.parent) return;
        const d = e.data;
        if (!d || d.type !== 'tb:init') {
          if (d && d.type === 'tb:error') { clearTimeout(timer); window.removeEventListener('message', onMsg); reject(new TabsBoardError(d.code || 'error', d.message || 'Handshake refused')); }
          return;
        }
        if (!e.ports || !e.ports[0]) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(createClient(e.ports[0], d));
      }
      window.addEventListener('message', onMsg);
      // The dashboard's origin is not knowable from an opaque-origin frame, so
      // '*' is required here; the hello carries no secrets.
      window.parent.postMessage({ type: 'tb:hello', protocol: PROTOCOL }, '*');
    });
  }

  return { PROTOCOL, connect, createClient, TabsBoardError };
});
