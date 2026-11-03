/* TabsBoard — new-tab app (v3: widget board) */
  // Global `escapeHtml()` (used throughout this file and the split modules) is
  // defined by common/search.js's SearchUtils and common/storage.js; plain
  // classic scripts share one global scope, so all bare calls resolve to it.

  const DB = TabsDB;
  const ICONS = (typeof self !== 'undefined' && self.ICONS) ? self.ICONS : {};
  const Themes = (typeof self !== 'undefined' && self.Themes) ? self.Themes : null;
  const CU = (typeof self !== 'undefined' && self.ColorUtils) ? self.ColorUtils : null;

  // Safety net: the page stays hidden (see html { visibility: hidden } in
  // the stylesheet) until applySettings() reveals it with the real theme
  // already in place. If something throws before that ever runs, don't
  // leave the user staring at a blank tab forever.
  setTimeout(() => document.documentElement.classList.add('theme-ready'), 1200);

  let STATE = null;
  /* Which workspace's settings are currently painted. Every workspace has its
     own settings, so switching workspace has to re-apply them (see reload()). */
  let appliedWorkspaceId = null;
  let openDropdownMenus = new Set();
  let OPEN_TABS = [];
  let SELECTED = new Set();
  let selectMode = false;
  let SELECTED_TABS = new Set();
  let draggedTab = null;
  let bmDropIndicator = null;
  let currentNav = 'collections'; // 'collections' | 'sessions'
  let sidebarShowingClosed = false; // false = Open Tabs, true = Recently Closed (single toggle, not a tab component)

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const icon = (name, cls) => `<span class="icon ${cls || ''}">${ICONS[name] || ''}</span>`;

  /* ---------- Keyboard shortcut labels ----------
     One source of truth for the help dialog, button tooltips, and the palette
     hint. Mac users get the symbols their keyboards actually show; everyone
     else gets Ctrl/Shift/Alt words. */
  const IS_MAC = /Mac|iPhone|iPad|iPod/.test(
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform || navigator.userAgent || ''
  );
  const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
  const SHIFT_KEY = IS_MAC ? '⇧' : 'Shift';
  const SHORTCUTS = {
    palette: [MOD_KEY, 'K'],
    paletteAlt: ['/'],
    quickAdd: [MOD_KEY, SHIFT_KEY, 'A'],
    sidebar: ['T'],
    compactSidebar: [SHIFT_KEY, 'C'],
    newCollection: ['C'],
    viewMode: ['V'],
    nextBoard: ['B'],
    prevBoard: [SHIFT_KEY, 'B'],
    nextWorkspace: ['W'],
    prevWorkspace: [SHIFT_KEY, 'W'],
    settings: ['S'],
    trash: ['G'],
    help: ['?'],
    escape: ['Esc']
  };
  /* Rows in the shortcuts dialog: label + one or more key combinations. */
  const SHORTCUT_HELP = [
    ['Command palette', [SHORTCUTS.palette, SHORTCUTS.paletteAlt]],
    ['New collection', [SHORTCUTS.newCollection]],
    ['Toggle sidebar', [SHORTCUTS.sidebar]],
    ['Toggle compact sidebar', [SHORTCUTS.compactSidebar]],
    ['Toggle grid / list view', [SHORTCUTS.viewMode]],
    ['Next board', [SHORTCUTS.nextBoard]],
    ['Previous board', [SHORTCUTS.prevBoard]],
    ['Next workspace', [SHORTCUTS.nextWorkspace]],
    ['Previous workspace', [SHORTCUTS.prevWorkspace]],
    ['Open settings', [SHORTCUTS.settings]],
    ['Open trash', [SHORTCUTS.trash]],
    ['Show shortcuts', [SHORTCUTS.help]],
    ['Close dialogs / clear selection', [SHORTCUTS.escape]]
  ];
  function shortcutText(combos) {
    return combos.map(keys => keys.join(IS_MAC ? '' : '+')).join(' or ');
  }
  function shortcutTitle(label, combos) { return `${label} (${shortcutText(combos)})`; }
  /* aria-keyshortcuts uses long key names and accepts alternatives separated by spaces. */
  function shortcutAria(combos) {
    const names = { '⌘': 'Meta', '⇧': 'Shift', '⌥': 'Alt', 'Ctrl': 'Control', 'Esc': 'Escape' };
    return combos.map(keys => keys.map(k => names[k] || k).join('+')).join(' ');
  }
  /* Keycap markup for the shortcuts dialog, e.g. [Ctrl][K] or [/]. */
  function shortcutKeysHtml(combos) {
    return combos.map(keys => keys.map(k => `<kbd>${escapeHtml(k)}</kbd>`).join(IS_MAC ? '' : '<span class="shortcut-sep">+</span>'))
      .join('<span class="shortcut-or">or</span>');
  }
  function setShortcutHint(selector, label, combos) {
    const node = $(selector);
    if (!node) return;
    node.title = shortcutTitle(label, combos);
    node.setAttribute('aria-keyshortcuts', shortcutAria(combos));
  }
  function applyShortcutHints(s) {
    setShortcutHint('#search-trigger', 'Command palette', [SHORTCUTS.palette, SHORTCUTS.paletteAlt]);
    setShortcutHint('#sidebar-toggle-btn', 'Toggle sidebar', [SHORTCUTS.sidebar]);
    setShortcutHint('#workspace-btn', 'Switch workspace', [SHORTCUTS.nextWorkspace, SHORTCUTS.prevWorkspace]);
    setShortcutHint('#board-switcher-btn', 'Switch board', [SHORTCUTS.nextBoard, SHORTCUTS.prevBoard]);
    setShortcutHint('#new-collection-btn', 'New collection', [SHORTCUTS.newCollection]);
    setShortcutHint('#shortcuts-btn', 'Keyboard shortcuts', [SHORTCUTS.help]);
    setShortcutHint('#trash-btn', 'Open trash', [SHORTCUTS.trash]);
    setShortcutHint('#settings-btn', 'Settings', [SHORTCUTS.settings]);
    const compactBtn = $('#sidebar-compact-btn');
    if (compactBtn) {
      setShortcutHint('#sidebar-compact-btn', s.sidebarCompact ? 'Exit compact sidebar' : 'Use compact sidebar', [SHORTCUTS.compactSidebar]);
    }
    setShortcutHint('#settings-close-x', 'Close settings', [SHORTCUTS.escape]);
    setShortcutHint('#shortcuts-close-x', 'Close shortcuts', [SHORTCUTS.escape]);
    setShortcutHint('#trash-close-btn', 'Close trash', [SHORTCUTS.escape]);
    const searchKbd = $('#search-shortcut-kbd');
    if (searchKbd) searchKbd.textContent = shortcutText([SHORTCUTS.palette]);
  }

  function sendMsg(type, payload = {}) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
  }

  /* ---------- Toasts ----------
     toast(message)                                   plain notice
     toast(message, 'View trash', fn)                 with an action button (legacy form)
     toast(message, { type, action:{label,fn}, sticky, duration })
     Returns a handle { update(message, opts), dismiss() } so a long task can show
     progress in ONE toast and finish it as success/error instead of stacking.
     Types: success | error | warning | info | loading — inferred from the wording
     when not given, so older call sites pick sensible styling for free. Text is
     always set as text (never HTML), so names with markup in them can't inject. */
  const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11v6M12 7h.01"/></svg>',
    loading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>'
  };
  /* Which toasts the user wants to see (Settings → Notifications → In-app). */
  function toastAllowed(type, hasAction, level) {
    if (level === 'off') return false;
    if (level === 'errors') return type === 'error';
    if (level === 'important') return type === 'error' || type === 'warning' || type === 'loading' || hasAction;
    return true;
  }
  /* Position / size / progress bar / icons live on the region as data
     attributes so CSS does the rest; re-applied whenever settings change. */
  function applyToastRegionPrefs() {
    const region = $('#toast-region');
    if (!region || !STATE) return;
    const n = DB.notificationSettings(DB.settingsOf(STATE));
    region.dataset.pos = n.toastPosition;
    region.dataset.size = n.toastSize;
    region.dataset.progress = n.toastProgress ? 'on' : 'off';
    region.dataset.icons = n.toastIcons ? 'on' : 'off';
  }
  const TOAST_ERR_RE = /couldn'?t|could not|can'?t |cannot|failed|invalid|not supported|not granted|unavailable|too long|is required|only your own|delete one first|unreachable|cancelled/i;
  const TOAST_OK_RE = /\b(copied|saved|added|created|moved|merged|deleted|removed|imported|restored|synced|duplicated|cleared|emptied|refreshed|refetched|opened|unloaded|forgot|sorted|updated|bookmarked)\b|theme set to|up to date/i;
  function inferToastType(text) {
    if (/…$/.test(text)) return 'loading';
    if (TOAST_ERR_RE.test(text)) return 'error';
    if (TOAST_OK_RE.test(text)) return 'success';
    return 'info';
  }
  function toast(text, a, b) {
    const region = $('#toast-region');
    const opts = (a && typeof a === 'object') ? a : { action: a ? { label: a, fn: b } : null };
    let msg = String(text == null ? '' : text);
    const ncfg = DB.notificationSettings(STATE ? DB.settingsOf(STATE) : null);
    applyToastRegionPrefs();

    // Filtered out by the user's level. A suppressed toast still hands back a
    // working handle: if a long task's final state (e.g. an error) is allowed,
    // update() raises a real toast for it.
    if (!toastAllowed(opts.type || inferToastType(msg), !!opts.action, ncfg.toastLevel)) {
      return {
        _real: null,
        update(nextText, nextOpts) {
          if (this._real) return this._real.update(nextText, nextOpts);
          const o = nextOpts || {};
          const nt = String(nextText == null ? '' : nextText);
          if (toastAllowed(o.type || inferToastType(nt), !!o.action, ncfg.toastLevel)) this._real = toast(nt, Object.assign({}, o));
        },
        bump() {},
        dismiss() { if (this._real) this._real.dismiss(); }
      };
    }

    // Same message already showing (e.g. clicking "Copy link" repeatedly): count it instead of stacking.
    if (ncfg.toastGroupDuplicates && !opts.action && !opts.sticky) {
      const dup = Array.from(region.children).find(n => n._h && n.dataset.msg === msg && !n.classList.contains('toast-loading') && !n.classList.contains('toast-out'));
      if (dup) { dup._h.bump(); return dup._h; }
    }
    // Keep the stack short: drop the oldest finished toast(s) first.
    const kids = Array.from(region.children).filter(n => !n.classList.contains('toast-out'));
    for (let i = 0; kids.length - i >= ncfg.toastMax; i++) {
      const old = kids.find(n => !n.classList.contains('toast-loading')) || kids[0];
      if (old && old._h) old._h.dismiss();
      kids.splice(kids.indexOf(old), 1);
    }

    const t = el('div', 'toast');
    t.innerHTML = `<span class="toast-ic"></span><div class="toast-msg"></div><span class="toast-count" hidden></span><button type="button" class="toast-action" hidden></button><button type="button" class="toast-close" aria-label="Dismiss notification">${ICONS.close}</button><span class="toast-bar"></span>`;
    const iconEl = t.querySelector('.toast-ic'), msgEl = t.querySelector('.toast-msg'), countEl = t.querySelector('.toast-count');
    const actionEl = t.querySelector('.toast-action'), barEl = t.querySelector('.toast-bar');
    let count = 1, type = '', timer = null, remaining = 0, startedAt = 0, sticky = false, gone = false, actionFn = null;

    const durationFor = () => {
      if (opts.duration) return opts.duration;
      if (ncfg.toastDuration > 0) return ncfg.toastDuration;   // the user's fixed duration
      if (type === 'error') return 7000;
      if (type === 'warning' || actionFn) return 6500;
      return Math.min(6000, 3200 + msg.length * 28);
    };
    const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const arm = (ms) => {
      clearTimer();
      if (sticky || gone) { barEl.style.display = 'none'; return; }
      remaining = ms; startedAt = Date.now();
      barEl.style.display = '';
      barEl.style.animation = 'none'; void barEl.offsetWidth;          // restart the countdown bar
      barEl.style.animation = `toast-progress ${ms}ms linear forwards`;
      barEl.style.animationPlayState = 'running';
      timer = setTimeout(dismiss, ms);
    };
    const pause = () => { if (!timer) return; clearTimer(); remaining -= Date.now() - startedAt; barEl.style.animationPlayState = 'paused'; };
    const resume = () => { if (sticky || gone || timer || remaining <= 0) return; startedAt = Date.now(); barEl.style.animationPlayState = 'running'; timer = setTimeout(dismiss, remaining); };
    function dismiss() {
      if (gone) return;
      gone = true; clearTimer();
      t.classList.add('toast-out');
      setTimeout(() => t.remove(), document.documentElement.classList.contains('no-anim') ? 0 : 170);
    }
    const paint = (nextType, nextText, nextOpts) => {
      type = nextType;
      msgEl.textContent = nextText;
      t.dataset.msg = nextText;
      t.className = 'toast toast-' + type + (gone ? ' toast-out' : '');
      t.setAttribute('role', type === 'error' ? 'alert' : 'status');
      iconEl.innerHTML = TOAST_ICONS[type];
      const act = nextOpts && nextOpts.action;
      actionFn = act ? act.fn : null;
      actionEl.hidden = !act;
      if (act) actionEl.textContent = act.label;
    };

    actionEl.onclick = () => { try { actionFn && actionFn(); } finally { dismiss(); } };
    t.querySelector('.toast-close').onclick = dismiss;
    t.addEventListener('mouseenter', () => { if (ncfg.toastPauseOnHover) pause(); }); t.addEventListener('mouseleave', resume);
    t.addEventListener('focusin', pause); t.addEventListener('focusout', resume);

    sticky = !!opts.sticky || ncfg.toastDuration === -1;   // -1 = stay until dismissed
    paint(opts.type || inferToastType(msg), msg, opts);
    if (type === 'loading' && opts.sticky === undefined) sticky = true;
    arm(durationFor());

    const handle = {
      update(nextText, nextOpts) {
        if (gone) return;
        const o = nextOpts || {};
        const nt = String(nextText == null ? '' : nextText);
        const prevType = type;
        const nType = o.type || (nt !== msg ? inferToastType(nt) : type);
        msg = nt;
        if ('action' in o || o.type) opts.action = o.action; // new state may carry its own action
        paint(nType, nt, { action: o.action });
        if (o.sticky !== undefined) sticky = !!o.sticky;
        else if (prevType === 'loading' && nType !== 'loading') sticky = ncfg.toastDuration === -1;
        else if (nType === 'loading') sticky = true;
        if (sticky) { clearTimer(); barEl.style.display = 'none'; } else if (!timer) arm(o.duration || durationFor());
      },
      bump() {
        count++;
        countEl.hidden = false; countEl.textContent = '×' + count;
        t.classList.remove('toast-bump'); void t.offsetWidth; t.classList.add('toast-bump');
        arm(durationFor());
      },
      dismiss
    };
    t._h = handle;
    region.appendChild(t);
    return handle;
  }

  /* Appends a dropdown-menu (like a .dropdown-menu built by el()) to the
     document, positioned below+left-aligned to the anchor's rect the way
     every menu in this app wants — but clamped so it can never run off the
     right or bottom edge of the window. Menus were getting cut off because
     only the horizontal edge was ever checked; this checks the *actual*
     rendered size (after layout) and flips above the anchor, or slides up,
     whichever keeps the whole menu on screen. Returns a close() function
     and wires the standard "click outside closes it" behavior. */
  function showDropdown(menu, rect, minWidth) {
    // Close any other open dropdown so only one menu is visible at a time.
    openDropdownMenus.forEach(close => { try { close(); } catch (e) {} });
    openDropdownMenus.clear();
    minWidth = minWidth || 220;
    menu.style.visibility = 'hidden';
    menu.style.top = '0px';
    menu.style.left = Math.min(rect.left, window.innerWidth - minWidth - 8) + 'px';
    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    // Choose whichever side of the anchor has more usable vertical space,
    // preferring below on a tie. This way a menu anchored near the bottom of
    // the page flips above and can still use the full space above — instead of
    // getting a tiny sliver — while a normal menu just fills all the room
    // below it. Either way the menu is clamped to the viewport so nothing
    // overflows past the screen edge.
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 8;
    let top, avail;
    if (spaceBelow >= spaceAbove && spaceBelow >= 80) {
      top = rect.bottom + 4;
      avail = window.innerHeight - top - 8;
    } else if (spaceAbove >= 80) {
      // Anchor right above the widget (its bottom edge just clears the
      // anchor's top) instead of at the page top, so a dropdown for a
      // bottom-of-page widget stays visually attached to it. maxHeight still
      // allows it to grow upward, clamped so it can't go off the top.
      top = Math.max(8, rect.top - menuRect.height - 4);
      avail = rect.top - top - 4;
    } else {
      top = rect.bottom + 4;
      avail = Math.max(spaceBelow, spaceAbove, 80);
    }
    menu.style.maxHeight = Math.max(80, avail) + 'px';
    let left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
    left = Math.max(8, left);
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.visibility = 'visible';

    const close = () => { menu.remove(); openDropdownMenus.delete(close); };
    openDropdownMenus.add(close);
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return close;
  }

  function activeWorkspaceId() { return STATE.meta.activeWorkspaceId; }
  function collectionsForActiveWS() {
    const list = Object.values(STATE.collections).filter(c => c.workspaceId === activeWorkspaceId());
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }
  function activeBoardId() {
    const ws = STATE.workspaces[activeWorkspaceId()];
    if (ws && ws.activeBoardId && STATE.boards[ws.activeBoardId]) return ws.activeBoardId;
    const fallback = boardsForActiveWS()[0];
    return fallback ? fallback.id : null;
  }
  function boardsForActiveWS() {
    return Object.values(STATE.boards || {}).filter(b => b.workspaceId === activeWorkspaceId()).sort((a, b) => a.order - b.order);
  }
  function widgetsForActiveWS() {
    const bid = activeBoardId();
    const list = Object.values(STATE.widgets || {}).filter(w => w.boardId === bid);
    // Defensive: a collection-type widget whose collection got deleted
    // some other way shouldn't render or crash the board.
    return list.filter(w => w.type !== 'collection' || STATE.collections[w.collectionId])
      .sort((a, b) => a.order - b.order);
  }
  function bookmarksForCollection(colId) {
    const list = Object.values(STATE.bookmarks).filter(b => b.collectionId === colId);
    list.sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));
    return list;
  }
  function sessionsForActiveWS() {
    return Object.values(STATE.sessions).filter(s => s.workspaceId === activeWorkspaceId()).sort((a, b) => b.createdAt - a.createdAt);
  }
  /* Best icon src for a page right now (cached copy if we have one, else a
     provider URL, else a generated letter tile). Never empty, never broken. */
  function faviconFor(url, stored) { return Favicons.src(url, stored); }
  /* Ready-made <img> markup with the cache + fallback chain wired in. */
  function favImg(pageUrl, stored, cls) { return Favicons.img(pageUrl, stored, cls); }

  /* Fuzzy matcher for the command palette: query characters must appear in
     order in the target (not necessarily adjacent), so "gcal" matches "Google
     Calendar" and skipped letters still find things. Returns null when the
     query isn't a subsequence, or { score, indices } — indices are the matched
     character positions so the palette can highlight them. Ranking rewards:
     matches at word boundaries (start of string, after spaces/-_/. etc.),
     camelCase humps (S -> SearchBox), consecutive runs, exact-case alignment,
     and a query that is a prefix/full match of the target; each skipped
     character in the middle of a match and a long lead-in cost points. */

  async function addBookmarkSmart(collectionId, wsId, data) {
    const created = await DB.createBookmark(collectionId, wsId, data);
    await reload();
    return created;
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'New Collection'; }
  }
  /* ============ INIT ============ */
  async function boot() {
    STATE = await DB.getState();
    await Favicons.init(DB.settingsOf(STATE).faviconSource);
    // Previews for bookmarks that are gone (and not restorable from the trash) are dead weight.
    { const trashed = JSON.stringify(STATE.trash || {}); Thumbs.gc(id => !!STATE.bookmarks[id] || trashed.includes(id)); }
    // The sidebar HTML starts in the open state; settings may pivot it to
    // compact/collapsed in applySettings(), which would transition from the
    // open width on first load. Suppress sidebar transitions until the first
    // fully-rendered frame has painted, and keep the page hidden (applySettings
    // with reveal=false) so settings and the first board/sidebar render hit the
    // screen at the same time.
    document.documentElement.classList.add('boot-no-sidebar-anim');
    injectStaticIcons();
    applySettings(false);
    initPlugins(); // before the first render so frames created by it get observed
    await refreshOpenTabs();
    renderAll();
    document.documentElement.classList.add('theme-ready');
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('boot-no-sidebar-anim')));
    refreshRecentlyClosed().then(() => { if (sidebarShowingClosed) renderSidebar(); });
    wireGlobalEvents();
    const verEl = $('#app-version');
    if (verEl && chrome.runtime && chrome.runtime.getManifest) verEl.textContent = 'v' + (chrome.runtime.getManifest().version || '');
    handleDeepLink();
    // Storage lives in IndexedDB now; DB.onChange fires (in every open
    // dashboard and the background) after any committed write.
    DB.onChange(async () => {
      STATE = await DB.getState();
      Favicons.setSource(DB.settingsOf(STATE).faviconSource);
      scheduleRender();
      applySettings();
      // A change made elsewhere (another tab, the palette, a workspace switch)
      // while Settings is open: keep its controls and the workspace picker honest.
      if (!$('#settings-overlay').classList.contains('hidden') && !themeBuilder) { renderThemeGrids(); syncSettingsUI(); }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'TOGGLE_SIDEBAR_REQUEST') toggleSidebar();
      // Background pushes this whenever tabs/windows/sessions change, so
      // the Open Tabs / Recently Closed sidebar is fresh without waiting
      // for the periodic poll.
      if (msg && msg.type === 'TABS_CHANGED') {
        (async () => {
          await refreshOpenTabs();
          if (sidebarShowingClosed) await refreshRecentlyClosed();
          renderSidebar();
        })();
      }
      // Background pushes this whenever the browser's download list changes,
      // so the downloads widget mirrors it live without any polling timer. We
      // re-render only when a downloads card is actually on the active board.
      if (msg && msg.type === 'DOWNLOADS_CHANGED' && currentNav === 'collections' &&
        widgetsForActiveWS().some(w => w.type === 'downloads')) {
        renderBoard();
      }
    });
    // When the theme is "auto", follow the OS light/dark switch live —
    // no reload needed.
    if (window.matchMedia) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (DB.settingsOf(STATE).themeId === 'auto') { applySettings(); syncSettingsUI(); }
      });
    }
    setInterval(updateClockWidgets, 1000 * 30);
    setInterval(runRssAutoRefresh, 60000);
    ensureLiveTick();
  }

  async function reload() {
    STATE = await DB.getState();
    Favicons.setSource(DB.settingsOf(STATE).faviconSource);
    // A different workspace has different settings: repaint them together with
    // the new board, rather than a beat later when the storage event arrives.
    if (STATE.meta.activeWorkspaceId !== appliedWorkspaceId) applySettings();
    scheduleRender();
  }

  /* Coalesces full re-renders. Every storage write fires storage.onChanged
     here, and most actions *also* call reload() — without this, each user
     click/live-sync burst would rebuild the whole board twice in a row.
     All renders funnel through scheduleRender(), so anything that lands in
     the same task collapses into a single pass. */
  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    Promise.resolve().then(() => {
      renderScheduled = false;
      renderAll();
    });
  }

  /* Deep links from the omnibox (and elsewhere): "#view=sessions" jumps to
     the Sessions view; "#col=<id>" jumps to the board tab for that
     collection widget and flashes it. */
  function handleDeepLink() {
    const hash = location.hash || '';
    if (hash.indexOf('view=sessions') !== -1) switchNav('sessions');
    const colId = (hash.match(/col=([^&]+)/) || [])[1];
    if (!colId) return;
    const wid = Object.values(STATE.widgets).filter(w => w.type === 'collection' && w.collectionId === colId)[0];
    if (!wid) return;
    splitSelectWidget(wid.id);
    switchNav('collections');
    requestAnimationFrame(() => {
      const card = document.querySelector(`.widget[data-widget-id="${wid.id}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1600);
    });
  }

  async function refreshOpenTabs() {
    const res = await sendMsg('GET_OPEN_TABS');
    OPEN_TABS = (res && res.tabs) || [];
  }

  let RECENTLY_CLOSED = [];
  async function refreshRecentlyClosed() {
    const limit = Number(DB.settingsOf(STATE).recentlyClosedLimit || 0);
    // A slow/stuck sessions API must never block the sidebar — bail out.
    // (10s: Firefox can be slow walking a large session backlog, and the
    // background now always answers, so only a dead background gets dropped.)
    const res = await Promise.race([
      sendMsg('GET_RECENTLY_CLOSED', { limit }),
      new Promise(resolve => setTimeout(() => resolve(null), 10000))
    ]);
    RECENTLY_CLOSED = ((res && res.items) || []);
    if (limit > 0) RECENTLY_CLOSED = RECENTLY_CLOSED.slice(0, limit);
  }

  function renderAll() {
    renderWorkspaceBar();
    renderSidebar();
    updateTrashBadge();
    if (currentNav === 'collections') renderBoard();
    else renderSessionsPage();
  }

  /* ============ STATIC ICON INJECTION (buttons whose icon never changes) ============ */
  function injectStaticIcons() {
    $('#sidebar-toggle-btn').innerHTML = icon('panelLeftClose');
    $('#nav-collections-btn .nav-ic').innerHTML = ICONS.layers;
    $('#nav-sessions-btn .nav-ic').innerHTML = ICONS.briefcase;
    $('#search-trigger .search-ic').innerHTML = ICONS.search;
    $('#shortcuts-btn').innerHTML = icon('keyboard');
    $('#trash-btn').prepend(el('span', 'icon', ICONS.trash));
    $('#settings-btn').innerHTML = icon('settings');
    $('#sidebar-compact-btn').innerHTML = icon('panelLeftClose', 'sm');
    $('#sidebar-closed-toggle').innerHTML = icon('rotateCcwClock', 'sm');
    $('#new-collection-btn .btn-ic').innerHTML = ICONS.plus;
    $('#add-widget-btn .btn-ic-sm').innerHTML = ICONS.widget;
    $('#save-window-session-btn .btn-ic').innerHTML = ICONS.save;
    $('.workspace-btn .chev-ic').innerHTML = ICONS.chevronDown;
    $('#board-switcher-btn .chev-ic').innerHTML = ICONS.chevronDown;
    $('#settings-close-x').innerHTML = icon('close', 'sm');
    $('#shortcuts-close-x').innerHTML = icon('close', 'sm');
    // Any element can ask for a vendored icon by name, so static markup stays
    // free of inline SVG: <span class="seg-ic" data-icon="grid"></span>
    $$('[data-icon]').forEach(s => { if (ICONS[s.dataset.icon]) s.innerHTML = ICONS[s.dataset.icon]; });
  }

  /* ============ SETTINGS / THEME ============ */
  function applyThemeColors(palette) {
    const r = document.documentElement.style;
    r.setProperty('--bg-color', palette.bg);
    r.setProperty('--main-color', palette.main);
    r.setProperty('--caret-color', palette.caret);
    r.setProperty('--sub-color', palette.sub);
    r.setProperty('--sub-alt-color', palette.subAlt);
    r.setProperty('--text-color', palette.text);
    r.setProperty('--error-color', palette.error);
    r.setProperty('--error-extra-color', palette.errorExtra);
    r.setProperty('--colorful-error-color', palette.colorfulError);
    r.setProperty('--colorful-error-extra-color', palette.colorfulErrorExtra);
    // Fallback favicon tiles bake the accent colour into a data: URI, so rebuild them.
    if (self.Favicons) Favicons.refreshTheme();
  }

  /* Live theme preview (MonkeyType-style): pointing at / arrowing onto a theme
     in the command palette or theme picker applies it instantly without
     saving. Choosing it commits; leaving without choosing reverts. */
  let themePreviewing = false;
  function previewTheme(themeId) {
    if (!themeId) return;
    const s = DB.settingsOf(STATE);
    previewPalette(Themes.resolveTheme(themeId, s.lightThemeId, s.darkThemeId, s.customThemes));
  }
  /* Same, but straight from a palette object — the theme builder previews the
     colors it is editing before the theme has an id to be looked up by. */
  function previewPalette(palette) {
    if (!palette) return;
    themePreviewing = true;
    applyThemeColors(palette);
  }
  function commitThemePreview() { themePreviewing = false; }
  function endThemePreview() {
    if (!themePreviewing) return;
    themePreviewing = false;
    applySettings();
  }

  function applySettings(reveal = true) {
    const s = DB.settingsOf(STATE);
    const switchedWorkspace = appliedWorkspaceId !== null && appliedWorkspaceId !== STATE.meta.activeWorkspaceId;
    appliedWorkspaceId = STATE.meta.activeWorkspaceId;
    // The sidebar can be collapsed in one workspace and open in the next: jump
    // straight to the new state instead of sliding there.
    if (switchedWorkspace) {
      const root = document.documentElement;
      root.classList.add('boot-no-sidebar-anim');
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('boot-no-sidebar-anim')));
    }
    applyThemeColors(Themes.resolveTheme(s.themeId, s.lightThemeId, s.darkThemeId, s.customThemes));
    applyToastRegionPrefs();
    const r = document.documentElement.style;
    r.setProperty('--board-cols', String((s.dashboard && s.dashboard.columns) || 4));
    const DENSITY_ROW_MIN = { spacious: '224px', comfortable: '200px', compact: '168px', dense: '150px' };
    r.setProperty('--board-row-min', DENSITY_ROW_MIN[s.density] || '200px');
    const opacity = (s.tabsList && s.tabsList.dimInactive) ? (((s.tabsList.inactiveOpacity ?? 55)) / 100) : 1;
    const grayscale = (s.tabsList && s.tabsList.dimInactive && s.tabsList.inactiveGrayscale) ? 'grayscale(85%)' : 'none';
    r.setProperty('--inactive-tab-opacity', String(opacity));
    r.setProperty('--inactive-tab-filter', grayscale);
    /* Dense layers on top of Compact: it only has to describe the extra step,
       so the compact block above stays the single source for both. */
    const density = s.density || 'comfortable';
    document.documentElement.classList.toggle('density-spacious', density === 'spacious');
    document.documentElement.classList.toggle('density-compact', density === 'compact' || density === 'dense');
    document.documentElement.classList.toggle('density-dense', density === 'dense');
    ['radius-sharp', 'radius-rounded', 'radius-extra', 'radius-none'].forEach(c => document.documentElement.classList.toggle(c, s.radius === c.slice(7)));
    document.documentElement.classList.toggle('no-borders', s.borders === false);
    document.documentElement.classList.toggle('floating-bars', !!s.floatingBars);
    applyBoardView(s);
    document.documentElement.classList.toggle('no-anim', s.animations === false);
    document.documentElement.classList.toggle('no-popup-blur', s.popupBlur === false);
    r.setProperty('--fb-zoom', String(((typeof s.interfaceFontSize === 'number' ? s.interfaceFontSize : 100)) / 100));
    const defaultStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    r.setProperty('--fb-font', s.interfaceFont ? `"${s.interfaceFont}", ${defaultStack}` : defaultStack);
    [
      ['#search-trigger', s.showTopbarSearch !== false],
      ['#shortcuts-btn', s.showShortcutsButton !== false],
      ['#trash-btn', s.showTrashButton !== false]
    ].forEach(([selector, visible]) => {
      const elNode = $(selector);
      if (elNode) elNode.classList.toggle('hidden', !visible);
    });
    $('#sidebar').classList.toggle('collapsed', !!s.sidebarCollapsed);
    $('#sidebar').classList.toggle('compact', !!s.sidebarCompact);
    // The sidebar toggle shows the collapse/expand panel icon for the state it
    // switches INTO: panel-left-close while visible, panel-left-open once fully
    // collapsed, while the compact toggle uses plain chevrons for the narrow rail.
    $('#sidebar-toggle-btn').innerHTML = icon(s.sidebarCollapsed ? 'panelLeftOpen' : 'panelLeftClose');
    $('#sidebar-compact-btn').innerHTML = icon(s.sidebarCompact ? 'chevronRight' : 'chevronLeft', 'sm');
    $('#sidebar-compact-btn').setAttribute('aria-pressed', String(!!s.sidebarCompact));
    applyShortcutHints(s);
    // Reveal now that real colors are set — avoids a flash of the light default.
    // boot() passes false so it can first render the board/sidebar (settings
    // and content land together, so the sidebar never shows mid-transition).
    if (reveal) document.documentElement.classList.add('theme-ready');
  }
  /* ============ QUICK TOGGLES ============ */
  async function toggleSidebar() {
    const collapsed = !DB.settingsOf(STATE).sidebarCollapsed;
    await DB.updateSettings({ sidebarCollapsed: collapsed });
    await reload();
  }
  async function toggleSidebarCompact() {
    await DB.updateSettings({ sidebarCompact: !DB.settingsOf(STATE).sidebarCompact });
    await reload();
  }
  async function toggleViewMode() {
    const next = DB.settingsOf(STATE).viewMode === 'grid' ? 'list' : 'grid';
    await DB.updateSettings({ viewMode: next });
    await reload();
  }

  /* ============ GLOBAL EVENTS ============ */
  function wireGlobalEvents() {
    $('#new-collection-btn').onclick = () => openCollectionModal();
    $('#add-widget-btn').onclick = (e) => openAddWidgetMenu(e.currentTarget);
    $('#board-switcher-btn').onclick = (e) => openBoardSwitcherMenu(e.currentTarget);
    $('#search-trigger').onclick = openPalette;
    $('#sidebar-toggle-btn').onclick = toggleSidebar;
    $('#sidebar-compact-btn').onclick = toggleSidebarCompact;
    $('#shortcuts-btn').onclick = openShortcuts;
    $('#shortcuts-close-x').onclick = closeShortcuts;

    $('#trash-btn').onclick = openTrashPanel;
    $('#trash-close-btn').onclick = () => hideOverlay('#trash-overlay');
    $('#empty-trash-btn').onclick = async () => {
      if (!DB.settingsOf(STATE).confirmDelete || await uiConfirm('Permanently delete all items in trash?', { title: 'Empty trash', okLabel: 'Empty trash', danger: true })) {
        await DB.emptyTrash();
        await reload();
        hideOverlay('#trash-overlay');
        toast('Trash emptied');
      }
    };

    $('#workspace-btn').onclick = (e) => { e.stopPropagation(); $('#workspace-menu').classList.toggle('hidden'); };
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#workspace-menu') && !e.target.closest('#workspace-btn')) $('#workspace-menu').classList.add('hidden');
    });

    /* Safety net: an aborted drag (Esc), a drop on empty space, or a drop
       intercepted before dragleave fires can leave hover styling (the dashed
       .drag-over outline) stuck on. Clear it whenever any drag ends. */
    document.addEventListener('dragend', () => {
      document.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
      clearBmDropIndicator();
      $('#open-tabs-list').classList.remove('dragging-open-tab');
      draggedTab = null;
    });

    /* Tabs drag-to-reorder + drag-to-pin on the open-tabs list. Dragging always
       shows the same reorder indicator, wherever the tab lands: within the
       same pin group it reorders, dragging into the other group pins/unpins
       *and* still places the tab at the exact drop position. */
    const rowAfterBoundary = (boundary) => {
      const next = boundary && boundary.nextElementSibling;
      return next && next.classList.contains('tab-row') ? next : null;
    };
    const rowFor = (el) => {
      if (!el) return null;
      const found = OPEN_TABS.find(t => String(t.id) === el.dataset.tabId);
      return found || null;
    };
    const toastErr = (res, prefix) => {
      if (res && !res.ok && res.error) toast(prefix + ': ' + res.error);
    };

    const tabsListEl = $('#open-tabs-list');
    tabsListEl.addEventListener('click', (e) => {
      if (!SELECTED_TABS.size) return;
      if (e.target.closest('.tab-row') || e.target.closest('[data-act]')) return;
      SELECTED_TABS.clear();
      renderSidebar();
    });
    tabsListEl.addEventListener('dragover', (e) => {
      if (!draggedTab) return;
      if (e.dataTransfer.types.indexOf('application/x-tdb-tab') === -1) return;
      if (sidebarShowingClosed) { clearBmDropIndicator(); return; }
      const dropRow = e.target.closest('.tab-row');
      const dropBoundary = dropRow ? null : e.target.closest('.tab-group-boundary');
      if (!dropRow && !dropBoundary) { clearBmDropIndicator(); return; }
      e.preventDefault();
      e.stopPropagation();
      if (dropBoundary) {
        const bRect = dropBoundary.getBoundingClientRect();
        const indicator = showDropIndicator({ clientY: bRect.top - 2 }, dropBoundary, 'list');
        if (indicator) {
          // Land the bar on the boundary's drop line: the divider itself, or —
          // for the empty pin slot — 4px above the hairline so the bar does not
          // read as part of it.
          const isSlot = dropBoundary.classList.contains('is-pin-slot');
          indicator.classList.add('at-boundary');
          indicator.style.setProperty('--drop-shift', `${isSlot ? bRect.height - 6 : bRect.height}px`);
        }
      } else if (rowFor(dropRow)) {
        showDropIndicator(e, dropRow, 'list');
      } else {
        clearBmDropIndicator();
      }
    });

    /* Same-group reorder: tabs.move() interprets `index` on the strip *after*
       the moved tab is removed, so lower the target by one when the drag comes
       from above. */
    const reorderTab = async (dragged, target, before) => {
      const from = OPEN_TABS.find(t => t.id === dragged.id);
      if (!from || !target) return;
      const dIdx = from.index, tIdx = target.index;
      const idx = before
        ? (dIdx < tIdx ? tIdx - 1 : tIdx)
        : (dIdx < tIdx ? tIdx : tIdx + 1);
      if (idx === dIdx) return;
      toastErr(await sendMsg('MOVE_TAB_TO', { tabId: dragged.id, index: idx }), 'Could not reorder tab');
    };

    /* Cross-group drop: flip the pin state (the browser auto-places it at the
       pinned/unpinned edge), then move it to the exact drop position. */
    const pinAndPlace = async (dragged, target, before, wantPin) => {
      toastErr(await sendMsg('TOGGLE_PIN_TAB', { tabId: dragged.id, pinned: wantPin }), 'Could not ' + (wantPin ? 'pin' : 'unpin') + ' tab');
      if (!target) return;
      const tIdx = target.index;
      const pinnedCount = OPEN_TABS.filter(t => t.pinned).length;
      // Where the toggle alone lands the tab: pin→after last pinned,
      // unpin→before first unpinned. Skip the move when that's already the spot.
      const autoIdx = wantPin ? pinnedCount : pinnedCount - 1;
      const idx = wantPin ? (before ? tIdx : tIdx + 1) : (before ? tIdx - 1 : tIdx);
      if (idx === autoIdx) return;
      toastErr(await sendMsg('MOVE_TAB_TO', { tabId: dragged.id, index: idx }), 'Could not reorder tab');
    };

    tabsListEl.addEventListener('drop', async (e) => {
      const tabData = e.dataTransfer.getData('application/x-tdb-tab');
      if (!tabData || sidebarShowingClosed) return;
      const dragged = JSON.parse(tabData);
      const dropRow = e.target.closest('.tab-row');
      const dropBoundary = dropRow ? null : e.target.closest('.tab-group-boundary');
      clearBmDropIndicator();
      if (!dropRow && !dropBoundary) return;
      e.preventDefault();
      e.stopPropagation();
      const refreshAll = async () => { await refreshOpenTabs(); await refreshRecentlyClosed(); renderSidebar(); };
      if (dropRow) {
        const target = rowFor(dropRow);
        if (!target) return;
        const from = OPEN_TABS.find(t => t.id === dragged.id);
        const before = getDropIndex(e, dropRow, 'list') !== 'after';
        if (from && from.pinned === target.pinned) {
          await reorderTab(dragged, target, before);
        } else {
          await pinAndPlace(dragged, target, before, target.pinned);
        }
        await refreshAll();
        return;
      }
      // Group boundary: same group → drop at its top; other group →
      // pin/unpin at that section's edge.
      const edgeRow = rowAfterBoundary(dropBoundary);
      const edgeTarget = edgeRow ? rowFor(edgeRow) : null;
      const from = OPEN_TABS.find(t => t.id === dragged.id);
      const boundaryIsPinned = dropBoundary.dataset.group === 'pinned';
      const sameGroup = from && from.pinned === boundaryIsPinned;
      if (sameGroup) {
        /* With nothing pinned, the strip above the first unpinned tab is still
           the pin slot: dropping an unpinned tab there pins it to the very top
           instead of just reordering. */
        if (!boundaryIsPinned && !OPEN_TABS.some(t => t.pinned)) {
          await pinAndPlace(dragged, null, true, true);
        } else {
          await reorderTab(dragged, edgeTarget, true);
        }
      } else {
        await pinAndPlace(dragged, edgeTarget, true, boundaryIsPinned);
      }
      await refreshAll();
    });

    $('#nav-collections-btn').onclick = () => switchNav('collections');
    $('#nav-sessions-btn').onclick = () => switchNav('sessions');

    $('#sidebar-closed-toggle').onclick = () => {
      if (sidebarShowingClosed) {
        sidebarShowingClosed = false;
        renderSidebar();
      } else {
        sidebarShowingClosed = true;
        refreshRecentlyClosed().then(() => renderSidebar());
      }
    };
    $('#save-window-session-btn').onclick = saveWindowSession;
    $('#save-all-session-btn').onclick = saveAllWindowsSession;

    $('#collection-filter-input').addEventListener('input', (e) => { filterQueryFor.collections = e.target.value; renderBoard(); });
    $('#session-filter-input').addEventListener('input', (e) => { filterQueryFor.sessions = e.target.value; renderSessionsPage(); });

    $('#bulk-move-btn').onclick = async () => {
      const cols = collectionsForActiveWS();
      const pickId = await uiSearchablePicker('Move bookmarks', `Move ${SELECTED.size} bookmark${SELECTED.size === 1 ? '' : 's'} to which collection?`, cols.map((c) => ({ id: c.id, label: c.name })), { okLabel: 'Move', placeholder: 'Search collections…' });
      if (!pickId) return;
      DB.moveBookmarks(Array.from(SELECTED), pickId).then(async () => { SELECTED.clear(); selectMode = false; await reload(); });
    };
    $('#bulk-open-btn').onclick = () => openSelectedBookmarks(false);
    $('#bulk-delete-btn').onclick = () => { if (SELECTED.size) deleteBookmarksWithUndo(Array.from(SELECTED)); };
    $('#bulk-clear-btn').onclick = () => { SELECTED.clear(); selectMode = false; renderBoard(); };

    /* Clicking the blurred backdrop closes any open popup, routing each one
       through its own close function so state/theme previews clean up. */
    registerOverlayCloser('modal-overlay', closeModal);
    registerOverlayCloser('palette-overlay', closePalette);
    registerOverlayCloser('settings-overlay', () => { endThemePreview(); closeSettings(); });
    registerOverlayCloser('trash-overlay', () => hideOverlay('#trash-overlay'));
    registerOverlayCloser('shortcuts-overlay', closeShortcuts);

    wirePalette(); // palette.js: input, keyboard, mouse and crumb handlers

    async function cycleBoards(dir) {
      const boards = boardsForActiveWS();
      if (boards.length < 2) return;
      const curIdx = boards.findIndex(b => b.id === activeBoardId());
      const next = (curIdx + dir + boards.length) % boards.length;
      await jumpToBoard(boards[next].id);
    }

    async function cycleWorkspaces(dir) {
      const wsList = Object.values(STATE.workspaces).sort((a, b) => a.order - b.order);
      if (wsList.length < 2) return;
      const curIdx = wsList.findIndex(w => w.id === activeWorkspaceId());
      const next = (curIdx + dir + wsList.length) % wsList.length;
      await jumpToWorkspace(wsList[next].id);
    }

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const mod = e.metaKey || e.ctrlKey;

      // Modifiers — always active, even inside inputs
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); quickAddCurrentTab(); return; }
      // While bookmarks are being selected: Ctrl/Cmd+A selects every visible one, Enter opens them.
      if (selectMode && currentNav === 'collections' && !document.querySelector('#modal-overlay:not(.hidden), #palette-overlay:not(.hidden), #settings-overlay:not(.hidden)')) {
        const t0 = (document.activeElement && document.activeElement.tagName) || '';
        const typing = t0 === 'INPUT' || t0 === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);
        if (!typing && mod && !e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllVisibleBookmarks(); return; }
        if (!typing && !mod && e.key === 'Enter' && SELECTED.size) { e.preventDefault(); openSelectedBookmarks(e.shiftKey); return; }
      }
      if (e.key === 'Escape') {
        closePalette();
        hideOverlay('#modal-overlay');
        closeSettings();
        hideOverlay('#trash-overlay');
        hideOverlay('#shortcuts-overlay');
        if (SELECTED.size) { SELECTED.clear(); selectMode = false; renderBoard(); }
        if (SELECTED_TABS.size) { SELECTED_TABS.clear(); renderSidebar(); }
        // Escape also leaves any text field that still has focus (filter boxes,
        // add-item inputs, notes) so single-key shortcuts work again.
        { const ae = document.activeElement; if (ae && ae !== document.body && ae.matches && ae.matches('input:not([type=checkbox]):not([type=radio]), textarea')) ae.blur(); }
        return;
      }

      // Single-key shortcuts — skip when typing in inputs
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser/OS chords aren't app shortcuts
      const k = e.key.toLowerCase();
      const overlayOpen = $$('.overlay').some(o => !o.classList.contains('hidden'));

      // G is the one shortcut that can act while its own panel is open (it closes the trash).
      if (k === 'g' && !e.shiftKey) {
        if (!$('#trash-overlay').classList.contains('hidden')) { hideOverlay('#trash-overlay'); closePalette(); return; }
        if (!overlayOpen) openTrashPanel();
        return;
      }
      if (overlayOpen) return;

      if (e.shiftKey && k === 'c') { toggleSidebarCompact(); return; }
      if (!e.shiftKey && k === 'c') openCollectionModal();
      else if (!e.shiftKey && k === 'v') toggleViewMode();
      else if (!e.shiftKey && k === 't') toggleSidebar();
      else if (!e.shiftKey && k === 's') openSettings();
      else if (k === '/') openPalette();
      else if (k === '?') openShortcuts();
      else if (k === 'w' && !e.shiftKey) cycleWorkspaces(1);   // next workspace
      else if (k === 'w' && e.shiftKey) cycleWorkspaces(-1);  // prev workspace
      else if (k === 'b' && !e.shiftKey) cycleBoards(1);      // next board
      else if (k === 'b' && e.shiftKey) cycleBoards(-1);      // prev board
    });

    // No polling intervals: the background pushes TABS_CHANGED on every
    // tab/window/session event and DOWNLOADS_CHANGED when the browser's
    // download list changes, so the sidebar and downloads widget stay live
    // without timers.

    wireSettingsPanel();
    wireBoardViews();
  }

  async function quickAddCurrentTab() {
    const res = await sendMsg('GET_OPEN_TABS');
    const tab = (res.tabs || []).find(t => t.active) || (res.tabs || [])[0];
    if (!tab) return;
    const cols = collectionsForActiveWS();
    if (!cols.length) { toast('Create a collection first'); return; }
    const created = await addBookmarkSmart(cols[0].id, activeWorkspaceId(), { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
    if (created) toast(`Added "${tab.title}" to "${cols[0].name}"`);
  }


  document.addEventListener('DOMContentLoaded', boot);
