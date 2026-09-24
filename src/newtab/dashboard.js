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

  function sendMsg(type, payload = {}) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
  }

  function toast(text, actionLabel, actionFn) {
    const region = $('#toast-region');
    const t = el('div', 'toast');
    t.innerHTML = `<span>${text}</span>`;
    const dismiss = () => { t.classList.add('toast-out'); setTimeout(() => t.remove(), 160); };
    const auto = setTimeout(dismiss, 5000);
    if (actionLabel) {
      const b = el('button', '', actionLabel);
      b.onclick = () => { clearTimeout(auto); actionFn && actionFn(); t.remove(); };
      t.appendChild(b);
    }
    region.appendChild(t);
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
  function faviconFor(url) {
    const src = STATE.meta.settings.faviconSource;
    if (src === 'none') return '';
    try {
      const host = new URL(url).hostname;
      return src === 'duckduckgo' ? `https://icons.duckduckgo.com/ip3/${host}.ico` : `https://www.google.com/s2/favicons?sz=32&domain=${host}`;
    } catch { return ''; }
  }

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
    // The sidebar HTML starts in the open state; settings may pivot it to
    // compact/collapsed in applySettings(), which would transition from the
    // open width on first load. Suppress sidebar transitions until the first
    // fully-rendered frame has painted, and keep the page hidden (applySettings
    // with reveal=false) so settings and the first board/sidebar render hit the
    // screen at the same time.
    document.documentElement.classList.add('boot-no-sidebar-anim');
    injectStaticIcons();
    applySettings(false);
    await refreshOpenTabs();
    renderAll();
    document.documentElement.classList.add('theme-ready');
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('boot-no-sidebar-anim')));
    refreshRecentlyClosed().then(() => { if (sidebarShowingClosed) renderSidebar(); });
    migrateLegacyBrowserWidgets();
    wireGlobalEvents();
    const verEl = $('#app-version');
    if (verEl && chrome.runtime && chrome.runtime.getManifest) verEl.textContent = 'v' + (chrome.runtime.getManifest().version || '');
    handleDeepLink();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.tdb_data) {
        STATE = changes.tdb_data.newValue;
        scheduleRender();
        applySettings();
      }
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
        if (STATE.meta.settings.themeId === 'auto') { applySettings(); syncSettingsUI(); }
      });
    }
    setInterval(updateClockWidgets, 1000 * 30);
    setInterval(runRssAutoRefresh, 60000);
    ensureLiveTick();
  }

  async function reload() { STATE = await DB.getState(); scheduleRender(); }

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
    const limit = Number((STATE.meta.settings && STATE.meta.settings.recentlyClosedLimit) || 0);
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
    $$('.settings-tab .stab-ic').forEach(s => { if (ICONS[s.dataset.icon]) s.innerHTML = ICONS[s.dataset.icon]; });
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
  }

  /* Live theme preview (MonkeyType-style): pointing at / arrowing onto a theme
     in the command palette or theme picker applies it instantly without
     saving. Choosing it commits; leaving without choosing reverts. */
  let themePreviewing = false;
  function previewTheme(themeId) {
    if (!themeId) return;
    themePreviewing = true;
    const s = STATE.meta.settings;
    applyThemeColors(Themes.resolveTheme(themeId, s.lightThemeId, s.darkThemeId));
  }
  function commitThemePreview() { themePreviewing = false; }
  function endThemePreview() {
    if (!themePreviewing) return;
    themePreviewing = false;
    applySettings();
  }

  function applySettings(reveal = true) {
    const s = STATE.meta.settings;
    applyThemeColors(Themes.resolveTheme(s.themeId, s.lightThemeId, s.darkThemeId));
    const r = document.documentElement.style;
    r.setProperty('--board-cols', String((s.dashboard && s.dashboard.columns) || 4));
    r.setProperty('--board-row-min', s.density === 'compact' ? '168px' : '200px');
    const opacity = (s.tabsList && s.tabsList.dimInactive) ? (((s.tabsList.inactiveOpacity ?? 55)) / 100) : 1;
    const grayscale = (s.tabsList && s.tabsList.dimInactive && s.tabsList.inactiveGrayscale) ? 'grayscale(85%)' : 'none';
    r.setProperty('--inactive-tab-opacity', String(opacity));
    r.setProperty('--inactive-tab-filter', grayscale);
    document.documentElement.classList.toggle('density-compact', s.density === 'compact');
    ['radius-sharp', 'radius-rounded', 'radius-extra', 'radius-none'].forEach(c => document.documentElement.classList.toggle(c, s.radius === c.slice(7)));
    document.documentElement.classList.toggle('no-borders', s.borders === false);
    document.documentElement.classList.toggle('no-anim', s.animations === false);
    document.documentElement.classList.toggle('no-popup-blur', s.popupBlur === false);
    r.setProperty('--fb-zoom', String(((typeof s.interfaceFontSize === 'number' ? s.interfaceFontSize : 100)) / 100));
    const defaultStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    r.setProperty('--fb-font', s.interfaceFont ? `"${s.interfaceFont}", ${defaultStack}` : defaultStack);
    ['#search-trigger', '#shortcuts-btn', '#trash-btn'].forEach(sel => {
      const elNode = $(sel);
      if (!elNode) return;
      elNode.classList.toggle('hidden', sel === '#search-trigger' ? s.showTopbarSearch === false : s.showTopbarButtons === false);
    });
    $('#sidebar').classList.toggle('collapsed', !!s.sidebarCollapsed);
    $('#sidebar').classList.toggle('compact', !!s.sidebarCompact);
    // The sidebar toggle shows the collapse/expand panel icon for the state it
    // switches INTO: panel-left-close while visible, panel-left-open once fully
    // collapsed, while the compact toggle uses plain chevrons for the narrow rail.
    $('#sidebar-toggle-btn').innerHTML = icon(s.sidebarCollapsed ? 'panelLeftOpen' : 'panelLeftClose');
    $('#sidebar-compact-btn').innerHTML = icon(s.sidebarCompact ? 'chevronRight' : 'chevronLeft', 'sm');
    // Reveal now that real colors are set — avoids a flash of the light default.
    // boot() passes false so it can first render the board/sidebar (settings
    // and content land together, so the sidebar never shows mid-transition).
    if (reveal) document.documentElement.classList.add('theme-ready');
  }
  /* ============ QUICK TOGGLES ============ */
  async function toggleSidebar() {
    const collapsed = !STATE.meta.settings.sidebarCollapsed;
    await DB.updateSettings({ sidebarCollapsed: collapsed });
    await reload();
  }
  async function toggleSidebarCompact() {
    await DB.updateSettings({ sidebarCompact: !STATE.meta.settings.sidebarCompact });
    await reload();
  }
  async function toggleViewMode() {
    const next = STATE.meta.settings.viewMode === 'grid' ? 'list' : 'grid';
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
      if (!STATE.meta.settings.confirmDelete || await uiConfirm('Permanently delete all items in trash?', { title: 'Empty trash', okLabel: 'Empty trash', danger: true })) {
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
      draggedTab = null;
    });

    /* Tabs drag-to-reorder + drag-to-pin on the open-tabs list. Dragging always
       shows the same reorder indicator, wherever the tab lands: within the
       same pin group it reorders, dragging into the other group pins/unpins
       *and* still places the tab at the exact drop position. */
    const rowAfterLabel = (label) => {
      const next = label && label.nextElementSibling;
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
      const dropLabel = dropRow ? null : e.target.closest('.tab-group-label');
      if (!dropRow && !dropLabel) { clearBmDropIndicator(); return; }
      e.preventDefault();
      e.stopPropagation();
      if (dropLabel) {
        // The label's slot is the top edge of the group it introduces — draw
        // the bar above the label itself, which for a top-anchored label (e.g.
        // "Tabs" with nothing pinned) sits right at the very top of the list.
        showDropIndicator({ clientY: dropLabel.getBoundingClientRect().top - 2 }, dropLabel, 'list');
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
      const dropLabel = dropRow ? null : e.target.closest('.tab-group-label');
      clearBmDropIndicator();
      if (!dropRow && !dropLabel) return;
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
      // Group-label boundary: same group → drop at its top; other group →
      // pin/unpin at that section's edge.
      const edgeRow = rowAfterLabel(dropLabel);
      const edgeTarget = edgeRow ? rowFor(edgeRow) : null;
      const from = OPEN_TABS.find(t => t.id === dragged.id);
      const labelIsPinned = dropLabel.dataset.group === 'pinned';
      const sameGroup = from && from.pinned === labelIsPinned;
      if (sameGroup) {
        /* With nothing pinned the "Pinned" label is hidden, but the strip above
           the first unpinned tab is still the pin slot: dropping an unpinned
           tab there pins it to the very top instead of just reordering. */
        if (!labelIsPinned && !OPEN_TABS.some(t => t.pinned)) {
          await pinAndPlace(dragged, null, true, true);
        } else {
          await reorderTab(dragged, edgeTarget, true);
        }
      } else {
        await pinAndPlace(dragged, edgeTarget, true, labelIsPinned);
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
    $('#bulk-delete-btn').onclick = () => { if (SELECTED.size) deleteBookmarksWithUndo(Array.from(SELECTED)); };
    $('#bulk-clear-btn').onclick = () => { SELECTED.clear(); selectMode = false; renderBoard(); };

    /* Clicking the blurred backdrop closes any open popup, routing each one
       through its own close function so state/theme previews clean up. */
    registerOverlayCloser('modal-overlay', closeModal);
    registerOverlayCloser('palette-overlay', closePalette);
    registerOverlayCloser('settings-overlay', () => { endThemePreview(); closeSettings(); });
    registerOverlayCloser('trash-overlay', () => hideOverlay('#trash-overlay'));
    registerOverlayCloser('shortcuts-overlay', closeShortcuts);

    $('#palette-input').addEventListener('input', (e) => { paletteIndex = 0; renderPaletteResults(e.target.value); });
    $('#palette-input').addEventListener('keydown', (e) => {
      const items = $$('.palette-item');
      const previewAt = (i) => { const it = paletteItems[i]; if (it && it.kind === 'theme') previewTheme(it.themeId); };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteIndex = Math.min(paletteIndex + 1, items.length - 1);
        highlightPalette(items, paletteIndex); previewAt(paletteIndex); scrollPaletteActiveIntoView();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteIndex = Math.max(paletteIndex - 1, 0);
        highlightPalette(items, paletteIndex); previewAt(paletteIndex); scrollPaletteActiveIntoView();
      } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        const it = paletteItems[paletteIndex];
        if (it && (it.children || it.kind === 'folder')) activatePaletteItem(it);
      } else if (e.key === 'ArrowLeft' || (e.key === 'Backspace' && !e.target.value)) {
        e.preventDefault();
        if (!popPaletteNav()) endThemePreview();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (paletteItems[paletteIndex]) activatePaletteItem(paletteItems[paletteIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (paletteXPrimed) {
          paletteXPrimed = false;
          endThemePreview();
          $$('.palette-item').forEach(r => r.classList.remove('active'));
        } else {
          closePalette();
        }
      }
    });

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
      const mod = e.metaKey || e.ctrlKey;

      // Modifiers — always active, even inside inputs
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); quickAddCurrentTab(); return; }
      if (e.key === 'Escape') {
        closePalette();
        cancelThemePick();
        hideOverlay('#modal-overlay');
        hideOverlay('#settings-overlay');
        hideOverlay('#trash-overlay');
        hideOverlay('#shortcuts-overlay');
        if (SELECTED.size) { SELECTED.clear(); selectMode = false; renderBoard(); }
        if (SELECTED_TABS.size) { SELECTED_TABS.clear(); renderSidebar(); }
        return;
      }

      // Single-key shortcuts — skip when typing in inputs
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
      const k = e.key.toLowerCase();

      if (e.shiftKey && k === 'c') { toggleSidebarCompact(); return; }
      if (k === 'c') openCollectionModal();
      else if (k === 'v') toggleViewMode();
      else if (k === 't') toggleSidebar();
      else if (k === 's') openSettings();
      else if (k === '/') openPalette();
      else if (k === '?') openShortcuts();
      else if (k === 'g') {
        const trashOpen = !$('#trash-overlay').classList.contains('hidden');
        if (trashOpen) { hideOverlay('#trash-overlay'); closePalette(); }
        else openTrashPanel();
      }
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
  }

  function highlightPalette(items, idx) { items.forEach((it, i) => it.classList.toggle('active', i === idx)); }

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
