/* TabsBoard — new-tab app (v3: widget board) */
(function () {
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
    if (actionLabel) {
      const b = el('button', '', actionLabel);
      b.onclick = () => { actionFn && actionFn(); t.remove(); };
      t.appendChild(b);
    }
    region.appendChild(t);
    setTimeout(() => t.remove(), 5000);
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

  /* Duplicate-link detection: surfaces where a URL is already saved instead
     of silently letting the same page pile up across collections. */
  function normalizeUrl(u) {
    try { const x = new URL(u); return (x.hostname + x.pathname + x.search).replace(/\/$/, '').toLowerCase(); } catch { return (u || '').toLowerCase(); }
  }

  /* Lightweight fuzzy matcher for the command palette: query characters
     must appear in order in the target (not necessarily adjacent), so
     "gcal" matches "Google Calendar" and small typos/skipped letters still
     find things a strict substring search would miss. Returns a score (
     higher = better) or -1 for no match, so callers can both filter and
     rank in one pass — consecutive-character runs and matches near the
     start of the string score higher, matching the usual "VS Code style"
     command palette feel. */
  function fuzzyScore(query, text) {
    if (!query) return 0;
    const q = query.toLowerCase();
    const t = (text || '').toLowerCase();
    let qi = 0, score = 0, consecutive = 0;
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        consecutive++;
        score += 1 + consecutive; // reward runs of consecutive matches
        if (ti === 0 || t[ti - 1] === ' ') score += 3; // reward word-boundary starts
        qi++;
      } else {
        consecutive = 0;
      }
    }
    if (qi < q.length) return -1; // not every query character was found in order
    score -= t.length * 0.02; // slight preference for shorter/more specific matches
    return score;
  }

  function findExistingBookmark(url) {
    return Object.values(STATE.bookmarks).find(b => b.workspaceId === activeWorkspaceId() && normalizeUrl(b.url) === normalizeUrl(url));
  }
  async function addBookmarkSmart(collectionId, wsId, data) {
    const dupe = findExistingBookmark(data.url);
    if (dupe) {
      const col = STATE.collections[dupe.collectionId];
      toast(`Already saved in "${col ? col.name : 'another collection'}"`, 'Add anyway', async () => {
        await DB.createBookmark(collectionId, wsId, data);
        await reload();
      });
      return null;
    }
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
    injectStaticIcons();
    applySettings();
    await refreshOpenTabs();
    await refreshRecentlyClosed();
    renderAll();
    wireGlobalEvents();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.tdb_data) {
        STATE = changes.tdb_data.newValue;
        renderAll();
        applySettings();
      }
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'TOGGLE_SIDEBAR_REQUEST') toggleSidebar();
    });
    // When the theme is "auto", follow the OS light/dark switch live —
    // no reload needed.
    if (window.matchMedia) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (STATE.meta.settings.themeId === 'auto') applySettings();
      });
    }
    setInterval(updateClockWidgets, 1000 * 30);
    setInterval(updatePomodoroWidgets, 1000);
    function tickTimerWidgets() { updateTimerWidgets(); requestAnimationFrame(tickTimerWidgets); }
    requestAnimationFrame(tickTimerWidgets);
  }

  async function reload() { STATE = await DB.getState(); renderAll(); }

  async function refreshOpenTabs() {
    const res = await sendMsg('GET_OPEN_TABS');
    OPEN_TABS = (res && res.tabs) || [];
  }

  let RECENTLY_CLOSED = [];
  async function refreshRecentlyClosed() {
    const res = await sendMsg('GET_RECENTLY_CLOSED');
    RECENTLY_CLOSED = (res && res.items) || [];
  }

  function renderAll() {
    renderWorkspaceBar();
    renderSidebar();
    if (currentNav === 'collections') renderBoard();
    else renderSessionsPage();
  }

  /* ============ STATIC ICON INJECTION (buttons whose icon never changes) ============ */
  function injectStaticIcons() {
    $('#sidebar-toggle-btn').innerHTML = icon('chevronLeft');
    $('#nav-collections-btn .nav-ic').innerHTML = ICONS.layers;
    $('#nav-sessions-btn .nav-ic').innerHTML = ICONS.briefcase;
    $('#search-trigger .search-ic').innerHTML = ICONS.search;
    $('#shortcuts-btn').innerHTML = icon('keyboard');
    $('#trash-btn').prepend(el('span', 'icon', ICONS.trash));
    $('#settings-btn').innerHTML = icon('settings');
    $('#refresh-tabs-btn').innerHTML = icon('refresh', 'sm');
    $('#new-collection-btn .btn-ic').innerHTML = ICONS.plus;
    $('#add-widget-btn .btn-ic-sm').innerHTML = ICONS.widget;
    $('#save-window-session-btn .btn-ic').innerHTML = ICONS.save;
    $('.workspace-btn .chev-ic').innerHTML = ICONS.chevronDown;
    $('#board-switcher-btn .chev-ic').innerHTML = ICONS.chevronDown;
    $('#settings-close-x').innerHTML = icon('close', 'sm');
    $('#shortcuts-close-x').innerHTML = icon('close', 'sm');
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
    applyThemeColors(Themes.resolveTheme(themeId));
  }
  function commitThemePreview() { themePreviewing = false; }
  function endThemePreview() {
    if (!themePreviewing) return;
    themePreviewing = false;
    applySettings();
  }

  function applySettings() {
    const s = STATE.meta.settings;
    applyThemeColors(Themes.resolveTheme(s.themeId));
    const r = document.documentElement.style;
    r.setProperty('--board-cols', String((s.dashboard && s.dashboard.columns) || 4));
    r.setProperty('--board-row-min', '200px');
    const opacity = (s.tabsList && s.tabsList.dimInactive) ? (((s.tabsList.inactiveOpacity ?? 55)) / 100) : 1;
    const grayscale = (s.tabsList && s.tabsList.dimInactive && s.tabsList.inactiveGrayscale) ? 'grayscale(85%)' : 'none';
    r.setProperty('--inactive-tab-opacity', String(opacity));
    r.setProperty('--inactive-tab-filter', grayscale);
    document.documentElement.classList.toggle('density-compact', s.density === 'compact');
    document.documentElement.classList.toggle('no-anim', s.animations === false);
    $('#sidebar').classList.toggle('collapsed', !!s.sidebarCollapsed);
    $('#sidebar').classList.toggle('compact', !!s.sidebarCompact);
    $('#sidebar-toggle-btn .icon').style.transform = s.sidebarCollapsed ? 'rotate(180deg)' : 'none';
    document.documentElement.classList.add('theme-ready'); // reveal now that real colors are set — avoids a flash of the light default
  }

  /* ============ WORKSPACE BAR ============ */
  function renderWorkspaceBar() {
    const ws = STATE.workspaces[activeWorkspaceId()];
    if (!ws) return;
    $('#workspace-name').textContent = ws.name;

    const menu = $('#workspace-menu');
    const workspaces = Object.values(STATE.workspaces).sort((a, b) => a.order - b.order);
    let html = workspaces.map(w => `
      <div class="ws-item board-switcher-item${w.id === ws.id ? ' active' : ''}" data-workspace="${w.id}">
        <span class="board-switcher-label" style="flex:1">${escapeHtml(w.name)}</span>
        <button class="mi-inline-btn" data-rename="${w.id}" title="Rename">${ICONS.edit}</button>
        ${workspaces.length > 1 ? `<button class="mi-inline-btn" data-delete="${w.id}" title="Delete">${ICONS.trash}</button>` : ''}
      </div>`).join('');
    html += `<hr><button class="ws-add" data-act="new">+ New workspace</button>`;
    menu.innerHTML = html;

    $$('[data-workspace]', menu).forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('[data-rename]') || e.target.closest('[data-delete]')) return;
        menu.classList.add('hidden');
        await DB.setActiveWorkspace(row.dataset.workspace);
        await reload();
      });
    });
    $$('[data-rename]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); menu.classList.add('hidden');
        const w = STATE.workspaces[btn.dataset.rename];
        const name = prompt('Workspace name', w ? w.name : '');
        if (name) { await DB.updateWorkspace(btn.dataset.rename, { name }); await reload(); }
      };
    });
    $$('[data-delete]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); menu.classList.add('hidden');
        const w = STATE.workspaces[btn.dataset.delete];
        if (confirm(`Delete workspace "${w ? w.name : ''}" and everything in it? This can't be undone.`)) {
          await DB.deleteWorkspace(btn.dataset.delete);
          await reload();
        }
      };
    });
    menu.querySelector('[data-act=new]').onclick = () => { menu.classList.add('hidden'); openWorkspaceModal(); };
  }

  function openWorkspaceModal() {
    const body = `
      <h2>New Workspace</h2>
      <div class="field"><label>Name</label><input type="text" id="mws-name" value=""></div>
      <div class="modal-actions">
        <button id="mws-cancel" class="mini-btn">Cancel</button>
        <button id="mws-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mws-cancel').onclick = closeModal;
      $('#mws-name').focus();
      $('#mws-save').onclick = async () => {
        const name = $('#mws-name').value.trim() || 'Workspace';
        const w = await DB.createWorkspace(name);
        await DB.setActiveWorkspace(w.id);
        await reload(); closeModal();
      };
    });
  }

  /* ============ SIDEBAR: OPEN TABS / RECENTLY CLOSED (one list, toggled) ============ */
  function renderSidebar() {
    const list = $('#open-tabs-list');
    list.innerHTML = '';

    $('#sidebar-list-heading').textContent = sidebarShowingClosed ? 'Recently Closed' : 'Open Tabs';
    const toggleBtn = $('#recently-closed-toggle-btn');
    toggleBtn.classList.toggle('active', sidebarShowingClosed);
    toggleBtn.title = sidebarShowingClosed ? 'Back to open tabs' : 'Show recently closed';
    toggleBtn.innerHTML = icon(sidebarShowingClosed ? 'layers' : 'clock');

    if (sidebarShowingClosed) {
      renderRecentlyClosedRows(list);
      return;
    }

    const s = STATE.meta.settings.tabsList;
    const pinned = OPEN_TABS.filter(t => t.pinned);
    const rest = OPEN_TABS.filter(t => !t.pinned);

    if (s.groupPinned && pinned.length) {
      list.appendChild(el('div', 'tab-group-label', 'Pinned'));
      pinned.forEach(t => list.appendChild(renderTabRow(t)));
      list.appendChild(el('div', 'tab-group-label', 'Tabs'));
      rest.forEach(t => list.appendChild(renderTabRow(t)));
    } else {
      OPEN_TABS.forEach(t => list.appendChild(renderTabRow(t)));
    }
    if (!OPEN_TABS.length) list.appendChild(el('div', 'empty-collection-hint', 'No open tabs'));
  }

  function renderTabRow(tab) {
    const s = STATE.meta.settings.tabsList;
    const row = el('div', 'tab-row');
    if (s.dimInactive && tab.discarded) row.classList.add('tab-inactive');
    row.draggable = true;
    row.dataset.tabId = tab.id;
    row.innerHTML = `
      <img class="favicon" src="${tab.favIconUrl || faviconFor(tab.url)}" title="${escapeHtml(tab.title || tab.url)}" onerror="this.style.visibility='hidden'">
      ${tab.pinned ? `<span class="pin-badge">${ICONS.pin}</span>` : ''}
      <span class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title || tab.url)}</span>
      <span class="tab-icons">
        <button data-act="menu" title="Tab actions">${ICONS.dots}</button>
        <button data-act="close" class="tab-close" title="Close tab">${ICONS.close}</button>
      </span>`;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tdb-tab', JSON.stringify(tab));
      row.classList.add('dragging');
      document.body.classList.add('dragging-tab');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.body.classList.remove('dragging-tab');
    });
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      sendMsg('FOCUS_TAB', { tabId: tab.id });
    });
    row.querySelector('[data-act=close]').onclick = async (e) => {
      e.stopPropagation();
      await sendMsg('CLOSE_TAB', { tabId: tab.id });
      await refreshOpenTabs(); await refreshRecentlyClosed();
      renderSidebar();
    };
    row.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openTabMenu(tab, e.currentTarget); };
    return row;
  }

  function openTabMenu(tab, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');

    const pinned = tab.pinned;
    const muted = tab.mutedInfo && tab.mutedInfo.muted;
    const canUnload = !tab.discarded && !tab.active;

    menu.innerHTML = `
      <div class="ws-item" data-act="addcol"><span class="mi-ic">${ICONS.plus}</span>Add to collection…</div>
      <hr>
      <div class="ws-item" data-act="pin"><span class="mi-ic">${ICONS.pin}</span>${pinned ? 'Unpin from tab strip' : 'Keep pinned in tab strip'}</div>
      <div class="ws-item" data-act="mute"><span class="mi-ic">${muted ? ICONS.unmute : ICONS.mute}</span>${muted ? 'Let it play sound again' : 'Silence this tab'}</div>
      <div class="ws-item" data-act="dup"><span class="mi-ic">${ICONS.duplicate}</span>Open a copy of this tab</div>
      <div class="ws-item" data-act="movewin"><span class="mi-ic">${ICONS.externalWindow}</span>Pop out to its own window</div>
      ${canUnload ? `<div class="ws-item" data-act="unload"><span class="mi-ic">${ICONS.archive}</span>Unload this tab</div>` : ''}
      <hr>
      <div class="ws-item" data-act="close" data-danger><span class="mi-ic">${ICONS.close}</span>Close this tab</div>`;
    const close = showDropdown(menu, rect, 230);

    menu.querySelector('[data-act=addcol]').onclick = (e) => { close(); openTabAddToCollectionMenu(tab, anchorBtn); };
    menu.querySelector('[data-act=pin]').onclick = async () => { close(); await sendMsg('TOGGLE_PIN_TAB', { tabId: tab.id, pinned: !pinned }); await refreshOpenTabs(); renderSidebar(); };
    menu.querySelector('[data-act=mute]').onclick = async () => { close(); await sendMsg('TOGGLE_MUTE_TAB', { tabId: tab.id, muted: !muted }); await refreshOpenTabs(); renderSidebar(); };
    menu.querySelector('[data-act=dup]').onclick = async () => { close(); await sendMsg('DUPLICATE_TAB', { tabId: tab.id }); await refreshOpenTabs(); renderSidebar(); };
    menu.querySelector('[data-act=movewin]').onclick = async () => { close(); await sendMsg('MOVE_TAB_NEW_WINDOW', { tabId: tab.id }); await refreshOpenTabs(); renderSidebar(); };
    const unloadBtn = menu.querySelector('[data-act=unload]');
    if (unloadBtn) unloadBtn.onclick = async () => {
      close();
      const res = await sendMsg('DISCARD_TAB', { tabId: tab.id });
      if (res && res.ok) toast('Tab unloaded');
      else toast("Couldn't unload that tab");
      await refreshOpenTabs(); renderSidebar();
    };
    menu.querySelector('[data-act=close]').onclick = async () => {
      close();
      await sendMsg('CLOSE_TAB', { tabId: tab.id });
      await refreshOpenTabs(); await refreshRecentlyClosed();
      renderSidebar();
    };
  }

  function openTabAddToCollectionMenu(tab, anchorBtn) {
    const cols = collectionsForActiveWS();
    if (!cols.length) { toast('Create a collection first'); return; }
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    cols.forEach(c => {
      const item = el('div', 'ws-item');
      item.innerHTML = `<span style="flex:1">${escapeHtml(c.name)}</span>`;
      item.onclick = async () => {
        menu.remove();
        const created = await addBookmarkSmart(c.id, activeWorkspaceId(), { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
        if (created) toast(`Added to "${c.name}"`);
      };
      menu.appendChild(item);
    });
    showDropdown(menu, rect, 240);
  }

  function renderRecentlyClosedRows(wrap) {
    RECENTLY_CLOSED.forEach(item => {
      const row = el('div', 'tab-row');
      row.innerHTML = `
        <img class="favicon" src="${item.favIconUrl || faviconFor(item.url)}" onerror="this.style.visibility='hidden'">
        <span class="tab-title" title="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</span>
        <span class="tab-icons">
          <button data-act="reopen" title="Reopen this tab">${ICONS.refresh}</button>
        </span>`;
      row.addEventListener('click', async () => {
        await sendMsg('REOPEN_CLOSED_SESSION', { sessionId: item.sessionId });
        await refreshOpenTabs();
        await refreshRecentlyClosed();
        sidebarShowingClosed = false; // reopening a tab naturally returns you to the tabs view
        renderSidebar();
      });
      wrap.appendChild(row);
    });
    if (!RECENTLY_CLOSED.length) wrap.appendChild(el('div', 'empty-collection-hint', 'Nothing closed recently'));
  }

  /* ============ BOARD (widgets) ============ */
  const filterQueryFor = { collections: '', sessions: '' };

  function renderBoard() {
    $('#view-collections').classList.remove('hidden');
    $('#view-sessions').classList.add('hidden');
    renderBoardSwitcher();
    const board = $('#board');
    board.innerHTML = '';
    const q = filterQueryFor.collections.trim().toLowerCase();
    const widgets = widgetsForActiveWS();

    widgets.forEach(w => {
      if (q && w.type === 'collection') {
        const col = STATE.collections[w.collectionId];
        if (!col || !col.name.toLowerCase().includes(q)) return;
      } else if (q && w.type !== 'collection') {
        return; // filter box only searches collection names
      }
      board.appendChild(renderWidget(w));
    });

    board.appendChild(renderGhostWidget());
    if (!widgets.length && !q) {
      // ghost tile alone is enough of an empty state — no extra copy needed
    }
    updateBulkBar();
  }

  function renderBoardSwitcher() {
    const board = STATE.boards[activeBoardId()];
    $('#board-switcher-name').textContent = board ? board.name : 'Board';
  }

  function openBoardSwitcherMenu(anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    const boards = boardsForActiveWS();
    const curId = activeBoardId();
    let html = boards.map(b => `
      <div class="ws-item board-switcher-item${b.id === curId ? ' active' : ''}" data-board="${b.id}">
        <span class="board-switcher-label" style="flex:1">${escapeHtml(b.name)}</span>
        <button class="mi-inline-btn" data-rename="${b.id}" title="Rename">${ICONS.edit}</button>
        ${boards.length > 1 ? `<button class="mi-inline-btn" data-delete="${b.id}" title="Delete">${ICONS.trash}</button>` : ''}
      </div>`).join('');
    html += `<hr><button class="ws-add" data-act="new">+ New board</button>`;
    menu.innerHTML = html;
    const close = showDropdown(menu, rect, 240);

    $$('[data-board]', menu).forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('[data-rename]') || e.target.closest('[data-delete]')) return;
        close();
        await DB.setActiveBoard(activeWorkspaceId(), row.dataset.board);
        await reload();
      });
    });
    $$('[data-rename]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); close();
        const board = STATE.boards[btn.dataset.rename];
        const name = prompt('Board name', board ? board.name : '');
        if (name) { await DB.renameBoard(btn.dataset.rename, name); await reload(); }
      };
    });
    $$('[data-delete]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); close();
        const board = STATE.boards[btn.dataset.delete];
        if (!confirm(`Delete board "${board ? board.name : ''}"? Its widgets move to another board — nothing is deleted.`)) return;
        const res = await DB.deleteBoard(btn.dataset.delete);
        if (res && res.ok) toast(`Moved ${res.movedCount} widget${res.movedCount === 1 ? '' : 's'} to "${res.movedTo}"`);
        await reload();
      };
    });
    menu.querySelector('[data-act=new]').onclick = async () => {
      close();
      const name = prompt('New board name', `Board ${boardsForActiveWS().length + 1}`);
      if (name === null) return;
      await DB.createBoard(activeWorkspaceId(), name);
      await reload();
    };
  }

  function renderWidget(w) {
    if (w.type === 'collection') return renderCollectionWidget(w);
    if (w.type === 'notes') return renderNotesWidget(w);
    if (w.type === 'todo') return renderTodoWidget(w);
    if (w.type === 'clock') return renderClockWidget(w);
    if (w.type === 'search') return renderSearchWidget(w);
    if (w.type === 'countdown') return renderCountdownWidget(w);
    if (w.type === 'pomodoro') return renderPomodoroWidget(w);
    if (w.type === 'timer') return renderTimerWidget(w);
    if (w.type === 'stopwatch') return renderStopwatchWidget(w);
    if (w.type === 'weather') return renderWeatherWidget(w);
    if (w.type === 'rss') return renderRssWidget(w);
    return el('div');
  }

  function widgetShell(w, typeIcon, titleHtml, headerExtrasHtml) {
    const card = el('div', 'widget');
    card.dataset.widgetId = w.id;
    card.dataset.span = String(w.span || 1);
    card.dataset.rowspan = String(w.rowSpan || 1);
    if (w.tintColor && CU) {
      const base = getComputedStyle(document.documentElement).getPropertyValue('--sub-alt-color').trim() || '#ffffff';
      card.style.background = CU.mix(base, w.tintColor, 0.16);
    }
    // Board widgets auto-flow (CSS packs them top-left with no empty gaps);
    // data-span/data-rowspan drive their size. No explicit grid cells.
    const header = el('div', 'widget-header');
    header.draggable = true;
    header.innerHTML = `
      <span class="widget-type-ic">${typeIcon}</span>
      ${titleHtml}
      ${headerExtrasHtml || ''}
      <button class="widget-menu-btn" data-act="menu">${ICONS.dots}</button>`;
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tdb-widget', w.id);
      header.classList.add('dragging');
    });
    header.addEventListener('dragend', () => header.classList.remove('dragging'));
    card.appendChild(header);
    wireWidgetReorderDropZone(card, w);
    wireWidgetResizeHandle(card, w);
    return { card, header };
  }

  /* Shared "Background color" menu item + modal — available on every
     widget type (not just collections). Default (tintColor: null) means
     "use the normal surface color, untouched"; picking a color blends it
     in as a solid tint, no gradient, no global switch involved. */
  function tintMenuItemHtml() {
    return `<div class="ws-item" data-act="tint"><span class="mi-ic">${ICONS.palette}</span>Background color…</div>`;
  }
  function wireTintMenuItem(menu, w, close) {
    const btn = menu.querySelector('[data-act=tint]');
    if (btn) btn.onclick = () => { close(); openWidgetTintModal(w); };
  }
  function openWidgetTintModal(w) {
    openTintPickerModal(w.tintColor, async (color) => { await DB.updateWidget(w.id, { tintColor: color }); await reload(); });
  }

  /* Shared background-color picker modal — used for widget tint and, below,
     per-bookmark tint. Takes the current color (or null) and an async
     setter to call with the chosen value (or null for "no tint"). */
  function openTintPickerModal(currentColor, onSet) {
    const body = `
      <h2>Background color</h2>
      <p style="color:var(--sub-color);font-size:13px;margin-top:-6px">Leave unset to use the normal background.</p>
      <div class="field"><label>Color</label><div class="color-picker" id="mtc-colors"></div></div>
      <div class="modal-actions">
        <button id="mtc-none" class="mini-btn">No tint (default)</button>
        <button id="mtc-cancel" class="mini-btn">Cancel</button>
        <button id="mtc-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      renderColorPicker('#mtc-colors', currentColor || null);
      $('#mtc-cancel').onclick = closeModal;
      $('#mtc-none').onclick = async () => { await onSet(null); closeModal(); };
      $('#mtc-save').onclick = async () => {
        const swatch = $('#mtc-colors .selected');
        await onSet(swatch ? swatch.dataset.color : null);
        closeModal();
      };
    });
  }

  /* True drag-to-resize: grab a handle on a widget's edge (right = width,
     bottom = height, corner = both) and drag to change its grid span live,
     snapping to whole columns/rows. The menu's 1–N pickers still work too —
     this is just the direct-manipulation path. */
  function getBoardMetrics() {
    const boardEl = $('#board');
    const rect = boardEl.getBoundingClientRect();
    const style = getComputedStyle(boardEl);
    const gap = parseFloat(style.columnGap || style.gap) || 18;
    const cols = (STATE.meta.settings.dashboard && STATE.meta.settings.dashboard.columns) || 4;
    const colWidth = (rect.width - gap * (cols - 1)) / cols;
    return { cols, gap, colWidth };
  }
  function spanWidthPx(span, metrics) { return metrics.colWidth * span + metrics.gap * (span - 1); }

  function wireWidgetResizeHandle(card, w) {
    // right edge — column span
    const handleR = el('div', 'widget-resize-handle');
    handleR.title = 'Drag to resize width';
    // bottom edge — row span
    const handleB = el('div', 'widget-resize-handle-b');
    handleB.title = 'Drag to resize height';
    // bottom-right corner — both at once
    const handleC = el('div', 'widget-resize-handle-c');
    handleC.title = 'Drag to resize width & height';
    card.appendChild(handleR);
    card.appendChild(handleB);
    card.appendChild(handleC);

    function rowSpanPx(rows, rowH, gap) { return rowH * rows + gap * (rows - 1); }

    // liveSpan/liveRow live at this scope (not inside startResize) so that
    // applyLiveSize — a sibling function — can read and update them. Declaring
    // them inside startResize made applyLiveSize throw "liveSpan is not
    // defined", which silently killed resizing on every card.
    let liveSpan = 1;
    let liveRow = 1;

    function applyLiveSize() {
      card.dataset.span = String(liveSpan);
      card.dataset.rowspan = String(liveRow);
    }

    function startResize(e, axes) {
      e.preventDefault();
      e.stopPropagation();
      const metrics = getBoardMetrics();
      const startSpan = w.span || 1;
      const startRow = w.rowSpan || 1;
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidthPx = spanWidthPx(startSpan, metrics);
      // Baseline single-row height: the card's own height split across its rows.
      const startRowPx = card.getBoundingClientRect().height / startRow;
      card.classList.add('resizing');
      liveSpan = startSpan;
      liveRow = startRow;

      const onMove = (ev) => {
        if (axes.x) {
          const deltaX = ev.clientX - startX;
          const candidateWidth = startWidthPx + deltaX;
          let span = Math.round((candidateWidth + metrics.gap) / (metrics.colWidth + metrics.gap));
          span = Math.max(1, Math.min(4, metrics.cols, span));
          if (span !== liveSpan) { liveSpan = span; applyLiveSize(); }
        }
        if (axes.y) {
          const deltaY = ev.clientY - startY;
          const cardHeight = rowSpanPx(startRow, startRowPx, metrics.gap) + deltaY;
          let row = Math.round((cardHeight + metrics.gap) / (startRowPx + metrics.gap));
          row = Math.max(1, Math.min(4, row));
          if (row !== liveRow) { liveRow = row; applyLiveSize(); }
        }
      };
      const onUp = async () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('resizing');
        liveSpan = liveSpan !== undefined ? liveSpan : startSpan;
        liveRow = liveRow !== undefined ? liveRow : startRow;
        applyLiveSize();
        const patch = {};
        if (liveSpan !== startSpan) patch.span = liveSpan;
        if (liveRow !== startRow) patch.rowSpan = liveRow;
        if (Object.keys(patch).length) { await DB.updateWidget(w.id, patch); await reload(); }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    handleR.addEventListener('mousedown', (e) => startResize(e, { x: true, y: false }));
    handleB.addEventListener('mousedown', (e) => startResize(e, { x: false, y: true }));
    handleC.addEventListener('mousedown', (e) => startResize(e, { x: true, y: true }));
  }

  /* Shared "Width" menu section (moved off the header into the ⋯ menu so
     the header itself stays uncluttered) — used by both the collection
     menu and the generic notes/todo/clock widget menu. */
  function widthMenuItemsHtml(w) {
    const current = w.span || 1;
    const buttons = [1, 2, 3, 4].map(n =>
      `<button data-width="${n}" class="${n === current ? 'active' : ''}">${n}</button>`
    ).join('');
    return `<div class="ws-item-label">Width</div><div class="width-row">${buttons}</div>`;
  }
  function wireWidthMenuItems(menu, w, close) {
    $$('[data-width]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        close();
        await DB.updateWidget(w.id, { span: parseInt(btn.dataset.width, 10) });
        await reload();
      };
    });
  }

  /* Shared "Height" menu section — same idea as the width picker but for
     row span (how many grid rows a widget occupies vertically). */
  function heightMenuItemsHtml(w) {
    const current = w.rowSpan || 1;
    const buttons = [1, 2, 3, 4].map(n =>
      `<button data-height="${n}" class="${n === current ? 'active' : ''}">${n}</button>`
    ).join('');
    return `<div class="ws-item-label">Height</div><div class="width-row">${buttons}</div>`;
  }
  function wireHeightMenuItems(menu, w, close) {
    $$('[data-height]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        close();
        await DB.updateWidget(w.id, { rowSpan: parseInt(btn.dataset.height, 10) });
        await reload();
      };
    });
  }

  function viewMenuItemsHtml(col) {
    const current = col.viewMode || STATE.meta.settings.viewMode;
    return `<div class="ws-item-label">View</div><div class="width-row">` +
      `<button data-view="grid" class="${current === 'grid' ? 'active' : ''}">Tiles</button>` +
      `<button data-view="list" class="${current === 'list' ? 'active' : ''}">Rows</button>` +
      `</div>`;
  }
  function wireViewMenuItems(menu, col, close) {
    $$('[data-view]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        close();
        await DB.setCollectionViewMode(col.id, btn.dataset.view);
        await reload();
      };
    });
  }

  function wireWidgetReorderDropZone(card, w) {
    card.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-tdb-widget')) {
        e.preventDefault();
        card.classList.add('drag-over');
      }
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', async (e) => {
      card.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('application/x-tdb-widget');
      if (!draggedId || draggedId === w.id) return;
      e.preventDefault();
      e.stopPropagation();
      const ordered = widgetsForActiveWS().map(x => x.id);
      const from = ordered.indexOf(draggedId);
      const to = ordered.indexOf(w.id);
      if (from < 0 || to < 0) return;
      ordered.splice(from, 1);
      ordered.splice(to, 0, draggedId);
      await DB.reorderWidgets(ordered);
      await reload();
    });
  }

  function renderCollectionWidget(w) {
    const col = STATE.collections[w.collectionId];
    if (!col) return el('div');
    const bms = bookmarksForCollection(col.id);
    const viewMode = col.viewMode || STATE.meta.settings.viewMode;
    const titleHtml = `
      <span class="widget-title" title="${escapeHtml(col.name)}">${escapeHtml(col.name)}</span>
      ${col.pinned ? `<span class="collection-pin-ic">${ICONS.pin}</span>` : ''}
      <button class="widget-add-btn" data-act="add" title="Add a bookmark">${ICONS.plus}</button>`;
    const { card, header } = widgetShell(w, ICONS.layers, titleHtml);
    card.classList.toggle('pinned', !!col.pinned);
    header.querySelector('[data-act=add]').onclick = (e) => { e.stopPropagation(); openBookmarkModal(null, col.id); };
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openCollectionMenu(col, e.currentTarget.getBoundingClientRect()); };
    card.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.widget-menu-btn') || e.target.closest('.widget-add-btn')) return; // those already do their own thing
      e.preventDefault();
      e.stopPropagation();
      openCollectionMenu(col, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 });
    });

    const body = el('div', 'widget-body');
    const listWrap = el('div', 'bookmarks-list' + (viewMode === 'grid' && bms.length ? ' view-grid' : '') + (!bms.length ? ' is-empty' : ''));
    if (!bms.length) listWrap.appendChild(el('div', 'empty-collection-hint', 'Drop tabs here, or add a bookmark'));
    bms.forEach(bm => listWrap.appendChild(renderBookmark(bm, viewMode, w.tintColor, col, listWrap)));
    body.appendChild(listWrap);
    card.appendChild(body);

    wireCollectionDropZone(card, col, listWrap);
    return card;
  }

  function renderNotesWidget(w) {
    const titleHtml = `<span class="widget-title">Notes</span>`;
    const { card, header } = widgetShell(w, ICONS.notes, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body notes-body');
    const ta = el('textarea', 'notes-textarea');
    ta.placeholder = 'Jot something down…';
    ta.value = w.text || '';
    let debounce;
    ta.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => { await DB.updateWidget(w.id, { text: ta.value }); STATE = await DB.getState(); }, 400);
    });
    body.appendChild(ta);
    card.appendChild(body);
    return card;
  }

  function renderTodoWidget(w) {
    const titleHtml = `<span class="widget-title">To-Do</span>`;
    const { card, header } = widgetShell(w, ICONS.checkSquare, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body todo-body');
    const items = w.items || [];
    const listEl = el('div', 'todo-list');
    items.forEach(item => {
      const row = el('label', 'todo-item' + (item.done ? ' done' : ''));
      row.innerHTML = `
        <input type="checkbox" class="checkbox" ${item.done ? 'checked' : ''}>
        <span class="todo-text">${escapeHtml(item.text)}</span>
        <button type="button" class="todo-del">${ICONS.close}</button>`;
      row.querySelector('input').onchange = async (e) => {
        const next = items.map(it => it.id === item.id ? { ...it, done: e.target.checked } : it);
        await DB.updateWidget(w.id, { items: next });
        await reload();
      };
      row.querySelector('.todo-del').onclick = async (e) => {
        e.preventDefault();
        const next = items.filter(it => it.id !== item.id);
        await DB.updateWidget(w.id, { items: next });
        await reload();
      };
      listEl.appendChild(row);
    });
    body.appendChild(listEl);

    const addRow = el('div', 'todo-add-row');
    const input = el('input');
    input.type = 'text'; input.placeholder = 'Add an item…';
    const addBtn = el('button', 'mini-btn', '+');
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      const next = items.concat([{ id: DB.uid(), text, done: false }]);
      await DB.updateWidget(w.id, { items: next });
      await reload();
    };
    addBtn.onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    addRow.appendChild(input); addRow.appendChild(addBtn);
    body.appendChild(addRow);
    card.appendChild(body);
    return card;
  }

  const CLOCK_TZ_PRESETS = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
    'Europe/Moscow', 'Europe/Istanbul', 'Africa/Cairo', 'Africa/Lagos',
    'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok',
    'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland'
  ];

  function renderClockWidget(w) {
    const titleHtml = `<span class="widget-title">Clock</span>`;
    const { card, header } = widgetShell(w, ICONS.clock, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body clock-body');
    body.innerHTML = `<div class="clock-time" data-clock-time></div><div class="clock-date" data-clock-date></div><div class="clock-tz" data-clock-tz></div>`;
    card.appendChild(body);
    updateClockNode(card, w.format || '24', w.timezone || '');
    return card;
  }

  function updateClockNode(card, format, timezone) {
    const now = new Date();
    const timeEl = card.querySelector('[data-clock-time]');
    const dateEl = card.querySelector('[data-clock-date]');
    const tzEl = card.querySelector('[data-clock-tz]');
    if (!timeEl) return;
    const tzOpts = timezone ? { timeZone: timezone } : {};
    try {
      timeEl.textContent = now.toLocaleTimeString([], Object.assign(tzOpts, format === '12' ? { hour: 'numeric', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false }));
      dateEl.textContent = now.toLocaleDateString([], Object.assign({}, tzOpts, { weekday: 'long', month: 'long', day: 'numeric' }));
      if (tzEl) tzEl.textContent = timezone || '';
    } catch {
      timeEl.textContent = now.toLocaleTimeString([], format === '12' ? { hour: 'numeric', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', hour12: false });
      dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
      if (tzEl) tzEl.textContent = '';
    }
  }
  function updateClockWidgets() {
    $$('.widget[data-span] .clock-body').forEach(body => {
      const card = body.closest('.widget');
      const w = STATE.widgets[card.dataset.widgetId];
      updateClockNode(card, w ? (w.format || '24') : '24', w ? (w.timezone || '') : '');
    });
  }

  function openClockTzModal(w) {
    const body = `
      <h2>Clock timezone</h2>
      <p class="hint-text">Pick a timezone, or leave empty to use your local time. Example: America/New_York, Europe/Berlin, Asia/Tokyo, UTC.</p>
      <div class="field"><label>Timezone</label><input type="text" id="mctz-tz" list="mctz-list" value="${escapeHtml(w.timezone || '')}" placeholder="e.g. Europe/Berlin"><datalist id="mctz-list">${CLOCK_TZ_PRESETS.map(t => `<option value="${t}">`).join('')}</datalist></div>
      <div class="modal-actions">
        <button id="mctz-cancel" class="mini-btn">Cancel</button>
        <button id="mctz-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mctz-cancel').onclick = closeModal;
      $('#mctz-save').onclick = async () => {
        await DB.updateWidget(w.id, { timezone: $('#mctz-tz').value.trim() });
        await reload(); closeModal();
      };
    });
  }

  /* ---- Search box: submits straight to a search engine ---- */
  const SEARCH_ENGINE_URLS = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q='
  };
  function renderSearchWidget(w) {
    const engine = w.engine || 'google';
    const titleHtml = `<span class="widget-title">Search</span>`;
    const { card, header } = widgetShell(w, ICONS.search, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body search-widget-body');
    body.innerHTML = `
      <div class="search-widget-row">
        <span class="search-widget-ic">${ICONS.search}</span>
        <input type="text" class="search-widget-input" placeholder="Search ${engine === 'duckduckgo' ? 'DuckDuckGo' : engine === 'bing' ? 'Bing' : 'Google'}…">
      </div>`;
    const input = body.querySelector('input');
    const submit = () => {
      const q = input.value.trim();
      if (!q) return;
      sendMsg('OPEN_URL', { url: (SEARCH_ENGINE_URLS[engine] || SEARCH_ENGINE_URLS.google) + encodeURIComponent(q), forceNewTab: true });
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.appendChild(body);
    return card;
  }

  /* ---- Countdown: days remaining until a date ---- */
  function renderCountdownWidget(w) {
    const titleHtml = `<span class="widget-title">${escapeHtml(w.label || 'Countdown')}</span>`;
    const { card, header } = widgetShell(w, ICONS.clock, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body countdown-body');
    if (!w.targetDate) {
      body.innerHTML = `<div class="empty-collection-hint">Set a date from this widget's ⋯ menu</div>`;
    } else {
      const target = new Date(w.targetDate + 'T00:00:00');
      const now = new Date();
      const msPerDay = 86400000;
      const diffDays = Math.ceil((target.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / msPerDay);
      let big, small;
      if (diffDays > 0) { big = String(diffDays); small = diffDays === 1 ? 'day to go' : 'days to go'; }
      else if (diffDays === 0) { big = 'Today'; small = w.label || ''; }
      else { big = String(Math.abs(diffDays)); small = Math.abs(diffDays) === 1 ? 'day ago' : 'days ago'; }
      body.innerHTML = `<div class="countdown-big">${big}</div><div class="countdown-small">${escapeHtml(small)}</div>`;
    }
    card.appendChild(body);
    return card;
  }

  function openCountdownEditModal(w) {
    const body = `
      <h2>Edit Countdown</h2>
      <div class="field"><label>Label</label><input type="text" id="mcd-label" value="${escapeHtml(w.label || '')}"></div>
      <div class="field"><label>Target date</label><input type="date" id="mcd-date" value="${w.targetDate || ''}"></div>
      <div class="modal-actions">
        <button id="mcd-cancel" class="mini-btn">Cancel</button>
        <button id="mcd-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mcd-cancel').onclick = closeModal;
      $('#mcd-save').onclick = async () => {
        await DB.updateWidget(w.id, { label: $('#mcd-label').value.trim() || 'Countdown', targetDate: $('#mcd-date').value });
        await reload(); closeModal();
      };
    });
  }

  /* ---- Pomodoro: focus/break timer, driven off a stored end-timestamp so
     it stays correct across reloads without needing per-second writes ---- */
  function pomodoroRemaining(w) {
    if (!w.running || !w.endsAt) return (w.mode === 'focus' ? w.focusMinutes : w.breakMinutes) * 60;
    return Math.max(0, Math.round((w.endsAt - Date.now()) / 1000));
  }
  function renderPomodoroWidget(w) {
    const titleHtml = `<span class="widget-title">Pomodoro</span>`;
    const { card, header } = widgetShell(w, ICONS.clock, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body pomodoro-body');
    body.innerHTML = `
      <div class="pomodoro-mode">${w.mode === 'break' ? 'Break' : 'Focus'}</div>
      <div class="pomodoro-time" data-pomodoro-time></div>
      <div class="pomodoro-actions">
        <button class="mini-btn" data-act="toggle">${w.running ? 'Pause' : 'Start'}</button>
        <button class="mini-btn" data-act="reset">Reset</button>
        <button class="mini-btn" data-act="skip">Skip</button>
      </div>`;
    body.querySelector('[data-act=toggle]').onclick = async () => {
      if (w.running) {
        await DB.updateWidget(w.id, { running: false, endsAt: null });
      } else {
        const seconds = pomodoroRemaining(w);
        await DB.updateWidget(w.id, { running: true, endsAt: Date.now() + seconds * 1000 });
      }
      await reload();
    };
    body.querySelector('[data-act=reset]').onclick = async () => { await DB.updateWidget(w.id, { running: false, endsAt: null }); await reload(); };
    body.querySelector('[data-act=skip]').onclick = async () => {
      await DB.updateWidget(w.id, { mode: w.mode === 'focus' ? 'break' : 'focus', running: false, endsAt: null });
      await reload();
    };
    card.appendChild(body);
    updatePomodoroNode(card, w);
    return card;
  }
  function formatSeconds(total) {
    const m = Math.floor(total / 60), s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function updatePomodoroNode(card, w) {
    const timeEl = card.querySelector('[data-pomodoro-time]');
    if (!timeEl) return;
    const remaining = pomodoroRemaining(w);
    timeEl.textContent = formatSeconds(remaining);
    if (w.running && remaining <= 0) {
      // Time's up — flip mode and stop, so it doesn't silently run negative.
      DB.updateWidget(w.id, { mode: w.mode === 'focus' ? 'break' : 'focus', running: false, endsAt: null }).then(reload);
      playChime();
      notifyPomodoro(w);
    }
  }
  function updatePomodoroWidgets() {
    $$('.widget').forEach(card => {
      const w = STATE.widgets[card.dataset.widgetId];
      if (w && w.type === 'pomodoro') updatePomodoroNode(card, w);
    });
  }
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 660; g.gain.value = 0.08;
      o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 300);
    } catch { /* audio not available — silently skip */ }
  }

  // Browser notification when a pomodoro cycle finishes. Requests permission
  // lazily (only on first completion) so we never nag the user up front.
  function notifyPomodoro(w) {
    try {
      if (!('Notification' in window)) return;
      const isBreak = w.mode === 'focus'; // the mode that just finished
      const title = isBreak ? 'Pomodoro complete' : 'Break over';
      const body = isBreak
        ? `Time for a ${w.breakMinutes || 5} min break.`
        : 'Back to focus!';
      const permission = Notification && typeof Notification.requestPermission === 'function'
        ? () => Notification.requestPermission()
        : () => Promise.resolve(Notification.permission);
      permission().then((p) => {
        if (p !== 'granted') return;
        new Notification(title, { body, silent: false, icon: chrome.runtime.getURL('icons/icon128.png') });
      });
    } catch { /* notifications unavailable — silently skip */ }
  }

  function openPomodoroEditModal(w) {
    const body = `
      <h2>Edit Pomodoro durations</h2>
      <div class="field"><label>Focus minutes</label><input type="number" id="mpo-focus" min="1" max="180" value="${w.focusMinutes || 25}"></div>
      <div class="field"><label>Break minutes</label><input type="number" id="mpo-break" min="1" max="60" value="${w.breakMinutes || 5}"></div>
      <div class="modal-actions">
        <button id="mpo-cancel" class="mini-btn">Cancel</button>
        <button id="mpo-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mpo-cancel').onclick = closeModal;
      $('#mpo-save').onclick = async () => {
        const focusMinutes = Math.max(1, parseInt($('#mpo-focus').value, 10) || 25);
        const breakMinutes = Math.max(1, parseInt($('#mpo-break').value, 10) || 5);
        await DB.updateWidget(w.id, { focusMinutes, breakMinutes, running: false, endsAt: null });
        await reload(); closeModal();
      };
    });
  }

  function formatMs(ms, showMs) {
    const pad = (n, l) => String(n).padStart(l, '0');
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    let out = h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${pad(m, 2)}:${pad(s, 2)}`;
    if (showMs) out += '.' + pad(Math.floor((ms % 1000) / 10), 2);
    return out;
  }

  /* ---- Stopwatch: counts up. Persists accumulated time + a start
     timestamp (not per-second writes) so it stays right across reloads. ---- */
  function stopwatchMs(w) {
    const live = w.running && w.startedAt ? (Date.now() - w.startedAt) : 0;
    return (w.accumMs || 0) + live;
  }
  function renderStopwatchWidget(w) {
    const titleHtml = `<span class="widget-title">Stopwatch</span>`;
    const { card, header } = widgetShell(w, ICONS.clock, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body timer-body');
    body.innerHTML = `
      <div class="timer-display" data-timer-display></div>
      <div class="timer-actions">
        <button class="mini-btn" data-act="toggle">${w.running ? 'Pause' : 'Start'}</button>
        <button class="mini-btn" data-act="reset">Reset</button>
      </div>`;
    body.querySelector('[data-act=toggle]').onclick = async () => {
      if (w.running) {
        await DB.updateWidget(w.id, { running: false, accumMs: stopwatchMs(w) });
      } else {
        await DB.updateWidget(w.id, { running: true, startedAt: Date.now() });
      }
      await reload();
    };
    body.querySelector('[data-act=reset]').onclick = async () => {
      await DB.updateWidget(w.id, { running: false, startedAt: null, accumMs: 0 });
      await reload();
    };
    card.appendChild(body);
    updateStopwatchNode(card, w);
    return card;
  }
  function updateStopwatchNode(card, w) {
    const elDisplay = card.querySelector('[data-timer-display]');
    if (elDisplay) elDisplay.textContent = formatMs(stopwatchMs(w), !!w.showMs);
  }

  /* ---- Timer: counts down from a set duration. Stores remaining time when
     paused plus a start timestamp, so it stays correct across reloads and a
     pause always resumes from the right remaining amount. ---- */
  function timerRemainingMs(w) {
    const live = w.running && w.startedAt ? (Date.now() - w.startedAt) : 0;
    return Math.max(0, (w.remainingMs || 0) - live);
  }
  function renderTimerWidget(w) {
    const titleHtml = `<span class="widget-title">Timer</span>`;
    const { card, header } = widgetShell(w, ICONS.clock, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body timer-body');
    body.innerHTML = `
      <div class="timer-display" data-timer-display></div>
      <div class="timer-actions">
        <button class="mini-btn" data-act="toggle">${w.running ? 'Pause' : 'Start'}</button>
        <button class="mini-btn" data-act="reset">Reset</button>
      </div>`;
    body.querySelector('[data-act=toggle]').onclick = async () => {
      if (w.running) {
        await DB.updateWidget(w.id, { running: false, remainingMs: timerRemainingMs(w) });
      } else {
        await DB.updateWidget(w.id, { running: true, startedAt: Date.now() });
      }
      await reload();
    };
    body.querySelector('[data-act=reset]').onclick = async () => {
      await DB.updateWidget(w.id, { running: false, startedAt: null, remainingMs: (w.durationSec || 0) * 1000 });
      await reload();
    };
    card.appendChild(body);
    updateTimerNode(card, w);
    return card;
  }
  function updateTimerNode(card, w) {
    const elDisplay = card.querySelector('[data-timer-display]');
    if (!elDisplay) return;
    const ms = timerRemainingMs(w);
    elDisplay.textContent = formatMs(ms, !!w.showMs);
    if (w.running && ms <= 0) {
      // Time's up — stop so it doesn't run negative.
      DB.updateWidget(w.id, { running: false, startedAt: null, remainingMs: 0 }).then(reload);
      playChime();
    }
  }
  function updateTimerWidgets() {
    $$('.widget').forEach(card => {
      const w = STATE.widgets[card.dataset.widgetId];
      if (w && w.type === 'timer') updateTimerNode(card, w);
      else if (w && w.type === 'stopwatch') updateStopwatchNode(card, w);
    });
  }
  function openTimerEditModal(w) {
    const body = `
      <h2>Edit Timer</h2>
      <div class="field"><label>Duration (minutes)</label><div class="search-widget-row timer-duration-row"><input type="number" min="1" max="600" id="mt-duration" class="search-widget-input" value="${Math.max(1, Math.round((w.durationSec || 60) / 60))}"></div></div>
      <div class="switch-row"><span>Show milliseconds</span><label class="switch"><input type="checkbox" id="mt-ms" ${w.showMs ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label></div>
      <div class="modal-actions">
        <button id="mt-cancel" class="mini-btn">Cancel</button>
        <button id="mt-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mt-cancel').onclick = closeModal;
      $('#mt-save').onclick = async () => {
        const durationSec = Math.max(1, parseInt($('#mt-duration').value, 10) || 1) * 60;
        await DB.updateWidget(w.id, {
          durationSec,
          remainingMs: durationSec * 1000,
          showMs: $('#mt-ms').checked,
          running: false, startedAt: null
        });
        await reload(); closeModal();
      };
    });
  }
  function openStopwatchEditModal(w) {
    const body = `
      <h2>Edit Stopwatch</h2>
      <div class="switch-row"><span>Show milliseconds</span><label class="switch"><input type="checkbox" id="ms-ms" ${w.showMs ? 'checked' : ''}><span class="switch-track"><span class="switch-thumb"></span></span></label></div>
      <div class="modal-actions">
        <button id="ms-cancel" class="mini-btn">Cancel</button>
        <button id="ms-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#ms-cancel').onclick = closeModal;
      $('#ms-save').onclick = async () => {
        await DB.updateWidget(w.id, { showMs: $('#ms-ms').checked });
        await reload(); closeModal();
      };
    });
  }

  /* ---- Weather: geocode a city name via Open-Meteo, then fetch current
     conditions. No API key needed; both endpoints are public + CORS-open. ---- */
  const WEATHER_CODES = {
    0: '☀️ Clear', 1: '🌤️ Mostly clear', 2: '⛅ Partly cloudy', 3: '☁️ Overcast',
    45: '🌫️ Fog', 48: '🌫️ Fog', 51: '🌦️ Drizzle', 53: '🌦️ Drizzle', 55: '🌦️ Drizzle',
    61: '🌧️ Light rain', 63: '🌧️ Rain', 65: '🌧️ Heavy rain', 71: '🌨️ Light snow',
    73: '🌨️ Snow', 75: '🌨️ Heavy snow', 80: '🌦️ Showers', 81: '🌦️ Showers', 82: '⛈️ Violent showers',
    95: '⛈️ Thunderstorm', 96: '⛈️ Thunderstorm', 99: '⛈️ Thunderstorm'
  };
  function renderWeatherWidget(w) {
    const titleHtml = `<span class="widget-title">${escapeHtml(w.label || 'Weather')}</span>`;
    const { card, header } = widgetShell(w, ICONS.globe, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body weather-body');
    if (!w.lat || !w.lon) {
      body.innerHTML = `<div class="empty-collection-hint">Set a location from this widget's ⋯ menu</div>`;
      card.appendChild(body);
      return card;
    }
    body.innerHTML = `<div class="empty-collection-hint">Loading…</div>`;
    card.appendChild(body);
    fetchWeather(w.lat, w.lon).then(data => {
      if (!data) { body.innerHTML = `<div class="empty-collection-hint">Couldn't load weather</div>`; return; }
      const desc = WEATHER_CODES[data.weathercode] || '—';
      body.innerHTML = `<div class="weather-temp">${Math.round(data.temperature)}°</div><div class="weather-desc">${desc}</div>`;
    });
    return card;
  }
  async function fetchWeather(lat, lon) {
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
      const json = await res.json();
      return json.current_weather || null;
    } catch { return null; }
  }
  async function geocodeCity(query) {
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`);
      const json = await res.json();
      const first = json.results && json.results[0];
      if (!first) return null;
      return { lat: first.latitude, lon: first.longitude, label: [first.name, first.admin1, first.country].filter(Boolean).join(', ') };
    } catch { return null; }
  }
  function openWeatherEditModal(w) {
    const body = `
      <h2>Set Weather location</h2>
      <div class="field"><label>City</label><input type="text" id="mwe-city" placeholder="e.g. Beirut" value="${escapeHtml(w.query || '')}"></div>
      <div class="modal-actions">
        <button id="mwe-cancel" class="mini-btn">Cancel</button>
        <button id="mwe-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mwe-cancel').onclick = closeModal;
      $('#mwe-city').focus();
      $('#mwe-save').onclick = async () => {
        const query = $('#mwe-city').value.trim();
        if (!query) { toast('Enter a city name'); return; }
        const geo = await geocodeCity(query);
        if (!geo) { toast("Couldn't find that location"); return; }
        await DB.updateWidget(w.id, { query, label: geo.label, lat: geo.lat, lon: geo.lon });
        await reload(); closeModal();
      };
    });
  }

  /* ---- RSS / Atom feed: fetches on save + on manual refresh, caches the
     parsed items on the widget itself so the board doesn't need to refetch
     every render. Arbitrary feed URLs mean arbitrary origins, so this asks
     for a one-time, scoped permission to just that feed's origin the first
     time (see manifest optional_host_permissions) rather than requesting
     broad access up front. ---- */
  function renderRssWidget(w) {
    const titleHtml = `<span class="widget-title">${escapeHtml(w.label || 'RSS Feed')}</span>`;
    const { card, header } = widgetShell(w, ICONS.globe, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body rss-body');
    if (!w.feedUrl) {
      body.innerHTML = `<div class="empty-collection-hint">Set a feed URL from this widget's ⋯ menu</div>`;
    } else if (!w.items || !w.items.length) {
      body.innerHTML = `<div class="empty-collection-hint">No items yet — try Refresh from the ⋯ menu</div>`;
    } else {
      const list = el('div', 'rss-list');
      w.items.slice(0, 8).forEach(item => {
        const row = el('div', 'rss-item');
        row.innerHTML = `<span class="rss-dot"></span><span class="rss-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>`;
        row.addEventListener('click', () => sendMsg('OPEN_URL', { url: item.link, forceNewTab: true }));
        list.appendChild(row);
      });
      body.appendChild(list);
    }
    card.appendChild(body);
    return card;
  }

  function originPatternFor(url) {
    try { return new URL(url).origin + '/*'; } catch { return null; }
  }
  function ensureFeedPermission(url) {
    // chrome.permissions.request() only works when it's called (essentially)
    // synchronously in response to a user gesture. The previous version
    // checked permissions.contains() first and only called request() inside
    // *that* callback — an extra real async round-trip — which was enough
    // to lose the click's "transient activation" and made every request
    // silently fail with granted:false. Calling request() directly, with
    // nothing async ahead of it, is what actually works.
    const pattern = originPatternFor(url);
    if (!pattern || !chrome.permissions) return Promise.resolve(true);
    return new Promise(resolve => {
      chrome.permissions.request({ origins: [pattern] }, (granted) => resolve(!!granted));
    });
  }
  async function fetchFeed(url) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      if (doc.querySelector('parsererror')) return null;
      const rssItems = Array.from(doc.querySelectorAll('item')).map(it => ({
        title: (it.querySelector('title') && it.querySelector('title').textContent) || 'Untitled',
        link: (it.querySelector('link') && it.querySelector('link').textContent) || ''
      }));
      if (rssItems.length) {
        const feedTitle = doc.querySelector('channel > title');
        return { items: rssItems.filter(i => i.link).slice(0, 10), label: feedTitle ? feedTitle.textContent : '' };
      }
      const atomEntries = Array.from(doc.querySelectorAll('entry')).map(en => {
        const linkEl = en.querySelector('link');
        return {
          title: (en.querySelector('title') && en.querySelector('title').textContent) || 'Untitled',
          link: linkEl ? (linkEl.getAttribute('href') || linkEl.textContent || '') : ''
        };
      });
      const feedTitle = doc.querySelector('feed > title');
      return { items: atomEntries.filter(i => i.link).slice(0, 10), label: feedTitle ? feedTitle.textContent : '' };
    } catch { return null; }
  }
  async function refreshRssWidget(w) {
    if (!w.feedUrl) { toast('Set a feed URL first'); return; }
    const ok = await ensureFeedPermission(w.feedUrl);
    if (!ok) { toast('Permission for that feed was not granted'); return; }
    const result = await fetchFeed(w.feedUrl);
    if (!result) { toast("Couldn't load that feed"); return; }
    await DB.updateWidget(w.id, { items: result.items, label: w.label || result.label, lastFetched: Date.now() });
    await reload();
    toast('Feed refreshed');
  }
  function openRssEditModal(w) {
    const body = `
      <h2>Set RSS/Atom feed</h2>
      <div class="field"><label>Feed URL</label><input type="url" id="mrs-url" placeholder="https://example.com/feed.xml" value="${escapeHtml(w.feedUrl || '')}"></div>
      <div class="field"><label>Display name (optional)</label><input type="text" id="mrs-label" placeholder="e.g. Tech News" value="${escapeHtml(w.label || '')}"></div>
      <div class="modal-actions">
        <button id="mrs-cancel" class="mini-btn">Cancel</button>
        <button id="mrs-save" class="primary-btn">Save &amp; fetch</button>
      </div>`;
    openModal(body, () => {
      $('#mrs-cancel').onclick = closeModal;
      $('#mrs-url').focus();
      $('#mrs-save').onclick = async () => {
        const feedUrl = $('#mrs-url').value.trim();
        if (!feedUrl) { toast('Enter a feed URL'); return; }
        const customLabel = $('#mrs-label').value.trim();
        const ok = await ensureFeedPermission(feedUrl);
        if (!ok) { toast('Permission for that feed was not granted'); return; }
        const result = await fetchFeed(feedUrl);
        if (!result) { toast("Couldn't load that feed — check the URL"); return; }
        await DB.updateWidget(w.id, { feedUrl, label: customLabel || result.label || 'RSS Feed', items: result.items, lastFetched: Date.now() });
        await reload(); closeModal();
      };
    });
  }

  function openGenericWidgetMenu(w, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    const removeLabel = w.type === 'notes' ? 'Remove Notes widget' : w.type === 'todo' ? 'Remove To-Do widget' : w.type === 'clock' ? 'Remove Clock widget' : w.type === 'search' ? 'Remove Search widget' : w.type === 'countdown' ? 'Remove Countdown widget' : w.type === 'pomodoro' ? 'Remove Pomodoro widget' : w.type === 'timer' ? 'Remove Timer widget' : w.type === 'stopwatch' ? 'Remove Stopwatch widget' : w.type === 'weather' ? 'Remove Weather widget' : w.type === 'rss' ? 'Remove RSS widget' : 'Remove widget';
    let extra = '';
    if (w.type === 'clock') {
      extra = `<div class="ws-item" data-act="fmt"><span class="mi-ic">${ICONS.clock}</span>${(w.format || '24') === '24' ? 'Switch to 12-hour' : 'Switch to 24-hour'}</div><div class="ws-item" data-act="edittz"><span class="mi-ic">${ICONS.globe}</span>Change timezone…</div><hr>`;
    } else if (w.type === 'search') {
      const engines = ['google', 'duckduckgo', 'bing'];
      const labels = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' };
      extra = `<div class="ws-item-label">Search engine</div>` + engines.map(eng =>
        `<div class="ws-item" data-engine="${eng}"><span class="mi-ic">${(w.engine || 'google') === eng ? ICONS.check : ''}</span>${labels[eng]}</div>`
      ).join('') + '<hr>';
    } else if (w.type === 'countdown') {
      extra = `<div class="ws-item" data-act="editcountdown"><span class="mi-ic">${ICONS.edit}</span>Edit countdown</div><hr>`;
    } else if (w.type === 'weather') {
      extra = `<div class="ws-item" data-act="editweather"><span class="mi-ic">${ICONS.edit}</span>Change location</div><hr>`;
    } else if (w.type === 'pomodoro') {
      extra = `<div class="ws-item" data-act="editpomodoro"><span class="mi-ic">${ICONS.edit}</span>Edit durations</div><hr>`;
    } else if (w.type === 'timer') {
      extra = `<div class="ws-item" data-act="edittimer"><span class="mi-ic">${ICONS.edit}</span>Edit timer</div><hr>`;
    } else if (w.type === 'stopwatch') {
      extra = `<div class="ws-item" data-act="editstopwatch"><span class="mi-ic">${ICONS.edit}</span>Options</div><hr>`;
    } else if (w.type === 'rss') {
      extra = `<div class="ws-item" data-act="editrss"><span class="mi-ic">${ICONS.edit}</span>Edit feed</div><div class="ws-item" data-act="refreshrss"><span class="mi-ic">${ICONS.refresh}</span>Refresh now</div><hr>`;
    }
    menu.innerHTML = `${extra.replace(/<hr>\s*$/, '')}${tintMenuItemHtml()}<hr>${widthMenuItemsHtml(w)}${heightMenuItemsHtml(w)}<hr><div class="ws-item" data-act="remove" data-danger><span class="mi-ic">${ICONS.trash2}</span>${removeLabel}</div>`;
    const close = showDropdown(menu, rect, 200);
    const fmtBtn = menu.querySelector('[data-act=fmt]');
    if (fmtBtn) fmtBtn.onclick = async () => { close(); await DB.updateWidget(w.id, { format: (w.format || '24') === '24' ? '12' : '24' }); await reload(); };
    const editTzBtn = menu.querySelector('[data-act=edittz]');
    if (editTzBtn) editTzBtn.onclick = () => { close(); openClockTzModal(w); };
    $$('[data-engine]', menu).forEach(item => {
      item.onclick = async () => { close(); await DB.updateWidget(w.id, { engine: item.dataset.engine }); await reload(); };
    });
    const editCountdownBtn = menu.querySelector('[data-act=editcountdown]');
    if (editCountdownBtn) editCountdownBtn.onclick = () => { close(); openCountdownEditModal(w); };
    const editWeatherBtn = menu.querySelector('[data-act=editweather]');
    if (editWeatherBtn) editWeatherBtn.onclick = () => { close(); openWeatherEditModal(w); };
    const editPomodoroBtn = menu.querySelector('[data-act=editpomodoro]');
    if (editPomodoroBtn) editPomodoroBtn.onclick = () => { close(); openPomodoroEditModal(w); };
    const editTimerBtn = menu.querySelector('[data-act=edittimer]');
    if (editTimerBtn) editTimerBtn.onclick = () => { close(); openTimerEditModal(w); };
    const editStopwatchBtn = menu.querySelector('[data-act=editstopwatch]');
    if (editStopwatchBtn) editStopwatchBtn.onclick = () => { close(); openStopwatchEditModal(w); };
    const editRssBtn = menu.querySelector('[data-act=editrss]');
    if (editRssBtn) editRssBtn.onclick = () => { close(); openRssEditModal(w); };
    const refreshRssBtn = menu.querySelector('[data-act=refreshrss]');
    if (refreshRssBtn) refreshRssBtn.onclick = async () => { close(); await refreshRssWidget(w); };
    wireWidthMenuItems(menu, w, close);
    wireHeightMenuItems(menu, w, close);
    wireTintMenuItem(menu, w, close);
    menu.querySelector('[data-act=remove]').onclick = async () => { close(); await DB.deleteWidget(w.id); await reload(); };
  }

  /* ---- ghost "drop a tab here to create a collection" tile ---- */
  function renderGhostWidget() {
    const ghost = el('div', 'widget-ghost');
    ghost.innerHTML = `<span class="ghost-ic">${ICONS.plus}</span><span>New collection</span>`;
    ghost.addEventListener('click', () => openCollectionModal());
    ghost.addEventListener('dragover', (e) => {
      const ok = e.dataTransfer.types.includes('application/x-tdb-tab') ||
                 e.dataTransfer.types.includes('application/x-tdb-bookmark');
      if (ok) { e.preventDefault(); ghost.classList.add('drag-over'); }
    });
    ghost.addEventListener('dragleave', () => ghost.classList.remove('drag-over'));
    ghost.addEventListener('drop', async (e) => {
      const tabData = e.dataTransfer.getData('application/x-tdb-tab');
      e.preventDefault();
      ghost.classList.remove('drag-over');
      if (tabData) {
        const tab = JSON.parse(tabData);
        const name = hostnameOf(tab.url) || 'New Collection';
        const col = await DB.createCollection(activeWorkspaceId(), name);
        await DB.createBookmark(col.id, activeWorkspaceId(), { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
        toast(`Created "${col.name}"`);
        await reload();
        sendMsg('REBUILD_MENUS');
        return;
      }
      const bookmarkId = e.dataTransfer.getData('application/x-tdb-bookmark');
      if (bookmarkId) {
        const bm = STATE.bookmarks[bookmarkId];
        if (!bm) return;
        const name = hostnameOf(bm.url) || 'New Collection';
        const col = await DB.createCollection(activeWorkspaceId(), name);
        await DB.moveBookmarks([bookmarkId], col.id);
        toast(`Created "${col.name}"`);
        await reload();
        sendMsg('REBUILD_MENUS');
      }
    });
    return ghost;
  }

  /* ============ BOOKMARK DROP INDICATORS ============ */

  function clearBmDropIndicator() {
    if (bmDropIndicator) {
      if (bmDropIndicator.classList.contains('bookmark-item') || bmDropIndicator.classList.contains('bookmark-tile')) {
        bmDropIndicator.classList.remove('drop-before', 'drop-after');
      } else {
        bmDropIndicator.remove();
      }
      bmDropIndicator = null;
    }
  }

  function getDropIndex(e, item, viewMode) {
    const isGrid = viewMode === 'grid';
    if (isGrid) {
      const rect = item.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      return e.clientX < midX ? null : 'after';
    } else {
      return e.clientY < (item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2) ? null : 'after';
    }
  }

  function showDropIndicator(e, item, viewMode) {
    if (viewMode === 'grid') {
      const rect = item.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      clearBmDropIndicator();
      bmDropIndicator = item;
      item.classList.add(before ? 'drop-before' : 'drop-after');
    } else {
      const rect = item.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      clearBmDropIndicator();
      const indicator = el('div', 'bm-drop-indicator horizontal');
      item.parentNode.insertBefore(indicator, before ? item : item.nextSibling);
      bmDropIndicator = indicator;
    }
  }

  function wireBookmarkItemDrop(item, bm, col, viewMode, listWrap) {
    item.addEventListener('dragover', (e) => {
      const hasBookmark = e.dataTransfer.types.includes('application/x-tdb-bookmark');
      const hasTab = e.dataTransfer.types.includes('application/x-tdb-tab');
      if (!hasBookmark && !hasTab) return;
      e.preventDefault();
      e.stopPropagation();
      showDropIndicator(e, item, viewMode);
    });

    item.addEventListener('drop', async (e) => {
      const tabData = e.dataTransfer.getData('application/x-tdb-tab');
      const bookmarkId = e.dataTransfer.getData('application/x-tdb-bookmark');
      if (!tabData && !bookmarkId) return;
      e.preventDefault();
      e.stopPropagation();
      const beforeOrAfter = getDropIndex(e, item, viewMode);
      clearBmDropIndicator();
      const idx = beforeOrAfter === 'after' ? Array.from(listWrap.querySelectorAll('.bookmark-tile, .bookmark-item')).indexOf(item) + 1 : Array.from(listWrap.querySelectorAll('.bookmark-tile, .bookmark-item')).indexOf(item);
      if (tabData) {
        const tab = JSON.parse(tabData);
        const created = await addBookmarkSmart(col.id, activeWorkspaceId(), { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
        if (created) {
          await DB.moveBookmarks([created.id], col.id, idx);
          toast(`Bookmarked to "${col.name}"`);
          await reload();
        }
      } else if (bookmarkId) {
        const ids = SELECTED.has(bookmarkId) && SELECTED.size > 1 ? Array.from(SELECTED) : [bookmarkId];
        const sameCol = ids.every(id => STATE.bookmarks[id] && STATE.bookmarks[id].collectionId === col.id);
        if (sameCol) {
          const bms = bookmarksForCollection(col.id).map(b => b.id);
          const others = bms.filter(id => !ids.includes(id));
          others.splice(Math.min(idx, others.length), 0, ...ids.filter(id => bms.includes(id)));
          await DB.reorderBookmarks(col.id, others);
        } else {
          await DB.moveBookmarks(ids, col.id, idx);
        }
        SELECTED.clear(); selectMode = false;
        await reload();
      }
    });
  }

  /* ============ BOOKMARKS ============ */
  function openBookmarkUrl(bm) { sendMsg('OPEN_URL', { url: bm.url }); }

  function renderBookmark(bm, viewMode, colBg, col, listWrap) {
    const isTile = viewMode === 'grid';
    const item = el('div', (isTile ? 'bookmark-tile' : 'bookmark-item') + (SELECTED.has(bm.id) ? ' selected' : ''));
    item.draggable = true;
    item.dataset.bookmarkId = bm.id;
    if (col && listWrap) wireBookmarkItemDrop(item, bm, col, viewMode, listWrap);
    const tint = bm.tintColor || colBg;
    if (tint && CU) {
      if (isTile) {
        item.style.background = `color-mix(in srgb, ${tint} 14%, transparent)`;
      } else {
        const base = getComputedStyle(document.documentElement).getPropertyValue('--sub-alt-color').trim() || '#ffffff';
        item.style.background = CU.mix(base, tint, 0.18);
      }
    }
    const fav = bm.favicon || faviconFor(bm.url);
    const tagsHtml = (bm.tags || []).slice(0, 2).map(t => `<span class="bm-tag">${escapeHtml(t)}</span>`).join('');

    if (isTile) {
      item.innerHTML = `
        ${bm.pinned ? `<span class="bm-pin-ic">${ICONS.pin}</span>` : ''}
        <button class="bm-menu-btn" data-act="menu" title="Bookmark actions">${ICONS.dots}</button>
        <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
        <div class="bm-title" title="${escapeHtml(bm.title)}">${escapeHtml(bm.title)}</div>`;
    } else {
      item.innerHTML = `
        ${selectMode ? `<input type="checkbox" class="bm-select checkbox" ${SELECTED.has(bm.id) ? 'checked' : ''}>` : ''}
        ${bm.pinned ? `<span class="bm-pin-ic">${ICONS.pin}</span>` : ''}
        <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
        <span class="bm-title" title="${escapeHtml(bm.url)}">${escapeHtml(bm.title)}</span>
        ${tagsHtml}
        <button class="bm-menu-btn" data-act="menu" title="Bookmark actions">${ICONS.dots}</button>`;
    }

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tdb-bookmark', bm.id);
      e.stopPropagation();
      item.classList.add('dragging');
      document.body.classList.add('dragging-tab');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.body.classList.remove('dragging-tab');
      clearBmDropIndicator();
    });

    item.addEventListener('click', async (e) => {
      const menuBtn = e.target.closest('[data-act=menu]');
      if (menuBtn) {
        e.preventDefault(); e.stopPropagation();
        openBookmarkMenu(bm, menuBtn.getBoundingClientRect(), item.querySelector('.bm-title'));
        return;
      }
      if (e.target.classList.contains('bm-select') || selectMode || e.shiftKey || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        toggleSelect(bm.id);
        return;
      }
      openBookmarkUrl(bm);
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openBookmarkMenu(bm, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 }, item.querySelector('.bm-title'));
    });

    return item;
  }

  function openBookmarkMenu(bm, rect, titleEl) {
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="tint"><span class="mi-ic">${ICONS.palette}</span>Background color…</div>
      <hr>
      <div class="ws-item" data-act="rename"><span class="mi-ic">${ICONS.edit}</span>Rename</div>
      <div class="ws-item" data-act="editdetails"><span class="mi-ic">${ICONS.folder}</span>Edit details…</div>
      <div class="ws-item" data-act="pin"><span class="mi-ic">${ICONS.pin}</span>${bm.pinned ? 'Unpin' : 'Pin to top'}</div>
      <hr>
      <div class="ws-item" data-act="copy"><span class="mi-ic">${ICONS.link}</span>Copy link</div>
      <div class="ws-item" data-act="newwin"><span class="mi-ic">${ICONS.externalWindow}</span>Open in new window</div>
      <div class="ws-item" data-act="dup"><span class="mi-ic">${ICONS.duplicate}</span>Duplicate</div>
      <hr>
      <div class="ws-item" data-act="delete" data-danger><span class="mi-ic">${ICONS.trash}</span>Delete</div>`;
    const close = showDropdown(menu, rect, 210);

    menu.querySelector('[data-act=rename]').onclick = () => { close(); if (titleEl) startInlineRename(bm, titleEl); };
    menu.querySelector('[data-act=editdetails]').onclick = () => { close(); openBookmarkModal(bm); };
    menu.querySelector('[data-act=pin]').onclick = async () => { close(); await DB.toggleBookmarkPin(bm.id); await reload(); };
    menu.querySelector('[data-act=tint]').onclick = () => {
      close();
      openTintPickerModal(bm.tintColor, async (color) => { await DB.updateBookmark(bm.id, { tintColor: color }); await reload(); });
    };
    menu.querySelector('[data-act=copy]').onclick = () => { close(); navigator.clipboard.writeText(bm.url); toast('Link copied'); };
    menu.querySelector('[data-act=newwin]').onclick = () => { close(); sendMsg('OPEN_URLS', { urls: [bm.url], newWindow: true }); };
    menu.querySelector('[data-act=dup]').onclick = async () => { close(); await DB.duplicateBookmark(bm.id); await reload(); };
    menu.querySelector('[data-act=delete]').onclick = () => { close(); deleteBookmarksWithUndo([bm.id]); };
  }

  /* Turns a bookmark's title into an editable field in place — Enter or
     blur saves, Escape cancels. Avoids a dblclick-to-rename gesture since
     a single click on the title already navigates to the bookmark. */
  function startInlineRename(bm, titleEl) {
    if (!titleEl || titleEl.tagName === 'INPUT') return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-rename-input';
    input.value = bm.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = async () => {
      if (done) return; done = true;
      const val = input.value.trim() || bm.url;
      if (val !== bm.title) await DB.updateBookmark(bm.id, { title: val });
      await reload();
    };
    const cancel = () => { if (done) return; done = true; reload(); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('dragstart', (e) => e.stopPropagation());
  }

  function wireCollectionDropZone(card, col, listWrap) {
    card.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-tdb-widget')) return;
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', (e) => {
      if (!card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over');
        clearBmDropIndicator();
      }
    });
    card.addEventListener('drop', async (e) => {
      card.classList.remove('drag-over');
      if (e.target.closest('.bookmark-tile, .bookmark-item')) return; // handled by per-item drop
      const tabData = e.dataTransfer.getData('application/x-tdb-tab');
      const bookmarkId = e.dataTransfer.getData('application/x-tdb-bookmark');
      if (!tabData && !bookmarkId) return;
      e.preventDefault();
      clearBmDropIndicator();

      if (tabData) {
        const tab = JSON.parse(tabData);
        const created = await addBookmarkSmart(col.id, activeWorkspaceId(), { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
        if (created) toast(`Bookmarked to "${col.name}"`);
      } else if (bookmarkId) {
        const ids = SELECTED.has(bookmarkId) && SELECTED.size > 1 ? Array.from(SELECTED) : [bookmarkId];
        await DB.moveBookmarks(ids, col.id);
        SELECTED.clear(); selectMode = false;
        await reload();
      }
    });
  }

  function sortModeLabel(mode) {
    return mode === 'alpha' ? 'A–Z' : mode === 'newest' ? 'Newest first' : mode === 'oldest' ? 'Oldest first' : 'Manual';
  }
  function applySortMode(bms, mode) {
    if (mode === 'alpha') return bms.slice().sort((a, b) => a.title.localeCompare(b.title));
    if (mode === 'newest') return bms.slice().sort((a, b) => b.createdAt - a.createdAt);
    if (mode === 'oldest') return bms.slice().sort((a, b) => a.createdAt - b.createdAt);
    return bms;
  }

  function openAllInCollection(col, newWindow) {
    const bms = applySortMode(bookmarksForCollection(col.id), col.sortMode);
    if (!bms.length) { toast('Nothing to open'); return; }
    sendMsg('OPEN_URLS', { urls: bms.map(b => b.url), newWindow });
  }

  function widgetForCollection(colId) {
    return Object.values(STATE.widgets || {}).find(w => w.type === 'collection' && w.collectionId === colId);
  }

  function openCollectionMenu(col, rect) {
    const menu = el('div', 'dropdown-menu');
    const w = widgetForCollection(col.id);

    menu.innerHTML = `
      <div class="ws-item" data-act="add"><span class="mi-ic">${ICONS.plus}</span>New bookmark here</div>
      <div class="ws-item" data-act="edit"><span class="mi-ic">${ICONS.edit}</span>Rename</div>
      ${w ? tintMenuItemHtml() : ''}
      <hr>
      <div class="ws-item" data-act="openall"><span class="mi-ic">${ICONS.openAll}</span>Open all bookmarks</div>
      <div class="ws-item" data-act="openallwin"><span class="mi-ic">${ICONS.externalWindow}</span>Open all in new window</div>
      <div class="ws-item" data-act="copylinks"><span class="mi-ic">${ICONS.copy}</span>Copy all links</div>
      <div class="ws-item" data-act="copymd"><span class="mi-ic">${ICONS.folder}</span>Copy as Markdown list</div>
      <hr>
      <div class="ws-item" data-act="sort"><span class="mi-ic">${ICONS.sort}</span>Sort: ${sortModeLabel(col.sortMode)}</div>
      <div class="ws-item" data-act="dup"><span class="mi-ic">${ICONS.duplicate}</span>Duplicate collection</div>
      <div class="ws-item" data-act="movews"><span class="mi-ic">${ICONS.externalWindow}</span>Move to workspace…</div>
      <div class="ws-item" data-act="merge"><span class="mi-ic">${ICONS.layers}</span>Merge into…</div>
      <div class="ws-item" data-act="select"><span class="mi-ic">${ICONS.checkSquare}</span>Select bookmarks</div>
      <hr>
      ${viewMenuItemsHtml(col)}
      ${w ? `<hr>${widthMenuItemsHtml(w)}${heightMenuItemsHtml(w)}` : ''}
      <hr>
      <div class="ws-item" data-act="delete" data-danger><span class="mi-ic">${ICONS.trash}</span>Delete collection</div>`;
    const close = showDropdown(menu, rect, 230);
    if (w) wireWidthMenuItems(menu, w, close);
    if (w) wireHeightMenuItems(menu, w, close);
    if (w) wireTintMenuItem(menu, w, close);
    wireViewMenuItems(menu, col, close);
    menu.querySelector('[data-act=add]').onclick = () => { close(); openBookmarkModal(null, col.id); };
    menu.querySelector('[data-act=edit]').onclick = () => { close(); openRenameCollectionModal(col); };
    menu.querySelector('[data-act=select]').onclick = () => { close(); selectMode = true; renderBoard(); };
    menu.querySelector('[data-act=dup]').onclick = async () => { close(); await DB.duplicateCollection(col.id); await reload(); toast('Collection duplicated'); };
    menu.querySelector('[data-act=movews]').onclick = () => { close(); openMoveCollectionPicker(col); };
    menu.querySelector('[data-act=openall]').onclick = () => { close(); openAllInCollection(col, false); };
    menu.querySelector('[data-act=openallwin]').onclick = () => { close(); openAllInCollection(col, true); };
    menu.querySelector('[data-act=copylinks]').onclick = () => {
      close();
      const bms = bookmarksForCollection(col.id);
      navigator.clipboard.writeText(bms.map(b => b.url).join('\n')).then(() => toast(`Copied ${bms.length} link${bms.length === 1 ? '' : 's'}`));
    };
    menu.querySelector('[data-act=copymd]').onclick = () => {
      close();
      const bms = bookmarksForCollection(col.id);
      const md = bms.map(b => `- [${(b.title || b.url).replace(/[[\]]/g, '')}](${b.url})`).join('\n');
      navigator.clipboard.writeText(md).then(() => toast(`Copied "${col.name}" as Markdown`));
    };
    menu.querySelector('[data-act=merge]').onclick = () => { close(); openMergeCollectionPicker(col); };
    menu.querySelector('[data-act=sort]').onclick = async () => {
      close();
      const order = ['manual', 'alpha', 'newest', 'oldest'];
      const next = order[(order.indexOf(col.sortMode) + 1) % order.length];
      await DB.setCollectionSortMode(col.id, next);
      await reload();
      toast(`Sorted: ${sortModeLabel(next)}`);
    };
    menu.querySelector('[data-act=delete]').onclick = async () => {
      close();
      await DB.softDeleteCollection(col.id);
      toast(`Deleted "${col.name}"`, 'View trash', () => openTrashPanel());
      await reload();
      sendMsg('REBUILD_MENUS');
    };
  }

  function openMoveCollectionPicker(sourceCol) {
    const currentWsId = activeWorkspaceId();
    const wsList = Object.values(STATE.workspaces).sort((a, b) => a.order - b.order);
    const opts = wsList.map(ws => {
      const self = ws.id === currentWsId;
      return `<option value="${ws.id}"${self ? ' disabled' : ''}>${escapeHtml(ws.name)}${self ? ' (current)' : ''}</option>`;
    }).join('');
    const body = `
      <h2>Move "${escapeHtml(sourceCol.name)}"</h2>
      <p style="color:var(--sub-color);font-size:13px;margin-top:-6px">
        The collection and its bookmarks move to the workspace's board, and the dashboard switches to it.
      </p>
      <div class="field"><label>Move to</label>
        <select id="movews-target"><option value="__new__">＋ New workspace…</option>${opts}</select>
      </div>
      <div class="field" id="movews-name-field" style="display:none"><label>New workspace name</label><input type="text" id="movews-name" value="${escapeHtml(sourceCol.name)}"></div>
      <div class="modal-actions">
        <button id="movews-cancel" class="mini-btn">Cancel</button>
        <button id="movews-confirm" class="primary-btn">Move</button>
      </div>`;
    openModal(body, () => {
      const sel = $('#movews-target');
      const nameField = $('#movews-name-field');
      const nameInput = $('#movews-name');
      const toggleName = () => { nameField.style.display = sel.value === '__new__' ? 'block' : 'none'; };
      sel.addEventListener('change', toggleName);
      toggleName();
      $('#movews-cancel').onclick = closeModal;
      $('#movews-confirm').onclick = async () => {
        const targetWsId = sel.value;
        let wsName;
        if (targetWsId === '__new__') {
          wsName = (nameInput.value || '').trim();
          if (!wsName) return;
          const created = await DB.createWorkspace(wsName);
          await DB.moveCollectionToWorkspace(sourceCol.id, created.id);
        } else {
          await DB.moveCollectionToWorkspace(sourceCol.id, targetWsId);
        }
        closeModal();
        toast(`Moved "${sourceCol.name}"`);
        await reload();
        sendMsg('REBUILD_MENUS');
      };
    });
  }

  function openMergeCollectionPicker(sourceCol) {
    const targets = collectionsForActiveWS().filter(c => c.id !== sourceCol.id);
    if (!targets.length) { toast('No other collection to merge into'); return; }
    const body = `
      <h2>Merge "${escapeHtml(sourceCol.name)}"</h2>
      <p style="color:var(--sub-color);font-size:13px;margin-top:-6px">
        All bookmarks move into the collection you pick, then "${escapeHtml(sourceCol.name)}" is deleted.
      </p>
      <div class="field"><label>Merge into</label>
        <select id="merge-target">${targets.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="modal-actions">
        <button id="merge-cancel" class="mini-btn">Cancel</button>
        <button id="merge-confirm" class="primary-btn">Merge</button>
      </div>`;
    openModal(body, () => {
      $('#merge-cancel').onclick = closeModal;
      $('#merge-confirm').onclick = async () => {
        const targetId = $('#merge-target').value;
        const targetCol = STATE.collections[targetId];
        const bms = bookmarksForCollection(sourceCol.id);
        if (bms.length) await DB.moveBookmarks(bms.map(b => b.id), targetId);
        await DB.softDeleteCollection(sourceCol.id);
        closeModal();
        toast(`Merged into "${targetCol.name}"`);
        await reload();
        sendMsg('REBUILD_MENUS');
      };
    });
  }

  function openCollectionModal(existing) {
    const existingWidget = existing ? widgetForCollection(existing.id) : null;
    const body = `
      <h2>${existing ? 'Rename / recolor' : 'New Collection'}</h2>
      <div class="field"><label>Name</label><input type="text" id="mc-name" value="${existing ? escapeHtml(existing.name) : ''}"></div>
      <div class="field"><label>Color</label><div class="color-picker" id="mc-colors"></div></div>
      <div class="modal-actions">
        <button id="mc-cancel" class="mini-btn">Cancel</button>
        <button id="mc-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      // "Default" (no tint) is the actual default for new collections — the
      // color picker here controls the widget's real, visible background
      // tint, not the old unused collection.color field.
      renderColorPicker('#mc-colors', existingWidget ? existingWidget.tintColor : null, true);
      $('#mc-cancel').onclick = closeModal;
      $('#mc-name').focus();
      $('#mc-save').onclick = async () => {
        const name = $('#mc-name').value.trim() || 'Untitled';
        const swatch = $('#mc-colors .selected');
        const tintColor = swatch && swatch.dataset.color ? swatch.dataset.color : null;
        if (existing) {
          await DB.updateCollection(existing.id, { name });
          if (existingWidget) await DB.updateWidget(existingWidget.id, { tintColor });
        } else {
          const col = await DB.createCollection(activeWorkspaceId(), name);
          if (tintColor) {
            const fresh = await DB.getState();
            const w = Object.values(fresh.widgets).find(x => x.type === 'collection' && x.collectionId === col.id);
            if (w) await DB.updateWidget(w.id, { tintColor });
          }
        }
        await reload(); closeModal();
        sendMsg('REBUILD_MENUS');
      };
    });
  }

  function openRenameCollectionModal(col) {
    const body = `
      <h2>Rename collection</h2>
      <div class="field"><label>Name</label><input type="text" id="mc-name" value="${escapeHtml(col.name)}"></div>
      <div class="modal-actions">
        <button id="mc-cancel" class="mini-btn">Cancel</button>
        <button id="mc-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mc-cancel').onclick = closeModal;
      $('#mc-name').focus();
      $('#mc-name').select();
      $('#mc-save').onclick = async () => {
        const name = $('#mc-name').value.trim() || 'Untitled';
        await DB.updateCollection(col.id, { name });
        await reload(); closeModal();
        sendMsg('REBUILD_MENUS');
      };
    });
  }

  function openBookmarkModal(existing, defaultCollectionId) {
    const cols = collectionsForActiveWS();
    const options = cols.map(c => `<option value="${c.id}" ${((existing ? existing.collectionId : defaultCollectionId) === c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
    const body = `
      <h2>${existing ? 'Edit Bookmark' : 'Add Bookmark'}</h2>
      <div class="field"><label>URL</label><input type="url" id="mb-url" placeholder="https://example.com" value="${existing ? escapeHtml(existing.url) : ''}"></div>
      <div class="field"><label>Title</label><input type="text" id="mb-title" value="${existing ? escapeHtml(existing.title) : ''}"></div>
      <div class="field"><label>Collection</label><select id="mb-collection">${options}</select></div>
      <div class="field"><label>Tags (comma separated)</label><input type="text" id="mb-tags" value="${existing ? escapeHtml((existing.tags || []).join(', ')) : ''}"></div>
      <div class="field"><label>Notes</label><textarea id="mb-notes">${existing ? escapeHtml(existing.notes || '') : ''}</textarea></div>
      <div class="modal-actions">
        <button id="mb-cancel" class="mini-btn">Cancel</button>
        <button id="mb-save" class="primary-btn">Save</button>
      </div>`;
    openModal(body, () => {
      $('#mb-cancel').onclick = closeModal;
      $('#mb-url').focus();
      $('#mb-save').onclick = async () => {
        const url = $('#mb-url').value.trim();
        if (!url) { toast('URL is required'); return; }
        const title = $('#mb-title').value.trim() || url;
        const collectionId = $('#mb-collection').value;
        const tags = $('#mb-tags').value.split(',').map(t => t.trim()).filter(Boolean);
        const notes = $('#mb-notes').value;
        if (existing) {
          await DB.updateBookmark(existing.id, { title, url, tags, notes });
          if (collectionId !== existing.collectionId) await DB.moveBookmarks([existing.id], collectionId);
        } else {
          const dupe = findExistingBookmark(url);
          if (dupe) {
            const dupeCol = STATE.collections[dupe.collectionId];
            if (!confirm(`This is already saved in "${dupeCol ? dupeCol.name : 'another collection'}". Add it again anyway?`)) return;
          }
          await DB.createBookmark(collectionId, activeWorkspaceId(), { title, url, tags, notes });
        }
        await reload(); closeModal();
      };
    });
  }

  function renderColorPicker(selector, selectedColor, allowNone) {
    const wrap = $(selector);
    wrap.innerHTML = '';
    if (allowNone) {
      const none = el('div', 'color-swatch color-swatch-none' + (!selectedColor ? ' selected' : ''));
      none.title = 'Default (no tint)';
      none.dataset.color = '';
      none.onclick = () => { $$('.color-swatch', wrap).forEach(x => x.classList.remove('selected')); none.classList.add('selected'); };
      wrap.appendChild(none);
    }
    Themes.COLLECTION_COLORS.forEach(c => {
      const sw = el('div', 'color-swatch' + (c === selectedColor ? ' selected' : ''));
      sw.style.background = c;
      sw.dataset.color = c;
      sw.onclick = () => { $$('.color-swatch', wrap).forEach(x => x.classList.remove('selected')); sw.classList.add('selected'); };
      wrap.appendChild(sw);
    });
  }

  /* ============ SELECTION / BULK ACTIONS ============ */
  function toggleSelect(id) {
    if (SELECTED.has(id)) SELECTED.delete(id); else SELECTED.add(id);
    selectMode = SELECTED.size > 0;
    renderBoard();
  }
  function updateBulkBar() {
    const bar = $('#bulk-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', SELECTED.size === 0);
    $('#bulk-count').textContent = `${SELECTED.size} selected`;
  }
  async function deleteBookmarksWithUndo(ids) {
    if (STATE.meta.settings.confirmDelete && !confirm(`Delete ${ids.length} bookmark${ids.length === 1 ? '' : 's'}?`)) return;
    await DB.softDeleteBookmarks(ids);
    SELECTED.clear(); selectMode = false;
    toast(`Deleted ${ids.length} bookmark${ids.length === 1 ? '' : 's'}`, 'View trash', () => openTrashPanel());
    await reload();
  }

  /* ============ NAV ============ */
  function switchNav(nav) {
    currentNav = nav;
    $('#nav-collections-btn').classList.toggle('active', nav === 'collections');
    $('#nav-sessions-btn').classList.toggle('active', nav === 'sessions');
    $('#view-collections').classList.toggle('hidden', nav !== 'collections');
    $('#view-sessions').classList.toggle('hidden', nav !== 'sessions');
    if (nav === 'collections') renderBoard(); else renderSessionsPage();
  }

  /* ============ SESSIONS ============ */
  async function saveWindowSession() {
    const res = await sendMsg('GET_OPEN_TABS');
    const tabs = (res && res.tabs) || [];
    if (!tabs.length) { toast('No tabs to save'); return; }
    const name = prompt('Session name', `Session ${new Date().toLocaleString()}`);
    if (name === null) return;
    await DB.createSession(activeWorkspaceId(), name, tabs, false);
    toast('Session saved');
    await reload();
  }
  async function saveAllWindowsSession() {
    const res = await sendMsg('GET_ALL_TABS');
    const tabs = (res && res.tabs) || [];
    if (!tabs.length) { toast('No tabs to save'); return; }
    const winCount = new Set(tabs.map(t => t.windowId)).size;
    const name = prompt('Session name', `All windows — ${new Date().toLocaleString()}`);
    if (name === null) return;
    await DB.createSession(activeWorkspaceId(), name, tabs, winCount > 1, winCount);
    toast('Session saved');
    await reload();
  }

  function renderSessionsPage() {
    const grid = $('#sessions-grid');
    grid.innerHTML = '';
    const q = filterQueryFor.sessions.trim().toLowerCase();
    const sessions = sessionsForActiveWS().filter(s => !q || s.name.toLowerCase().includes(q));
    let totalTabs = 0;

    sessions.forEach(s => {
      totalTabs += s.tabs.length;
      const card = el('div', 'session-card');
      const favs = s.tabs.slice(0, 6).map(t => `<img src="${t.favicon || faviconFor(t.url)}" onerror="this.style.visibility='hidden'">`).join('');
      const preview = s.tabs.slice(0, 4).map(t => escapeHtml(t.title || t.url)).join(' · ');
      card.innerHTML = `
        <div class="session-card-top">
          <span class="session-card-title" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
          <button class="widget-menu-btn" data-act="menu">${ICONS.dots}</button>
        </div>
        <div class="session-card-meta">${s.tabs.length} tab${s.tabs.length === 1 ? '' : 's'}${s.multiWindow ? ` · ${s.windowCount} windows` : ''} · ${new Date(s.createdAt).toLocaleDateString()}</div>
        <div class="session-favicons">${favs}</div>
        <div class="session-tab-preview">${preview}${s.tabs.length > 4 ? `<br>+${s.tabs.length - 4} more…` : ''}</div>
        <div class="session-card-actions">
          <button class="mini-btn" data-act="restore-here">${icon('save', 'sm')} This window</button>
          <button class="mini-btn" data-act="restore-new">${icon('externalWindow', 'sm')} New window</button>
        </div>`;
      const restoreHereBtn = card.querySelector('[data-act=restore-here]');
      const restoreNewBtn = card.querySelector('[data-act=restore-new]');
      const runRestore = async (btn, newWindow) => {
        if (btn.disabled) return;
        btn.disabled = true;
        const original = btn.innerHTML;
        btn.innerHTML = `${icon('refresh', 'sm')} Restoring…`;
        const res = await sendMsg('RESTORE_SESSION', { tabs: s.tabs, newWindow });
        btn.disabled = false;
        btn.innerHTML = original;
        if (res && res.ok) toast(newWindow ? 'Session restored in new window' : 'Session restored');
        else toast(`Couldn't restore session${res && res.error ? `: ${res.error}` : ''}`);
      };
      restoreHereBtn.onclick = () => runRestore(restoreHereBtn, false);
      restoreNewBtn.onclick = () => runRestore(restoreNewBtn, true);
      card.querySelector('[data-act=menu]').onclick = (e) => openSessionMenu(s, e.currentTarget);
      grid.appendChild(card);
    });

    if (!sessions.length) grid.appendChild(el('div', 'empty-collection-hint', q ? 'No sessions match your filter.' : 'No saved sessions yet — save your open tabs above.'));
    $('#sessions-summary').textContent = sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${totalTabs} tabs total` : '';
  }

  function openSessionMenu(s, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="rename"><span class="mi-ic">${ICONS.edit}</span>Rename</div>
      <div class="ws-item" data-act="dup"><span class="mi-ic">${ICONS.duplicate}</span>Duplicate</div>
      <div class="ws-item" data-act="tocol"><span class="mi-ic">${ICONS.layers}</span>Convert to collection</div>
      <div class="ws-item" data-act="copylinks"><span class="mi-ic">${ICONS.copy}</span>Copy all links</div>
      <hr>
      <div class="ws-item" data-act="delete" data-danger><span class="mi-ic">${ICONS.trash}</span>Delete session</div>`;
    const close = showDropdown(menu, rect, 220);
    menu.querySelector('[data-act=rename]').onclick = async () => {
      close();
      const name = prompt('Session name', s.name);
      if (name) { await DB.renameSession(s.id, name); await reload(); }
    };
    menu.querySelector('[data-act=dup]').onclick = async () => { close(); await DB.duplicateSession(s.id); await reload(); };
    menu.querySelector('[data-act=tocol]').onclick = async () => {
      close();
      const name = prompt('New collection name', s.name);
      if (name === null) return;
      await DB.convertSessionToCollection(s.id, name);
      toast(`Created collection "${name}"`);
      await reload();
      sendMsg('REBUILD_MENUS');
    };
    menu.querySelector('[data-act=copylinks]').onclick = () => {
      close();
      navigator.clipboard.writeText(s.tabs.map(t => t.url).join('\n')).then(() => toast(`Copied ${s.tabs.length} link${s.tabs.length === 1 ? '' : 's'}`));
    };
    menu.querySelector('[data-act=delete]').onclick = async () => {
      close();
      if (!confirm(`Delete session "${s.name}"?`)) return;
      await DB.deleteSession(s.id);
      await reload();
    };
  }

  /* ============ MODAL / PALETTE plumbing ============ */
  function openModal(html, afterMount) {
    $('#modal-box').innerHTML = html;
    $('#modal-overlay').classList.remove('hidden');
    afterMount && afterMount();
  }
  function closeModal() { $('#modal-overlay').classList.add('hidden'); }

  function openPalette() {
    $('#palette-overlay').classList.remove('hidden');
    const input = $('#palette-input');
    input.value = ''; input.focus();
    resetPaletteNav();
    renderPaletteResults('');
  }
  function closePalette() { endThemePreview(); $('#palette-overlay').classList.add('hidden'); }

  /* Registry of every user-facing setting so the command palette can expose
     them all: each setting becomes a "cycle" command plus one command per
     option. `set(value)` returns a settings patch; `get(s)` reads the current
     value. Adding a new setting here automatically makes it palette-driven. */
  const PALETTE_SETTINGS = [
    { id: 'density', label: 'Density', get: s => s.density, set: v => ({ density: v }), options: [
      { label: 'Comfortable', value: 'comfortable' }, { label: 'Compact', value: 'compact' } ] },
    { id: 'viewMode', label: 'Bookmark view', get: s => s.viewMode, set: v => ({ viewMode: v }), options: [
      { label: 'Tiles', value: 'grid' }, { label: 'Rows', value: 'list' } ] },
    { id: 'columns', label: 'Board width', get: s => (s.dashboard && s.dashboard.columns) || 4, set: v => ({ dashboard: { columns: v } }), options: [
      { label: '3 columns', value: 3 }, { label: '4 columns', value: 4 }, { label: '5 columns', value: 5 }, { label: '6 columns', value: 6 } ] },
    { id: 'sidebarCollapsed', label: 'Sidebar collapsed', get: s => !!s.sidebarCollapsed, set: v => ({ sidebarCollapsed: v }), options: [
      { label: 'Expanded', value: false }, { label: 'Collapsed', value: true } ] },
    { id: 'sidebarCompact', label: 'Sidebar compact', get: s => !!s.sidebarCompact, set: v => ({ sidebarCompact: v }), options: [
      { label: 'Off', value: false }, { label: 'Icons only', value: true } ] },
    { id: 'animations', label: 'Animations', get: s => s.animations !== false, set: v => ({ animations: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'confirmDelete', label: 'Confirm before delete', get: s => s.confirmDelete !== false, set: v => ({ confirmDelete: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'openBookmarksInNewTab', label: 'Open bookmarks in new tab', get: s => !!s.openBookmarksInNewTab, set: v => ({ openBookmarksInNewTab: v }), options: [
      { label: 'Off (same tab)', value: false }, { label: 'On (new tab)', value: true } ] },
    { id: 'faviconSource', label: 'Favicon source', get: s => s.faviconSource, set: v => ({ faviconSource: v }), options: [
      { label: 'Google', value: 'google' }, { label: 'DuckDuckGo', value: 'duckduckgo' }, { label: 'None', value: 'none' } ] },
    { id: 'groupPinned', label: 'Group pinned tabs', get: s => !(s.tabsList && s.tabsList.groupPinned === false), set: v => ({ tabsList: { groupPinned: v } }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'dimInactive', label: 'Dim unloaded tabs', get: s => !(s.tabsList && s.tabsList.dimInactive === false), set: v => ({ tabsList: { dimInactive: v } }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'inactiveGrayscale', label: 'Grayscale unloaded tabs', get: s => !(s.tabsList && s.tabsList.inactiveGrayscale === false), set: v => ({ tabsList: { inactiveGrayscale: v } }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'inactiveOpacity', label: 'Inactive tab opacity', get: s => (s.tabsList && s.tabsList.inactiveOpacity) ?? 55, set: v => ({ tabsList: { inactiveOpacity: v } }), options: [
      { label: 'Faint (35%)', value: 35 }, { label: 'Dim (55%)', value: 55 }, { label: 'Subtle (75%)', value: 75 }, { label: 'Off (100%)', value: 100 } ] }
  ];
  const PALETTE_SETTINGS_BY_ID = Object.fromEntries(PALETTE_SETTINGS.map(d => [d.id, d]));

  /* The palette is a navigable tree: root → Themes / Settings groups → options.
     Searching flattens every leaf so "change anything by typing" still works. */
  const PALETTE_SETTING_GROUPS = [
    { name: 'Appearance', keys: ['density', 'animations'] },
    { name: 'Layout', keys: ['viewMode', 'columns', 'sidebarCollapsed', 'sidebarCompact'] },
    { name: 'Behavior', keys: ['confirmDelete', 'openBookmarksInNewTab', 'faviconSource', 'groupPinned', 'dimInactive', 'inactiveGrayscale', 'inactiveOpacity'] }
  ];

  function themeChipColors(t) { return [t.bg, t.main, t.caret, t.sub, t.subAlt, t.text]; }

  function paletteThemeItems() {
    const s = STATE.meta.settings;
    const cur = s.themeId;
    const light = Themes.resolveTheme('serika');
    const dark = Themes.resolveTheme('serika_dark');
    const items = [{
      kind: 'theme', label: 'Auto (follow system)', themeId: 'auto',
      chips: [light.bg, light.main, light.text, dark.bg, dark.main, dark.text],
      value: cur === 'auto' ? 'Active' : '', run: () => selectTheme('auto')
    }];
    Themes.PRESET_THEMES.forEach(t => {
      items.push({
        kind: 'theme', label: t.name, themeId: t.id, chips: themeChipColors(t),
        value: cur === t.id ? 'Active' : '', run: () => selectTheme(t.id)
      });
    });
    return items;
  }

  function paletteSettingOptions(def) {
    const s = STATE.meta.settings;
    const cur = def.get(s);
    return def.options.map(o => ({
      kind: 'setting', label: o.label, value: o.value === cur ? 'Active' : '', select: true,
      run: async () => { await DB.updateSettings(def.set(o.value)); }
    }));
  }

  function paletteSettingItem(def) {
    const s = STATE.meta.settings;
    const cur = def.get(s);
    const idx = def.options.findIndex(o => o.value === cur);
    return {
      kind: 'folder', label: def.label, value: idx >= 0 ? def.options[idx].label : String(cur),
      children: paletteSettingOptions(def)
    };
  }

  function paletteRootItems() {
    const cmds = [
      { kind: 'action', label: 'New Collection', run: () => openCollectionModal() },
      { kind: 'action', label: 'Add Notes widget', run: () => addWidget('notes') },
      { kind: 'action', label: 'Add To-Do widget', run: () => addWidget('todo') },
      { kind: 'action', label: 'Add Clock widget', run: () => addWidget('clock') },
      { kind: 'action', label: 'Add Search widget', run: () => addWidget('search') },
      { kind: 'action', label: 'Add Countdown widget', run: () => addWidget('countdown') },
      { kind: 'action', label: 'Add Pomodoro widget', run: () => addWidget('pomodoro') },
      { kind: 'action', label: 'Add Timer widget', run: () => addWidget('timer') },
      { kind: 'action', label: 'Add Stopwatch widget', run: () => addWidget('stopwatch') },
      { kind: 'action', label: 'Add Weather widget', run: () => addWidget('weather') },
      { kind: 'action', label: 'Add RSS feeds widget', run: () => addWidget('rss') },
      { kind: 'action', label: 'New Workspace', run: () => openWorkspaceModal() },
      { kind: 'action', label: 'New Board', run: () => newBoardFromPalette() },
      { kind: 'action', label: 'Save current tabs as session', run: saveWindowSession },
      { kind: 'action', label: 'Open Settings', run: openSettings },
      { kind: 'action', label: 'Open Trash', run: () => openTrashPanel() },
      { kind: 'action', label: 'Show keyboard shortcuts', run: openShortcuts },
      { kind: 'action', label: 'Toggle sidebar', run: toggleSidebar },
      { kind: 'action', label: 'Toggle grid / list view', run: toggleViewMode },
      { kind: 'action', label: 'Go to Collections', run: () => switchNav('collections') },
      { kind: 'action', label: 'Go to Sessions', run: () => switchNav('sessions') }
    ];
    Object.values(STATE.workspaces).sort((a, b) => a.order - b.order).forEach(ws => {
      cmds.push({ kind: 'action', label: `Go to workspace · ${ws.name}`, run: () => jumpToWorkspace(ws.id) });
    });
    boardsForActiveWS().forEach(board => {
      cmds.push({ kind: 'action', label: `Go to board · ${board.name}`, run: () => jumpToBoard(board.id) });
    });
    cmds.push(
      { kind: 'folder', label: 'Themes', children: paletteThemeItems() },
      { kind: 'folder', label: 'Settings', children: PALETTE_SETTING_GROUPS.map(g => ({
        kind: 'folder', label: g.name, children: g.keys.map(k => paletteSettingItem(PALETTE_SETTINGS_BY_ID[k]))
      })) }
    );
    return cmds;
  }

  /* ---------- Palette navigation (tree) ---------- */
  let palNav = [];           // stack of { title, items } — empty = root level
  function paletteLevel() { return palNav.length ? palNav[palNav.length - 1].items : paletteRootItems(); }

  function paletteCrumbHtml() {
    if (palNav.length === 0) return '';
    const trail = palNav.map((n, i) => `<span class="crumb-seg" data-i="${i}">${escapeHtml(n.title)}</span>`).join('<span class="crumb-sep">›</span>');
    return `<span class="crumb-seg" data-i="-1">All</span><span class="crumb-sep">›</span>${trail}`;
  }

  function renderPaletteCrumb() {
    const crumb = $('#palette-crumb');
    if (!$('#palette-input').value.trim() && palNav.length) {
      crumb.classList.remove('hidden');
      crumb.innerHTML = paletteCrumbHtml();
      $$('.crumb-seg[data-i]', crumb).forEach(c => c.onclick = () => {
        palNav.length = parseInt(c.dataset.i, 10) + 1;
        paletteIndex = 0;
        renderPaletteResults('');
      });
    } else {
      crumb.classList.add('hidden');
    }
  }

  function pushPaletteNav(folder) {
    palNav.push({ title: folder.label, items: folder.children || [] });
    $('#palette-input').value = '';
    paletteIndex = 0;
    renderPaletteResults('');
  }
  function popPaletteNav() {
    if (!palNav.length) return false;
    palNav.pop();
    paletteIndex = 0;
    renderPaletteResults('');
    return true;
  }
  function resetPaletteNav() { palNav = []; paletteIndex = 0; }

  async function selectTheme(themeId) {
    commitThemePreview();
    await DB.updateSettings({ themeId });
  }

  async function newBoardFromPalette() {
    const name = prompt('New board name', `Board ${boardsForActiveWS().length + 1}`);
    if (!name) return;
    const created = await DB.createBoard(activeWorkspaceId(), name);
    await DB.setActiveBoard(activeWorkspaceId(), created.id);
    await reload();
  }
  async function jumpToWorkspace(wsId) {
    await DB.setActiveWorkspace(wsId);
    await reload();
  }
  async function jumpToBoard(boardId) {
    if (boardsForActiveWS().some(b => b.id === boardId)) {
      await DB.setActiveBoard(activeWorkspaceId(), boardId);
      await reload();
    }
  }


  let paletteItems = [];
  let paletteIndex = 0;
  let paletteWheelAt = 0;
  let paletteXPrimed = false;

  function scrollPaletteActiveIntoView() {
    const active = $$('.palette-item')[paletteIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function paletteStageEscape() {
    if ($('.palette-item.active')) {
      endThemePreview();
      $$('.palette-item').forEach(r => r.classList.remove('active'));
      highlightPalette($$('.palette-item'), -1);
      return true;
    }
    closePalette();
    return false;
  }

  function renderPaletteResults(query) {
    const results = $('#palette-results');
    results.innerHTML = '';
    const q = query.trim();

    let all;
    if (q) {
      // Search filters only the current level — at the root that surfaces
      // group options like Themes/Settings, not a flattened "public search".
      const scored = [];
      for (const c of paletteLevel()) {
        const s = fuzzyScore(q, c.label);
        if (s < 0) continue;
        scored.push({ ...c, score: s + (c.children ? 3 : 0) });
      }
      // The palette promises "jump to a bookmark", so surface matching
      // bookmarks from every collection (title and URL both count).
      // Deduplicated by full URL so the same link never shows twice.
      const seenUrls = new Set();
      Object.values(STATE.bookmarks).forEach(bm => {
        const urlKey = bm.url.trim().toLowerCase();
        if (!urlKey || seenUrls.has(urlKey)) return;
        seenUrls.add(urlKey);
        const s = Math.max(fuzzyScore(q, bm.title || ''), fuzzyScore(q, bm.url || ''));
        if (s < 0) return;
        scored.push({
          kind: 'bookmark',
          label: bm.title || bm.url,
          favicon: bm.favicon || '',
          swatch: bm.tintColor || undefined,
          run: () => openBookmarkUrl(bm),
          score: s
        });
      });
      scored.sort((a, b) => b.score - a.score);
      all = scored.slice(0, 24);
    } else {
      // Browse mode: render the current tree level (+ a few open tabs at root).
      const level = paletteLevel();
      all = [...level];
      if (!palNav.length) {
        OPEN_TABS.slice(0, 5).forEach(t => all.push({ kind: 'tab', label: t.title || t.url, run: () => sendMsg('FOCUS_TAB', { tabId: t.id }) }));
      }
    }
    renderPaletteCrumb();

    if (!all.length) { paletteItems = []; results.appendChild(el('div', 'palette-empty', 'No matches')); return; }

    paletteItems = all;
    paletteIndex = Math.min(paletteIndex, all.length - 1);
    all.forEach((item, i) => {
      const row = el('div', 'palette-item' + (i === paletteIndex ? ' active' : ''));
      const visual = item.favicon
        ? `<img class="pi-fav" src="${item.favicon}" onerror="this.style.display='none'">`
        : item.chips
        ? `<span class="pi-chips">${item.chips.map(c => `<span class="pi-chip" style="background:${c}"></span>`).join('')}</span>`
        : (item.swatch ? `<span class="pi-swatch" style="background:${item.swatch}"></span>` : '');
      const folderCaret = item.children ? `<span class="pi-caret">›</span>` : '';
      const value = item.value ? `<span class="pi-val">${escapeHtml(item.value)}</span>` : '';
      row.innerHTML = `${visual}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.label)}</span><span class="pi-kind">${item.children ? 'group' : item.kind}</span>${value}${folderCaret}`;
      row.onmouseenter = () => {
        if (Date.now() - paletteWheelAt < 220) return;
        paletteIndex = i;
        highlightPalette($$('.palette-item'), i);
        if (item.kind === 'theme') previewTheme(item.themeId);
      };
      row.onclick = () => activatePaletteItem(item);
      results.appendChild(row);
    });
    highlightPalette($$('.palette-item'), paletteIndex);
  }

  function activatePaletteItem(item) {
    if (item.children || item.kind === 'folder') { pushPaletteNav(item); return; }
    runPaletteItem(item);
  }

  async function runPaletteItem(item) {
    if (item.kind === 'theme') commitThemePreview();
    await item.run();
    if (item.select) {
      STATE = await DB.getState(); // reflect the new value before re-rendering
      renderPaletteResults($('#palette-input').value);
    } else {
      closePalette();
    }
  }

  /* ============ TRASH ============ */
  function openTrashPanel() {
    const list = $('#trash-list');
    list.innerHTML = '';
    const items = Object.values(STATE.trash).sort((a, b) => b.deletedAt - a.deletedAt);
    items.forEach(item => {
      const title = item.type === 'bookmark' ? item.data.title : item.data.collection.name;
      const row = el('div', 'trash-item');
      row.innerHTML = `<span class="ti-type">${item.type}</span><span class="ti-title">${escapeHtml(title)}</span>
        <button class="mini-btn" data-act="restore">Restore</button>
        <button class="mini-btn danger" data-act="purge">Delete forever</button>`;
      row.querySelector('[data-act=restore]').onclick = async () => { await DB.restoreTrashItem(item.id); await reload(); openTrashPanel(); };
      row.querySelector('[data-act=purge]').onclick = async () => { await DB.purgeTrashItem(item.id); await reload(); openTrashPanel(); };
      list.appendChild(row);
    });
    if (!items.length) list.appendChild(el('div', 'empty-collection-hint', 'Trash is empty'));
    $('#trash-overlay').classList.remove('hidden');
  }

  /* ============ WIDGETS: add ============ */
  const WIDGET_TYPE_LABELS = {
    notes: 'Notes', todo: 'To-Do', clock: 'Clock',
    search: 'Search box', countdown: 'Countdown', pomodoro: 'Pomodoro', timer: 'Timer', stopwatch: 'Stopwatch',
    weather: 'Weather', rss: 'RSS Feed'
  };
  async function addWidget(type) {
    await DB.createWidget(activeWorkspaceId(), type);
    await reload();
    toast(`${WIDGET_TYPE_LABELS[type] || 'Widget'} added`);
  }
  function openAddWidgetMenu(anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="notes"><span class="mi-ic">${ICONS.notes}</span>Notes</div>
      <div class="ws-item" data-act="todo"><span class="mi-ic">${ICONS.checkSquare}</span>To-Do checklist</div>
      <div class="ws-item" data-act="clock"><span class="mi-ic">${ICONS.clock}</span>Clock &amp; date</div>
      <div class="ws-item" data-act="search"><span class="mi-ic">${ICONS.search}</span>Search box</div>
      <div class="ws-item" data-act="countdown"><span class="mi-ic">${ICONS.clock}</span>Countdown</div>
      <div class="ws-item" data-act="pomodoro"><span class="mi-ic">${ICONS.clock}</span>Pomodoro timer</div>
      <div class="ws-item" data-act="timer"><span class="mi-ic">${ICONS.clock}</span>Timer</div>
      <div class="ws-item" data-act="stopwatch"><span class="mi-ic">${ICONS.clock}</span>Stopwatch</div>
      <div class="ws-item" data-act="weather"><span class="mi-ic">${ICONS.globe}</span>Weather</div>
      <div class="ws-item" data-act="rss"><span class="mi-ic">${ICONS.globe}</span>RSS Feed</div>`;
    const close = showDropdown(menu, rect, 200);
    $$('.ws-item', menu).forEach(item => { item.onclick = () => { close(); addWidget(item.dataset.act); }; });
  }

  /* ============ SETTINGS PANEL ============ */
  function openSettings() { renderThemeGrids(); syncSettingsUI(); $('#settings-overlay').classList.remove('hidden'); }

  function wireSettingsPanel() {
    $$('.settings-tab').forEach(btn => {
      btn.onclick = () => {
        $$('.settings-tab').forEach(b => b.classList.remove('active'));
        $$('.settings-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#panel-${btn.dataset.tab}`).classList.add('active');
      };
    });
    $('#settings-btn').onclick = openSettings;
    $('#settings-close-x').onclick = () => { endThemePreview(); $('#settings-overlay').classList.add('hidden'); };

    renderThemeGrids();
    $('#theme-search-input').addEventListener('input', (e) => { renderThemeGrids(); syncSettingsUI(); });

    $$('#density-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ density: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#setting-animations').onchange = async (e) => { await DB.updateSettings({ animations: e.target.checked }); await reload(); };

    $$('#viewmode-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ viewMode: b.dataset.val }); await reload(); syncSettingsUI(); });
    $$('#boardcols-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ dashboard: { columns: parseInt(b.dataset.val, 10) } }); await reload(); syncSettingsUI(); });
    $('#setting-sidebar-collapsed').onchange = async (e) => { await DB.updateSettings({ sidebarCollapsed: e.target.checked }); await reload(); };
    $('#setting-sidebar-compact').onchange = async (e) => { await DB.updateSettings({ sidebarCompact: e.target.checked }); await reload(); };

    $('#setting-confirm-delete').onchange = async (e) => { await DB.updateSettings({ confirmDelete: e.target.checked }); await reload(); };
    $('#setting-open-in-new-tab').onchange = async (e) => { await DB.updateSettings({ openBookmarksInNewTab: e.target.checked }); await reload(); };
    $$('#favicon-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ faviconSource: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#setting-group-pinned').onchange = async (e) => { await DB.updateSettings({ tabsList: { groupPinned: e.target.checked } }); await reload(); };
    $('#setting-dim-inactive').onchange = async (e) => { await DB.updateSettings({ tabsList: { dimInactive: e.target.checked } }); await reload(); };
    $('#setting-inactive-grayscale').onchange = async (e) => { await DB.updateSettings({ tabsList: { inactiveGrayscale: e.target.checked } }); await reload(); };
    $$('#inactiveopacity-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ tabsList: { inactiveOpacity: parseInt(b.dataset.val, 10) } }); await reload(); syncSettingsUI(); });

    $('#export-json-btn').onclick = async () => downloadFile('tabsboard-export.json', await DB.exportJSON(), 'application/json');
    $('#export-html-btn').onclick = () => {
      const cols = collectionsForActiveWS();
      const byCol = {};
      cols.forEach(c => byCol[c.id] = bookmarksForCollection(c.id));
      const html = DB.bookmarksHTMLExport(cols, byCol);
      downloadFile('bookmarks.html', html, 'text/html');
    };
    $('#import-json-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        await DB.importJSON(text, 'merge');
        toast('Imported successfully');
        await reload();
        sendMsg('REBUILD_MENUS');
      } catch (err) {
        toast('Import failed: invalid file');
      }
      e.target.value = '';
    };
  }

  function renderThemeGrids() {
    renderAutoThemeCard();
    const input = $('#theme-search-input');
    const q = (input ? input.value : '').trim().toLowerCase();
    const list = Themes.PRESET_THEMES.filter(t => !q || t.name.toLowerCase().includes(q));
    const wrap = $('#theme-grid-all');
    if (!list.length && q) {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', 'theme-empty-hint', `No themes match “${q}”.`));
      return;
    }
    const empty = wrap.querySelector('.theme-empty-hint');
    if (empty) empty.remove();
    renderThemeGrid('#theme-grid-all', list);
  }

  function renderAutoThemeCard() {
    const wrap = $('#theme-grid-auto');
    wrap.innerHTML = '';
    const card = el('div', 'theme-swatch-card');
    card.dataset.themeId = 'auto';
    const serika = Themes.resolveTheme('serika');
    const serikaDark = Themes.resolveTheme('serika_dark');
    card.style.background = `linear-gradient(135deg, ${serikaDark.bg} 50%, ${serika.bg} 50%)`;
    card.style.borderColor = serika.main;
    card.style.color = serika.text;
    const chips = [serikaDark.bg, serikaDark.main, serikaDark.text, serika.bg, serika.main, serika.text];
    card.innerHTML = `<div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div><div class="theme-swatch-label">Auto (system)</div>`;
    card.onclick = async () => { commitThemePreview(); await DB.updateSettings({ themeId: 'auto' }); await reload(); syncSettingsUI(); };
    wrap.appendChild(card);
  }

  function renderThemeGrid(selector, list) {
    const wrap = $(selector);
    wrap.innerHTML = '';
    list.forEach(t => {
      const card = el('div', 'theme-swatch-card');
      card.dataset.themeId = t.id;
      card.style.background = t.bg;
      card.style.borderColor = t.main;
      card.style.color = t.text;
      const chips = themeChipColors(t);
      card.innerHTML = `<div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div><div class="theme-swatch-label">${t.name}</div>`;
      card.onclick = async () => { commitThemePreview(); await DB.updateSettings({ themeId: t.id }); await reload(); syncSettingsUI(); };
      wrap.appendChild(card);
    });
  }

  function syncSettingsUI() {
    const s = STATE.meta.settings;
    $$('.theme-swatch-card').forEach(c => c.classList.toggle('selected', c.dataset.themeId === s.themeId));
    $$('#density-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.density));
    $('#setting-animations').checked = s.animations !== false;

    $$('#viewmode-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.viewMode));
    $$('#boardcols-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === ((s.dashboard && s.dashboard.columns) || 4)));
    $('#setting-sidebar-collapsed').checked = !!s.sidebarCollapsed;
    $('#setting-sidebar-compact').checked = !!s.sidebarCompact;

    $('#setting-confirm-delete').checked = s.confirmDelete !== false;
    $('#setting-open-in-new-tab').checked = !!s.openBookmarksInNewTab;
    $$('#favicon-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.faviconSource));
    const tl = s.tabsList || {};
    $('#setting-group-pinned').checked = tl.groupPinned !== false;
    $('#setting-dim-inactive').checked = tl.dimInactive !== false;
    $('#setting-inactive-grayscale').checked = tl.inactiveGrayscale !== false;
    $$('#inactiveopacity-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (tl.inactiveOpacity ?? 55)));
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* ============ SHORTCUTS POPUP ============ */
  function openShortcuts() { $('#shortcuts-overlay').classList.remove('hidden'); }
  function closeShortcuts() { $('#shortcuts-overlay').classList.add('hidden'); }

  /* ============ QUICK TOGGLES ============ */
  async function toggleSidebar() {
    const collapsed = !STATE.meta.settings.sidebarCollapsed;
    await DB.updateSettings({ sidebarCollapsed: collapsed });
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
    $('#shortcuts-btn').onclick = openShortcuts;
    $('#shortcuts-close-x').onclick = closeShortcuts;

    $('#trash-btn').onclick = openTrashPanel;
    $('#trash-close-btn').onclick = () => $('#trash-overlay').classList.add('hidden');
    $('#empty-trash-btn').onclick = async () => {
      if (!STATE.meta.settings.confirmDelete || confirm('Permanently delete all items in trash?')) {
        await DB.emptyTrash(); await reload(); openTrashPanel();
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
    });

    $('#nav-collections-btn').onclick = () => switchNav('collections');
    $('#nav-sessions-btn').onclick = () => switchNav('sessions');

    $('#recently-closed-toggle-btn').onclick = () => {
      sidebarShowingClosed = !sidebarShowingClosed;
      renderSidebar();
    };
    $('#refresh-tabs-btn').onclick = async () => { await refreshOpenTabs(); await refreshRecentlyClosed(); renderSidebar(); };

    $('#save-window-session-btn').onclick = saveWindowSession;
    $('#save-all-session-btn').onclick = saveAllWindowsSession;

    $('#collection-filter-input').addEventListener('input', (e) => { filterQueryFor.collections = e.target.value; renderBoard(); });
    $('#session-filter-input').addEventListener('input', (e) => { filterQueryFor.sessions = e.target.value; renderSessionsPage(); });

    $('#bulk-move-btn').onclick = () => {
      const cols = collectionsForActiveWS();
      const names = cols.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      const pick = prompt(`Move ${SELECTED.size} bookmark(s) to which collection?\n${names}`);
      const idx = parseInt(pick, 10) - 1;
      if (cols[idx]) { DB.moveBookmarks(Array.from(SELECTED), cols[idx].id).then(async () => { SELECTED.clear(); selectMode = false; await reload(); }); }
    };
    $('#bulk-delete-btn').onclick = () => { if (SELECTED.size) deleteBookmarksWithUndo(Array.from(SELECTED)); };
    $('#bulk-clear-btn').onclick = () => { SELECTED.clear(); selectMode = false; renderBoard(); };

    ['modal-overlay', 'palette-overlay', 'settings-overlay', 'trash-overlay', 'shortcuts-overlay'].forEach(id => {
      $('#' + id).addEventListener('click', (e) => {
        if (e.target.id !== id) return;
        if (id === 'palette-overlay') endThemePreview();
        $('#' + id).classList.add('hidden');
      });
    });

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
        $('#modal-overlay').classList.add('hidden');
        $('#settings-overlay').classList.add('hidden');
        $('#trash-overlay').classList.add('hidden');
        $('#shortcuts-overlay').classList.add('hidden');
        if (SELECTED.size) { SELECTED.clear(); selectMode = false; renderBoard(); }
        return;
      }

      // Single-key shortcuts — skip when typing in inputs
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable)) return;
      const k = e.key.toLowerCase();

      if (k === 'c') openCollectionModal();
      else if (k === 'v') toggleViewMode();
      else if (k === 't') toggleSidebar();
      else if (k === 's') openSettings();
      else if (k === '/') openPalette();
      else if (k === '?') openShortcuts();
      else if (k === 'w' && !e.shiftKey) cycleWorkspaces(1);   // next workspace
      else if (k === 'w' && e.shiftKey) cycleWorkspaces(-1);  // prev workspace
      else if (k === 'b' && !e.shiftKey) cycleBoards(1);      // next board
      else if (k === 'b' && e.shiftKey) cycleBoards(-1);      // prev board
    });

    setInterval(async () => { await refreshOpenTabs(); renderSidebar(); }, 4000);
    setInterval(async () => { await refreshRecentlyClosed(); if (sidebarShowingClosed) renderSidebar(); }, 8000);

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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
