  /* Widget plugin host: runs third-party widgets in sandboxed iframes.
     Composes with widgets.js / bookmarks.js / settings.js through the shared
     global scope (see index.html for load order). The wire contract, the
     permission catalog and all input validation live in
     common/plugin-protocol.js (`PluginProtocol`) so they can be unit-tested.

     Security model, in one place:
       - Each widget is an <iframe sandbox="allow-scripts"> — *no*
         allow-same-origin — so it gets an opaque origin: no access to the
         dashboard DOM, extension APIs, IndexedDB, or even its own origin's
         storage. No popups, forms, modals, downloads or top navigation.
       - Entry URLs are https:// (or http://localhost for development) only,
         validated by PluginProtocol.parseEntryUrl; never the extension origin.
       - The only channel is a private MessageChannel handed over in response
         to the widget's `tb:hello`. window.postMessage is used for the
         handshake alone, and only messages whose `source` is that widget's
         own contentWindow (and origin "null") are considered.
       - Every request is validated, permission-gated, size-capped and
         rate-limited by PluginProtocol.createDispatcher; a widget that floods
         the host is suspended.
       - Permissions are granted by the user at install time (per permission)
         and re-validated against the manifest each time they're read.
     What the sandbox does NOT do: it can't stop a widget from using CPU or
     from making its own network requests to servers it can reach. Users
     should only install widgets from sources they trust. */

  const PP = PluginProtocol;
  const PLUGIN_HANDLERS = PP.createHandlers();
  const PLUGIN_HANDSHAKE_TIMEOUT_MS = 15000;
  const PLUGIN_SAVE_DEBOUNCE_MS = 400;
  const pluginInstances = new Map(); // widgetId -> instance
  let pluginThemeJson = '';

  /* ---------- registry (read side) ---------- */
  function installedPlugins() {
    const raw = (typeof STATE !== 'undefined' && STATE && STATE.meta && STATE.meta.plugins) || {};
    const out = {};
    for (const rec of Object.values(raw)) {
      const p = PP.effectivePlugin(rec);
      if (p) out[p.id] = p;
    }
    return out;
  }

  /* Fingerprint for the board reconciler. The widget's private `data` is left
     out on purpose: saving a value must never rebuild (= reload) the iframe. */
  function pluginRenderSig(w) {
    const p = installedPlugins()[w.pluginId];
    const rest = Object.assign({}, w); delete rest.data;
    return 'plugin:' + JSON.stringify(rest) + '|' + (p ? [p.version, p.entry, p.approved, p.granted.join(',')].join('|') : 'missing');
  }

  function sanitizePluginData(d) {
    if (!PP.isPlainObject(d)) return {};
    const size = PP.measure(d, PP.LIMITS.storageTotalBytes * 2, PP.LIMITS.jsonDepth + 1);
    return size < 0 || size === Infinity ? {} : d;
  }

  /* ---------- small DOM helpers ---------- */
  function pluginStatus(body, message, actions) {
    const old = body.querySelector(':scope > .plugin-status');
    if (old) old.remove();
    const box = el('div', 'plugin-status');
    const msg = el('div', 'plugin-status-msg');
    msg.textContent = message; // textContent: names/messages are never parsed as HTML
    box.appendChild(msg);
    if (actions && actions.length) {
      const row = el('div', 'plugin-status-actions');
      for (const a of actions) {
        const b = el('button', 'mini-btn');
        b.type = 'button'; b.textContent = a.label; b.onclick = a.fn;
        row.appendChild(b);
      }
      box.appendChild(row);
    }
    body.appendChild(box);
  }
  function clearPluginStatus(body) {
    const old = body.querySelector(':scope > .plugin-status');
    if (old) old.remove();
  }

  function currentPluginTheme() {
    const cs = getComputedStyle(document.documentElement);
    return PP.themeFromVars((name) => cs.getPropertyValue(name));
  }

  /* ---------- instance lifecycle ---------- */
  function pluginPush(inst, event, data) {
    if (!inst.port || inst.destroyed) return;
    try { inst.port.postMessage({ event, data }); } catch (e) { /* port closed */ }
  }

  function pluginInfo(inst) {
    const r = inst.frame ? inst.frame.getBoundingClientRect() : { width: 0, height: 0 };
    const w = STATE.widgets[inst.widgetId] || {};
    return {
      protocol: PP.PROTOCOL_VERSION,
      widgetId: inst.widgetId,
      pluginId: inst.plugin.id,
      version: inst.plugin.version,
      permissions: inst.plugin.granted.slice(),
      span: w.span || 1, rowSpan: w.rowSpan || 1,
      width: Math.round(r.width), height: Math.round(r.height),
      visible: inst.visible && !document.hidden,
      theme: currentPluginTheme(),
      dev: !!inst.plugin.dev
    };
  }

  function pluginSave(inst) {
    inst.dirty = true;
    clearTimeout(inst.saveTimer);
    inst.saveTimer = setTimeout(() => flushPluginData(inst), PLUGIN_SAVE_DEBOUNCE_MS);
  }
  async function flushPluginData(inst) {
    clearTimeout(inst.saveTimer);
    if (!inst.dirty) return;
    inst.dirty = false;
    try { await DB.updateWidget(inst.widgetId, { data: inst.data }); }
    catch (e) { console.error('[plugins] could not save widget data', e); }
  }

  function makePluginCtx(inst) {
    return {
      info: () => pluginInfo(inst),
      theme: () => currentPluginTheme(),
      getData: () => inst.data,
      setData: (d) => { if (inst.destroyed) return; inst.data = d; pluginSave(inst); }, // a replaced/removed frame must not overwrite newer data
      listCollections: () => Object.values(STATE.collections || {})
        .filter(c => c.workspaceId === inst.workspaceId)
        .sort((a, b) => (a.order || 0) - (b.order || 0)),
      listBookmarks: () => Object.values(STATE.bookmarks || {})
        .filter(b => b.workspaceId === inst.workspaceId)
        .sort((a, b) => (a.order || 0) - (b.order || 0)),
      // Background tab + rate limit (see PluginProtocol 'tabs.open'): a widget
      // can't hijack the current tab or spam foreground popups.
      openTab: (url) => new Promise((resolve, reject) => {
        chrome.tabs.create({ url, active: false }, (t) => {
          const err = chrome.runtime && chrome.runtime.lastError;
          err ? reject(new Error(err.message)) : resolve(t);
        });
      }),
      toast: (text, type) => {
        const opts = type && type !== 'info' ? { type } : {};
        toast(inst.plugin.name + ': ' + text, opts); // always attributed, so a widget can't pose as the app
      },
      setTitle: (text) => { if (inst.titleEl) inst.titleEl.textContent = text || inst.plugin.name; }
    };
  }

  function teardownFrame(inst) {
    clearTimeout(inst.handshakeTimer);
    if (inst.port) { try { inst.port.onmessage = null; inst.port.close(); } catch (e) { /* ignore */ } inst.port = null; }
    if (inst.frame) {
      pluginResizeObserver && pluginResizeObserver.unobserve(inst.frame);
      pluginVisibilityObserver && pluginVisibilityObserver.unobserve(inst.frame);
      inst.frame.remove();
      inst.frame = null;
    }
    inst.connected = false;
  }

  function destroyPluginInstance(widgetId) {
    const inst = pluginInstances.get(widgetId);
    if (!inst) return;
    // No 'destroy' event is sent: by the time a card leaves the board the
    // browser has usually torn its iframe down already, so a widget could
    // never act on it. Saved data is flushed here instead; late writes from
    // the dying frame are dropped (see ctx.setData).
    inst.destroyed = true;
    flushPluginData(inst);
    teardownFrame(inst);
    pluginInstances.delete(widgetId);
  }

  function suspendPluginInstance(inst, message) {
    if (inst.destroyed) return;
    const body = inst.body, id = inst.widgetId;
    flushPluginData(inst);
    teardownFrame(inst);
    pluginInstances.delete(id);
    inst.destroyed = true;
    pluginStatus(body, message, [{ label: 'Reload widget', fn: () => reloadPluginWidget(id) }]);
  }

  /* Rebuild one card in place (used by Reload buttons and the menu). */
  function reloadPluginWidget(widgetId) {
    const w = STATE.widgets[widgetId];
    const card = document.querySelector(`#board .widget[data-widget-id="${CSS.escape(widgetId)}"]`);
    if (!w || !card) return;
    const fresh = renderPluginWidget(w);
    fresh.dataset.sig = pluginRenderSig(w);
    card.replaceWith(fresh);
  }

  function mountPluginFrame(inst) {
    const { plugin, body } = inst;
    pluginStatus(body, 'Loading ' + plugin.name + '…');
    const frame = document.createElement('iframe');
    frame.className = 'plugin-frame';
    // Attributes first, src and insertion last — the sandbox must be in place
    // before the document starts loading.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', '');
    frame.setAttribute('title', plugin.name);
    frame.src = plugin.entry;
    inst.frame = frame;
    body.insertBefore(frame, body.firstChild);
    pluginResizeObserver && pluginResizeObserver.observe(frame);
    pluginVisibilityObserver && pluginVisibilityObserver.observe(frame);
    inst.handshakeTimer = setTimeout(() => {
      if (inst.connected || inst.destroyed) return;
      const id = inst.widgetId;
      teardownFrame(inst);
      pluginStatus(body, 'Couldn’t start ' + plugin.name + '. The page may be blocking embedding (X-Frame-Options / frame-ancestors) or doesn’t use the TabsBoard SDK.',
        [{ label: 'Retry', fn: () => reloadPluginWidget(id) }]);
    }, PLUGIN_HANDSHAKE_TIMEOUT_MS);
  }

  /* One window-level listener, used for the handshake only. */
  function onPluginWindowMessage(e) {
    const d = e.data;
    if (!d || typeof d !== 'object' || d.type !== 'tb:hello') return;
    let inst = null;
    for (const i of pluginInstances.values()) { if (i.frame && i.frame.contentWindow === e.source) { inst = i; break; } }
    if (!inst || inst.destroyed) return;
    // A sandboxed frame without allow-same-origin always reports origin "null".
    if (e.origin !== 'null') return;
    if (d.protocol !== PP.PROTOCOL_VERSION) {
      try { e.source.postMessage({ type: 'tb:error', code: 'unsupported_protocol', message: 'This dashboard speaks widget protocol ' + PP.PROTOCOL_VERSION }, '*'); } catch (err) { /* ignore */ }
      return;
    }
    // A widget may legitimately reload itself, but not in a tight loop.
    const t = Date.now();
    inst.handshakes = inst.handshakes.filter(x => t - x < 60000);
    if (inst.handshakes.length >= 6) { suspendPluginInstance(inst, 'This widget kept restarting and was paused.'); return; }
    inst.handshakes.push(t);

    if (inst.port) { try { inst.port.onmessage = null; inst.port.close(); } catch (err) { /* ignore */ } }
    const ch = new MessageChannel();
    inst.port = ch.port1;
    PP.serveRpc(ch.port1, inst.dispatcher);
    inst.connected = true;
    clearTimeout(inst.handshakeTimer);
    clearPluginStatus(inst.body);
    // '*' because an opaque-origin window can't be targeted by origin; the
    // payload is non-sensitive and the frame was identified by `source`.
    e.source.postMessage({ type: 'tb:init', protocol: PP.PROTOCOL_VERSION, info: pluginInfo(inst) }, '*', [ch.port2]);
  }

  /* ---------- shared observers ---------- */
  let pluginResizeObserver = null;
  let pluginVisibilityObserver = null;
  function instanceForFrame(frame) {
    for (const i of pluginInstances.values()) if (i.frame === frame) return i;
    return null;
  }
  function recomputePluginVisibility(inst) {
    pluginPush(inst, 'visibility', { visible: inst.visible && !document.hidden });
  }

  /* ---------- widget renderer ---------- */
  function renderPluginWidget(w) {
    // A rebuilt card replaces its old frame; carry over unsaved data so a
    // fast rebuild can't lose the last write.
    const prev = pluginInstances.get(w.id);
    const seed = prev && prev.dirty ? prev.data : w.data;
    destroyPluginInstance(w.id);

    const plugin = installedPlugins()[w.pluginId] || null;
    const titleHtml = `<span class="widget-title">${escapeHtml(plugin ? plugin.name : 'Plugin')}</span>`;
    const { card, header } = widgetShell(w, ICONS.widget, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openPluginWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body plugin-body');
    card.appendChild(body);

    if (!plugin) {
      pluginStatus(body, 'This widget’s plugin is no longer installed.', [{ label: 'Delete widget', fn: async () => { await DB.deleteWidget(w.id); await reload(); } }]);
      return card;
    }
    if (!plugin.approved) {
      pluginStatus(body, plugin.name + ' needs your approval before it can run.', [{ label: 'Review & enable', fn: () => openPluginConsentModal({ manifest: plugin, existing: plugin, mode: 'review' }) }]);
      return card;
    }

    const inst = {
      widgetId: w.id, workspaceId: w.workspaceId, plugin, card, body,
      titleEl: card.querySelector('.widget-title'),
      frame: null, port: null, connected: false, destroyed: false, visible: true,
      data: sanitizePluginData(seed), dirty: false, saveTimer: null, handshakeTimer: null, handshakes: [],
      dispatcher: null
    };
    inst.dispatcher = PP.createDispatcher({
      handlers: PLUGIN_HANDLERS,
      granted: plugin.granted,
      ctx: makePluginCtx(inst),
      onAbuse: () => suspendPluginInstance(inst, plugin.name + ' sent too many requests and was paused.')
    });
    pluginInstances.set(w.id, inst);
    mountPluginFrame(inst);
    return card;
  }

  /* ---------- widget ⋯ menu ---------- */
  function openPluginWidgetMenu(w, anchorBtn) {
    const plugin = installedPlugins()[w.pluginId];
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    const pluginItems = plugin
      ? `<div class="ws-item" data-act="reload"><span class="mi-ic">${ICONS.refresh}</span>Reload widget</div><div class="ws-item" data-act="perms"><span class="mi-ic">${ICONS.edit}</span>Permissions…</div><hr>`
      : '';
    menu.innerHTML = `${pluginItems}${tintMenuItemHtml()}<hr>${widthMenuItemsHtml(w)}${heightMenuItemsHtml(w)}<hr><div class="ws-item" data-act="remove" data-danger><span class="mi-ic">${ICONS.trash}</span>Delete widget</div>`;
    const close = showDropdown(menu, rect, 200);
    const reloadBtn = menu.querySelector('[data-act=reload]');
    if (reloadBtn) reloadBtn.onclick = () => { close(); reloadPluginWidget(w.id); };
    const permsBtn = menu.querySelector('[data-act=perms]');
    if (permsBtn) permsBtn.onclick = () => { close(); openPluginConsentModal({ manifest: plugin, existing: plugin, mode: 'review' }); };
    wireWidthMenuItems(menu, w, close);
    wireHeightMenuItems(menu, w, close);
    wireTintMenuItem(menu, w, close);
    menu.querySelector('[data-act=remove]').onclick = async () => {
      close();
      destroyPluginInstance(w.id);
      await DB.deleteWidget(w.id);
      await reload();
    };
  }

  /* ---------- consent / install UI ---------- */
  function permissionRowsHtml(manifest, grantedSet) {
    if (!manifest.permissions.length) return `<div class="hint-text">This widget asks for no extra permissions. It can still draw in its own box and reach its own server.</div>`;
    return manifest.permissions.map(p => {
      const info = PP.PERMISSIONS[p];
      return `<label class="plugin-perm risk-${info.risk}">
        <input type="checkbox" data-perm="${escapeHtml(p)}"${grantedSet.has(p) ? ' checked' : ''}>
        <span><b>${escapeHtml(info.label)}</b><span class="plugin-perm-desc">${escapeHtml(info.description)}</span></span>
      </label>`;
    }).join('');
  }

  /* mode 'install': manifest is new (or an update); mode 'review': change the
     grants of an installed plugin (also how an imported plugin gets approved). */
  function openPluginConsentModal({ manifest, existing, mode, addAfter }) {
    const m = manifest;
    const installing = mode === 'install';
    const grantedSet = new Set(installing ? m.permissions : (existing ? existing.granted : []));
    let warn = '';
    if (installing && existing) {
      warn = existing.origin !== m.origin
        ? `<div class="plugin-warn">This replaces the installed “${escapeHtml(existing.name)}” and moves it from <code>${escapeHtml(existing.origin)}</code> to <code>${escapeHtml(m.origin)}</code>.</div>`
        : `<div class="plugin-warn">This updates the installed version (${escapeHtml(existing.version)} → ${escapeHtml(m.version)}).</div>`;
    }
    const html = `
      <h2>${installing ? 'Install widget plugin' : 'Permissions'}</h2>
      <div class="plugin-consent">
        <div class="plugin-consent-head"><strong>${escapeHtml(m.name)}</strong> <span class="plugin-ver">v${escapeHtml(m.version)}</span>${m.dev ? ' <span class="plugin-dev-badge">dev · localhost</span>' : ''}</div>
        ${m.description ? `<div class="plugin-consent-desc">${escapeHtml(m.description)}</div>` : ''}
        <div class="plugin-consent-meta">${m.author ? 'By ' + escapeHtml(m.author) + ' · ' : ''}Loads from <code>${escapeHtml(m.origin)}</code></div>
        ${warn}
        <div class="hint-text">The widget runs in a sandbox: it can’t see your dashboard, bookmarks, tabs or history except through the permissions you allow below. But its code is loaded from its server every time the dashboard opens, so the author can change it later without asking you again, and it can talk to its own server and use CPU while open. Only install widgets from people you trust.</div>
        <div class="plugin-perms">${permissionRowsHtml(m, grantedSet)}</div>
      </div>
      <div class="modal-actions">
        <button type="button" class="mini-btn" id="pc-cancel">Cancel</button>
        <button type="button" class="primary-btn" id="pc-ok">${installing ? 'Install' : 'Save'}</button>
      </div>`;
    openModal(html, () => {
      $('#pc-cancel').onclick = closeModal;
      $('#pc-ok').onclick = async () => {
        const granted = $$('.plugin-perms input[data-perm]').filter(i => i.checked).map(i => i.dataset.perm);
        if (installing) {
          await DB.installPlugin(m, granted);
          await reload();
          closeModal();
          renderPluginSettings();
          if (addAfter) await addPluginWidget(m.id);
          else toast(`${m.name} installed — add it from the “Add widget” menu`);
        } else {
          await DB.setPluginGrants(m.id, granted);
          await reload();
          closeModal();
          renderPluginSettings();
          toast('Permissions updated');
        }
      };
    }, 'plugin-modal');
  }

  async function fetchPluginManifest(url) {
    const entry = PP.parseEntryUrl(url);
    if (!entry.ok) throw new Error(entry.error.replace('entry', 'manifest URL'));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(entry.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error('The server answered ' + res.status);
      const text = await res.text();
      if (text.length > PP.LIMITS.manifestBytes) throw new Error('Manifest is too large');
      return { json: JSON.parse(text), baseUrl: entry.url };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Timed out fetching the manifest');
      if (e instanceof SyntaxError) throw new Error('The manifest isn’t valid JSON');
      if (e instanceof TypeError) throw new Error('Couldn’t fetch it (the server must allow cross-origin requests). Paste the manifest JSON instead.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  function openPluginInstallModal(opts) {
    const addAfter = !!(opts && opts.addAfter);
    const html = `
      <h2>Install widget plugin</h2>
      <p class="dialog-message">Widgets are small web pages made by other people. They run sandboxed, and you choose what each one may access.</p>
      <div class="field"><label for="pi-url">Manifest URL</label><input type="text" id="pi-url" placeholder="https://example.com/my-widget/manifest.json" spellcheck="false"></div>
      <div class="field"><label for="pi-json">…or paste the manifest JSON</label><textarea id="pi-json" rows="8" spellcheck="false" placeholder='{ "id": "com.example.widget", "name": "…", "version": "1.0.0", "entry": "https://…" }'></textarea></div>
      <div class="plugin-error" id="pi-error" role="alert"></div>
      <div class="modal-actions">
        <button type="button" class="mini-btn" id="pi-cancel">Cancel</button>
        <button type="button" class="primary-btn" id="pi-next">Continue</button>
      </div>`;
    openModal(html, () => {
      const errEl = $('#pi-error');
      const next = $('#pi-next');
      $('#pi-cancel').onclick = closeModal;
      $('#pi-url').focus();
      next.onclick = async () => {
        errEl.textContent = '';
        next.disabled = true;
        try {
          const url = $('#pi-url').value.trim();
          const pasted = $('#pi-json').value.trim();
          let json, baseUrl = null;
          if (url) ({ json, baseUrl } = await fetchPluginManifest(url));
          else if (pasted) {
            if (pasted.length > PP.LIMITS.manifestBytes) throw new Error('Manifest is too large');
            try { json = JSON.parse(pasted); } catch (e) { throw new Error('That isn’t valid JSON'); }
          } else throw new Error('Enter a manifest URL or paste the manifest JSON');
          const v = PP.validateManifest(json, { baseUrl });
          if (!v.ok) throw new Error(v.errors.join('\n'));
          const existing = installedPlugins()[v.manifest.id] || null;
          openPluginConsentModal({ manifest: v.manifest, existing, mode: 'install', addAfter });
        } catch (e) {
          errEl.textContent = e.message;
        } finally { next.disabled = false; }
      };
    }, 'plugin-modal');
  }

  async function addPluginWidget(pluginId) {
    const plugin = installedPlugins()[pluginId];
    if (!plugin) { toast('That plugin isn’t installed'); return; }
    if (!plugin.approved) { openPluginConsentModal({ manifest: plugin, existing: plugin, mode: 'review' }); return; }
    await DB.createWidget(activeWorkspaceId(), 'plugin', { pluginId, span: plugin.defaultSpan, rowSpan: plugin.defaultRowSpan });
    await reload();
    toast(`${plugin.name} added`);
  }

  /* ---------- entry points used by other modules ---------- */
  function pluginAddMenuHtml() {
    const list = Object.values(installedPlugins()).sort((a, b) => a.name.localeCompare(b.name));
    return '<hr>' + list.map(p => `<div class="ws-item" data-plugin="${escapeHtml(p.id)}"><span class="mi-ic">${ICONS.widget}</span>${escapeHtml(p.name)}</div>`).join('') +
      `<div class="ws-item" data-act="plugin-install"><span class="mi-ic">${ICONS.plus}</span>Install plugin…</div>`;
  }
  function pluginPaletteActions() {
    const acts = Object.values(installedPlugins()).map(p => ({ kind: 'action', label: `Add ${p.name} widget`, run: () => addPluginWidget(p.id) }));
    acts.push({ kind: 'action', label: 'Install widget plugin…', run: () => openPluginInstallModal({ addAfter: true }) });
    return acts;
  }

  function renderPluginSettings() {
    const host = $('#plugin-list');
    if (!host) return;
    const list = Object.values(installedPlugins()).sort((a, b) => a.name.localeCompare(b.name));
    host.textContent = '';
    if (!list.length) {
      const empty = el('div', 'hint-text');
      empty.textContent = 'No plugins installed.';
      host.appendChild(empty);
      return;
    }
    for (const p of list) {
      const used = Object.values(STATE.widgets || {}).filter(w => w.type === 'plugin' && w.pluginId === p.id).length;
      const row = el('div', 'plugin-row');
      const info = el('div', 'plugin-row-info');
      const title = el('div', 'plugin-row-title');
      title.textContent = p.name + ' ';
      const ver = el('span', 'plugin-ver'); ver.textContent = 'v' + p.version; title.appendChild(ver);
      if (p.dev) { const b = el('span', 'plugin-dev-badge'); b.textContent = 'dev'; title.appendChild(b); }
      if (!p.approved) { const b = el('span', 'plugin-warn-badge'); b.textContent = 'needs review'; title.appendChild(b); }
      const meta = el('div', 'plugin-row-meta');
      meta.textContent = p.origin + ' · ' + (p.granted.length ? p.granted.map(g => PP.PERMISSIONS[g].label).join(', ') : 'no permissions granted') + ' · ' + used + ' widget' + (used === 1 ? '' : 's');
      info.appendChild(title); info.appendChild(meta);
      const actions = el('div', 'plugin-row-actions');
      const perms = el('button', 'mini-btn'); perms.type = 'button'; perms.textContent = p.approved ? 'Permissions' : 'Review';
      perms.onclick = () => openPluginConsentModal({ manifest: p, existing: p, mode: 'review' });
      const rm = el('button', 'mini-btn danger'); rm.type = 'button'; rm.textContent = 'Remove';
      rm.onclick = async () => {
        const msg = used ? `Remove “${p.name}” and its ${used} widget${used === 1 ? '' : 's'}? Data the widget saved will be deleted.` : `Remove “${p.name}”?`;
        if (!(await uiConfirm(msg, { title: 'Remove plugin', danger: true, okLabel: 'Remove' }))) return;
        for (const w of Object.values(STATE.widgets || {})) if (w.type === 'plugin' && w.pluginId === p.id) destroyPluginInstance(w.id);
        await DB.removePlugin(p.id);
        await reload();
        renderPluginSettings();
      };
      actions.appendChild(perms); actions.appendChild(rm);
      row.appendChild(info); row.appendChild(actions);
      host.appendChild(row);
    }
  }

  /* ---------- init (called once from dashboard.js) ---------- */
  function initPlugins() {
    window.addEventListener('message', onPluginWindowMessage);

    // Destroy instances whose card left the board (workspace switch, delete,
    // filter). A card that was merely moved is still connected → keep it.
    const board = $('#board');
    if (board) {
      new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.removedNodes) {
          const id = n && n.dataset && n.dataset.widgetId;
          if (!id) continue;
          const inst = pluginInstances.get(id);
          if (inst && inst.card === n && !n.isConnected) destroyPluginInstance(id);
        }
      }).observe(board, { childList: true });
    }

    if (typeof ResizeObserver !== 'undefined') {
      let raf = 0; const pending = new Set();
      pluginResizeObserver = new ResizeObserver((entries) => {
        for (const en of entries) pending.add(en.target);
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          for (const f of pending) {
            const inst = instanceForFrame(f);
            if (inst && inst.connected) { const r = f.getBoundingClientRect(); pluginPush(inst, 'resize', { width: Math.round(r.width), height: Math.round(r.height) }); }
          }
          pending.clear();
        });
      });
    }
    if (typeof IntersectionObserver !== 'undefined') {
      pluginVisibilityObserver = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const inst = instanceForFrame(en.target);
          if (!inst) continue;
          inst.visible = en.isIntersecting;
          if (inst.connected) recomputePluginVisibility(inst);
        }
      });
    }
    document.addEventListener('visibilitychange', () => {
      for (const inst of pluginInstances.values()) if (inst.connected) recomputePluginVisibility(inst);
      if (document.hidden) for (const inst of pluginInstances.values()) flushPluginData(inst);
    });
    window.addEventListener('pagehide', () => { for (const inst of pluginInstances.values()) flushPluginData(inst); });

    // Theme changes arrive as inline-style / class mutations on <html>.
    let themeTimer = 0;
    new MutationObserver(() => {
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => {
        const theme = currentPluginTheme();
        const json = JSON.stringify(theme);
        if (json === pluginThemeJson) return;
        pluginThemeJson = json;
        for (const inst of pluginInstances.values()) if (inst.connected) pluginPush(inst, 'theme', theme);
      }, 80);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

    // A cross-origin iframe swallows pointer events, which would kill drag /
    // drop and the resize handle whenever the cursor crosses a plugin card.
    // While any press that started in the dashboard is active, frames go
    // click-through (CSS: html.tb-gesture .plugin-frame).
    const root = document.documentElement;
    document.addEventListener('mousedown', () => root.classList.add('tb-gesture'), true);
    for (const ev of ['mouseup', 'dragend', 'drop', 'pointercancel', 'blur']) {
      window.addEventListener(ev, () => root.classList.remove('tb-gesture'), true);
    }

    const installBtn = $('#plugin-install-btn');
    if (installBtn) installBtn.onclick = () => openPluginInstallModal();
    renderPluginSettings();
  }
