  /* Widget-board rendering: workspace bar, open-tabs/recently-closed sidebar,
   the reconciled board, every widget renderer (clock, timer, pomodoro,
   weather, RSS, …) and the drag/resize/drop indicators. Pure classic script
   that composes with dashboard.js/bookmarks.js/palette.js/settings.js via the
   shared global scope — see index.html for load order. */
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
        const name = await uiPrompt('Workspace name', w ? w.name : '', { okLabel: 'Save', label: 'Name', placeholder: 'Workspace name' });
        if (name) { await DB.updateWorkspace(btn.dataset.rename, { name }); await reload(); }
      };
    });
    $$('[data-delete]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); menu.classList.add('hidden');
        const w = STATE.workspaces[btn.dataset.delete];
        if (await uiConfirm(`Delete workspace "${w ? w.name : ''}" and everything in it? This can't be undone.`, { title: 'Delete workspace', danger: true })) {
          await DB.deleteWorkspace(btn.dataset.delete);
          await reload();
        }
      };
    });
    menu.querySelector('[data-act=new]').onclick = () => { menu.classList.add('hidden'); openWorkspaceModal(); };
  }

  function openWorkspaceModal() {
    const body = `
      <h2>New workspace</h2>
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
  let lastSidebarSig = null;
  function sidebarSig() {
    const s = STATE.meta.settings.tabsList;
    const list = sidebarShowingClosed ? RECENTLY_CLOSED : OPEN_TABS;
    let h = 0;
    for (const t of list) {
      const str = (t.id || t.sessionId || '') + '|' + (t.title || '') + '|' + (t.url || '') + '|' + (t.favIconUrl || '') + '|' +
        (t.pinned ? 1 : 0) + '|' + (t.discarded ? 1 : 0) + '|' + (t.audible ? 1 : 0) + '|' + ((t.mutedInfo && t.mutedInfo.muted) ? 1 : 0) + '|' + (t.closedAt || 0);
      for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return (sidebarShowingClosed ? 'rc:' : 'ot:') + h + '|' + s.groupPinned + '|' + s.showTabAudio + '|' + s.dimInactive + '|' + s.inactiveOpacity + '|' + s.inactiveGrayscale + '|' + !!STATE.meta.settings.sidebarCompact + '|sel:' + Array.from(SELECTED_TABS).sort().join(',');
  }
  function renderSidebar() {
    // Board edits / workspace switches call this on every pass, but the tab
    // list only changes when tabs actually change — skipping the rebuild here
    // keeps scroll position and hover state intact the rest of the time.
    if (lastSidebarSig === sidebarSig()) return;
    lastSidebarSig = sidebarSig();

    const list = $('#open-tabs-list');
    list.innerHTML = '';

    const closedToggle = $('#sidebar-closed-toggle');
    closedToggle.classList.toggle('active', sidebarShowingClosed);
    closedToggle.setAttribute('aria-pressed', String(sidebarShowingClosed));
    closedToggle.title = sidebarShowingClosed ? 'Show open tabs' : 'Show recently closed';
    const titleEl = $('#sidebar-heading-title');
    if (titleEl) titleEl.textContent = sidebarShowingClosed ? 'Recently closed' : 'Open tabs';

    if (sidebarShowingClosed) {
      renderRecentlyClosedRows(list);
      return;
    }

    const s = STATE.meta.settings.tabsList;
    const pinned = OPEN_TABS.filter(t => t.pinned);
    const rest = OPEN_TABS.filter(t => !t.pinned);

    if (s.groupPinned) {
      if (pinned.length) {
        const pinnedBoundary = el('div', 'tab-group-boundary');
        pinnedBoundary.dataset.group = 'pinned';
        list.appendChild(pinnedBoundary);
        pinned.forEach(t => list.appendChild(renderTabRow(t)));
      }
      const tabsBoundary = el('div', 'tab-group-boundary tab-group-divider' + (pinned.length ? ' is-visible' : ' is-pin-slot'));
      tabsBoundary.dataset.group = 'tabs';
      list.appendChild(tabsBoundary);
      rest.forEach(t => list.appendChild(renderTabRow(t)));
    } else {
      OPEN_TABS.forEach(t => list.appendChild(renderTabRow(t)));
    }
    if (!OPEN_TABS.length) list.appendChild(el('div', 'empty-collection-hint', 'No open tabs'));
  }

  function renderTabRow(tab) {
    const s = STATE.meta.settings.tabsList;
    const muted = !!(tab.mutedInfo && tab.mutedInfo.muted);
    const showAudio = s.showTabAudio !== false && (tab.audible || muted);
    const row = el('div', 'tab-row' + (SELECTED_TABS.has(tab.id) ? ' selected' : ''));
    if (s.dimInactive && tab.discarded) row.classList.add('tab-inactive');
    row.draggable = true;
    row.dataset.tabId = tab.id;
    /* Pinned rows turn their single action button into a two-state control: a
       minus that unloads the tab while it is still loaded, then an × once it
       is unloaded and closing is all that's left. Browsers refuse to discard
       the focused tab, so the active one keeps the plain ×. */
    const canUnload = tab.pinned && canUnloadTab(tab);
    row.innerHTML = `
      <img class="favicon" src="${tab.favIconUrl || faviconFor(tab.url)}" onerror="this.style.visibility='hidden'">
      ${showAudio ? `<button class="tab-audio${muted ? ' is-muted' : ''}" data-act="mute" title="${muted ? 'Unmute tab' : 'Mute tab'}">${muted ? ICONS.mute : ICONS.unmute}</button>` : ''}
      <span class="tab-title" title="${escapeHtml(tab.title)}">${escapeHtml(tab.title || tab.url)}</span>
      ${SELECTED_TABS.has(tab.id) ? `<span class="tab-check">${ICONS.check}</span>` : ''}
      <span class="tab-icons">
        <button data-act="${canUnload ? 'unload' : 'close'}" class="${canUnload ? 'tab-unload' : 'tab-close'}" title="${canUnload ? 'Unload tab' : 'Close tab'}">${canUnload ? ICONS.minus : ICONS.close}</button>
      </span>`;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tdb-tab', JSON.stringify(tab));
      draggedTab = tab;
      row.classList.add('dragging');
      document.body.classList.add('dragging-tab');
      $('#open-tabs-list').classList.add('dragging-open-tab');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      document.body.classList.remove('dragging-tab');
      $('#open-tabs-list').classList.remove('dragging-open-tab');
      draggedTab = null;
    });
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      const mod = e.metaKey || e.ctrlKey || e.shiftKey;
      if (!mod && !SELECTED_TABS.size) { sendMsg('FOCUS_TAB', { tabId: tab.id }); return; }
      toggleTabSelected(tab.id, e);
    });
    const closeBtn = row.querySelector('[data-act=close]');
    if (closeBtn) closeBtn.onclick = async (e) => {
      e.stopPropagation();
      await sendMsg('CLOSE_TAB', { tabId: tab.id });
      await refreshOpenTabs(); await refreshRecentlyClosed();
      renderSidebar();
    };
    const unloadBtn = row.querySelector('[data-act=unload]');
    if (unloadBtn) unloadBtn.onclick = async (e) => {
      e.stopPropagation();
      await unloadTab(tab);
    };
    const audioBtn = row.querySelector('[data-act=mute]');
    if (audioBtn) audioBtn.onclick = async (e) => {
      e.stopPropagation();
      await sendMsg('TOGGLE_MUTE_TAB', { tabId: tab.id });
      await refreshOpenTabs(); renderSidebar();
    };
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const x = e.clientX, y = e.clientY;
      openTabMenu(tab, { getBoundingClientRect: () => ({ left: x, top: y, bottom: y, right: x, width: 0, height: 0 }) });
    });
    return row;
  }

  function toggleTabSelected(tabId, evt) {
    const wasSel = SELECTED_TABS.has(tabId);
    const mod = evt && (evt.metaKey || evt.ctrlKey || evt.shiftKey);
    if (!mod && !wasSel) SELECTED_TABS.clear();
    if (wasSel) SELECTED_TABS.delete(tabId); else SELECTED_TABS.add(tabId);
    renderSidebar();
  }

  function tabIdsAbove(tab) { return OPEN_TABS.filter(t => !t.pinned && t.index < tab.index).map(t => t.id); }
  function tabIdsBelow(tab) { return OPEN_TABS.filter(t => !t.pinned && t.index > tab.index).map(t => t.id); }
  function tabIdsOthers(tab) { return OPEN_TABS.filter(t => !t.pinned && t.id !== tab.id).map(t => t.id); }

  async function closeTabIds(ids) {
    if (!ids.length) return;
    ids.forEach(id => SELECTED_TABS.delete(id));
    await sendMsg('CLOSE_TABS', { tabIds: ids });
    await refreshOpenTabs(); await refreshRecentlyClosed();
    renderSidebar();
  }

  /* Unload = free the tab's memory but keep it in the strip. Shared by the
     pinned row's minus button and the context menu's Unload Tab item, so both
     report the same result the same way. */
  function canUnloadTab(tab) { return !tab.discarded && !tab.active; }

  async function unloadTab(tab) {
    const res = await sendMsg('DISCARD_TAB', { tabId: tab.id });
    if (res && res.ok) toast('Tab unloaded');
    else toast("Couldn't unload that tab" + ((res && res.error) ? ': ' + res.error : ''));
    await refreshOpenTabs(); renderSidebar();
  }

  /* Live mute-state sync for the open-tab context menu. The menu is built
     from a snapshot, so if the tab is muted/unmuted from the browser itself
     the label would go stale — this patches the open menu's Mute row in place
     whenever tabs change, and closes the menu if the tab disappears. All
     close paths clear it via isConnected on the next update. */
  let openTabLive = null;
  function ensureTabLiveSync() {
    if (tabLiveMsgRegistered) return;
    tabLiveMsgRegistered = true;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'TABS_CHANGED') syncOpenTabMenuMute();
    });
  }
  let tabLiveMsgRegistered = false;
  function syncOpenTabMenuMute() {
    const live = openTabLive;
    if (!live) return;
    if (!live.el.isConnected) { openTabLive = null; return; }
    const fresh = OPEN_TABS.find(t => t.id === live.tabId);
    if (!fresh) { openTabLive = null; live.close(); return; }
    const m = !!(fresh.mutedInfo && fresh.mutedInfo.muted);
    if (m !== live.muted) {
      live.muted = m;
      live.el.innerHTML = `<span class="mi-ic">${m ? ICONS.unmute : ICONS.mute}</span>${m ? 'Unmute Tab' : 'Mute Tab'}`;
    }
  }

  function openTabMenu(tab, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');

    const pinned = tab.pinned;
    const muted = tab.mutedInfo && tab.mutedInfo.muted;
    const canUnload = canUnloadTab(tab);
    const isSelected = SELECTED_TABS.has(tab.id);
    const selCount = SELECTED_TABS.size;
    const selThis = isSelected && selCount > 1;

    menu.innerHTML = `
      <div class="ws-item" data-act="addcol"><span class="mi-ic">${ICONS.folderPlus}</span>Add to Collection…</div>
      <hr>
      <div class="ws-item" data-act="reload"><span class="mi-ic">${ICONS.refresh}</span>Reload Tab</div>
      <div class="ws-item" data-act="mute"><span class="mi-ic">${muted ? ICONS.unmute : ICONS.mute}</span>${muted ? 'Unmute Tab' : 'Mute Tab'}</div>
      ${canUnload ? `<div class="ws-item" data-act="unload"><span class="mi-ic">${ICONS.archive}</span>Unload Tab</div>` : ''}
      <hr>
      <div class="ws-item" data-act="pin"><span class="mi-ic">${pinned ? ICONS.pinOff : ICONS.pin}</span>${pinned ? 'Unpin Tab' : 'Pin Tab'}</div>
      <div class="ws-item" data-act="dup"><span class="mi-ic">${ICONS.copyPlus}</span>Duplicate Tab</div>
      <div class="ws-item" data-act="movewin"><span class="mi-ic">${ICONS.externalWindow}</span>Move to New Window</div>
      <hr>
      <div class="ws-item" data-act="select"><span class="mi-ic">${isSelected ? ICONS.check : ICONS.checkSquare}</span>${isSelected ? 'Deselect Tab' : 'Select Tab'}${selCount > 1 ? ` (${selCount} selected)` : ''}</div>
      <hr>
      <div class="ws-item" data-act="close-this" data-close><span class="mi-ic">${ICONS.close}</span>${selThis ? `Close Selected Tabs (${selCount})` : 'Close Tab'}</div>
      <div class="ws-item has-sub" data-act="close-sub" data-close><span class="mi-ic">${ICONS.layers}</span>Close Multiple Tabs<span class="mi-right">${ICONS.chevronRight}</span></div>`;
    const close = showDropdown(menu, rect, 240);

    /* Nested "Close tabs" menu, opened on hover with a small grace period so
       the pointer can cross the gap into it without flickering. It flips to
       the left when the main menu sits against the right edge of the window. */
    const submenu = el('div', 'dropdown-menu');
    let subTimer = null;
    const closeSub = () => {
      if (subTimer) { clearTimeout(subTimer); subTimer = null; }
      if (submenu.parentNode) submenu.remove();
    };
    const closeAll = () => {
      closeSub();
      close();
      openDropdownMenus.delete(closeAll);
    };
    /* The built-in close registered by showDropdown only removes the main
       menu; make sure the submenu dies along with it. Keeping this wrapper in
       openDropdownMenus also lets a later menu (e.g. the collection picker)
       tear down both. */
    openDropdownMenus.delete(close);
    openDropdownMenus.add(closeAll);
    setTimeout(() => document.addEventListener('click', closeAll, { once: true }), 0);

    submenu.innerHTML = `
      <div class="ws-item" data-act="sub-above" data-close><span class="mi-ic">${ICONS.arrowUp}</span>Close Tabs Above</div>
      <div class="ws-item" data-act="sub-below" data-close><span class="mi-ic">${ICONS.arrowDown}</span>Close Tabs Below</div>
      <div class="ws-item" data-act="sub-others" data-close><span class="mi-ic">${ICONS.ban}</span>Close Other Tabs</div>`;
    const openSub = () => {
      if (submenu.parentNode) return;
      document.body.appendChild(submenu);
      submenu.style.visibility = 'hidden';
      submenu.style.top = '0px';
      submenu.style.left = '0px';
      const itemRect = menu.querySelector('[data-act=close-sub]').getBoundingClientRect();
      const sRect = submenu.getBoundingClientRect();
      let left = itemRect.right + 6;
      if (left + sRect.width > window.innerWidth - 8) left = itemRect.left - sRect.width - 6;
      left = Math.max(8, left);
      let top = Math.min(itemRect.top, window.innerHeight - sRect.height - 8);
      top = Math.max(8, top);
      submenu.style.top = top + 'px';
      submenu.style.left = left + 'px';
      submenu.style.visibility = 'visible';
    };
    const subItem = menu.querySelector('[data-act=close-sub]');
    subItem.addEventListener('mouseenter', () => { if (subTimer) clearTimeout(subTimer); openSub(); });
    subItem.addEventListener('mouseleave', () => { subTimer = setTimeout(closeSub, 180); });
    /* Do not let a click on the submenu trigger dismiss the menu. */
    subItem.addEventListener('click', (e) => e.stopPropagation());
    submenu.addEventListener('mouseenter', () => { if (subTimer) clearTimeout(subTimer); });
    submenu.addEventListener('mouseleave', () => { subTimer = setTimeout(closeSub, 180); });

    menu.querySelector('[data-act=reload]').onclick = async () => { closeAll(); await sendMsg('RELOAD_TAB', { tabId: tab.id }); };
    const muteBtn = menu.querySelector('[data-act=mute]');
    ensureTabLiveSync();
    openTabLive = { tabId: tab.id, el: muteBtn, muted: muted, close: closeAll };
    muteBtn.onclick = async (e) => {
      e.stopPropagation(); // keep the menu open so the toggle label can flip
      await sendMsg('TOGGLE_MUTE_TAB', { tabId: tab.id });
      await refreshOpenTabs(); renderSidebar();
      const updated = OPEN_TABS.find(t => t.id === tab.id);
      const nowMuted = !!(updated && updated.mutedInfo && updated.mutedInfo.muted);
      muteBtn.innerHTML = `<span class="mi-ic">${nowMuted ? ICONS.unmute : ICONS.mute}</span>${nowMuted ? 'Unmute Tab' : 'Mute Tab'}`;
    };
    menu.querySelector('[data-act=addcol]').onclick = (e) => { closeAll(); openTabAddToCollectionMenu(tab, anchorBtn); };
    menu.querySelector('[data-act=dup]').onclick = async () => { closeAll(); await sendMsg('DUPLICATE_TAB', { tabId: tab.id }); await refreshOpenTabs(); renderSidebar(); };
    menu.querySelector('[data-act=movewin]').onclick = async () => { closeAll(); await sendMsg('MOVE_TAB_NEW_WINDOW', { tabId: tab.id }); await refreshOpenTabs(); renderSidebar(); };
    menu.querySelector('[data-act=pin]').onclick = async () => { closeAll(); await sendMsg('TOGGLE_PIN_TAB', { tabId: tab.id, pinned: !pinned }); await refreshOpenTabs(); renderSidebar(); };
    const unloadBtn = menu.querySelector('[data-act=unload]');
    if (unloadBtn) unloadBtn.onclick = async () => { closeAll(); await unloadTab(tab); };
    menu.querySelector('[data-act=select]').onclick = () => { closeAll(); toggleTabSelected(tab.id, { metaKey: true }); };

    menu.querySelector('[data-act=close-this]').onclick = async () => {
      closeAll();
      if (selThis) {
        await closeTabIds(Array.from(SELECTED_TABS));
      } else {
        await sendMsg('CLOSE_TAB', { tabId: tab.id });
        await refreshOpenTabs(); await refreshRecentlyClosed();
        renderSidebar();
      }
    };
    submenu.querySelector('[data-act=sub-above]').onclick = async () => { closeAll(); await closeTabIds(tabIdsAbove(tab)); };
    submenu.querySelector('[data-act=sub-below]').onclick = async () => { closeAll(); await closeTabIds(tabIdsBelow(tab)); };
    submenu.querySelector('[data-act=sub-others]').onclick = async () => { closeAll(); await closeTabIds(tabIdsOthers(tab)); };
  }

  /* Shared "add a URL to a collection" picker — used by both the Open Tabs
     sidebar and history entries. <info> is { title, url, favicon }. */
  function openUrlAddToCollectionMenu(info, rect) {
    const cols = collectionsForActiveWS();
    if (!cols.length) { toast('Create a collection first'); return; }
    const menu = el('div', 'dropdown-menu');
    cols.forEach(c => {
      const item = el('div', 'ws-item');
      item.innerHTML = `<span style="flex:1">${escapeHtml(c.name)}</span>`;
      item.onclick = async () => {
        menu.remove();
        const created = await addBookmarkSmart(c.id, activeWorkspaceId(), { title: info.title, url: info.url, favicon: info.favicon || '' });
        if (created) toast(`Added to "${c.name}"`);
      };
      menu.appendChild(item);
    });
    showDropdown(menu, rect, 240);
  }
  function openTabAddToCollectionMenu(tab, anchorBtn) {
    openUrlAddToCollectionMenu({ title: tab.title, url: tab.url, favicon: tab.favIconUrl }, anchorBtn.getBoundingClientRect());
  }

  function reopenSession(item) {
    return async () => {
      await sendMsg('REOPEN_CLOSED_SESSION', { sessionId: item.sessionId });
      await refreshOpenTabs();
      await refreshRecentlyClosed();
      sidebarShowingClosed = false; // reopening a tab naturally returns you to the tabs view
      renderSidebar();
    };
  }

  /* The sidebar's "history": recently-closed tabs/windows + a per-entry
     right-click menu (restore / open / copy / add-to-collection / details),
     plus day-of-week grouping headers. Menu is right-click only — the rows
     deliberately carry no visible ⋯ button. */
  function renderRecentlyClosedRows(wrap) {
    const n = new Date();
    const todayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    let lastKey = null;
    RECENTLY_CLOSED.forEach(item => {
      const t = item.closedAt || 0;
      const key = t >= todayStart ? 'Today' : t >= todayStart - 86400000 ? 'Yesterday' : new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      if (key !== lastKey) {
        wrap.appendChild(el('div', 'tab-group-label', escapeHtml(key)));
        lastKey = key;
      }
      const row = el('div', 'tab-row' + (item.isWindow ? ' tab-window-row' : ''));
      if (item.isWindow) {
        const favs = (item.tabs || []).slice(0, 4).map(u =>
          `<img class="favicon" src="${u.favIconUrl || faviconFor(u.url)}" title="${escapeHtml(u.title || u.url)}" onerror="this.style.visibility='hidden'">`
        ).join('');
        row.innerHTML = `
          <span class="window-favicons">${favs}</span>
          <span class="tab-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
          <span class="rc-time">${formatRelTime(item.closedAt)}</span>`;
      } else {
        row.innerHTML = `
          <img class="favicon" src="${item.favIconUrl || faviconFor(item.url)}" onerror="this.style.visibility='hidden'">
          <span class="tab-title" title="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</span>
          <span class="rc-time">${formatRelTime(item.closedAt)}</span>`;
      }
      row.addEventListener('click', reopenSession(item));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        openRecentlyClosedMenu(item, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 });
      });
      wrap.appendChild(row);
    });
    if (!RECENTLY_CLOSED.length) wrap.appendChild(el('div', 'empty-collection-hint', 'Nothing closed recently'));
  }

  function openRecentlyClosedMenu(item, rect) {
    const fav = item.favIconUrl || faviconFor(item.url || '');
    const restoreLabel = item.isWindow ? 'Restore window' : 'Restore tab';
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="open"><span class="mi-ic">${ICONS.openAll}</span>${restoreLabel}</div>
      ${item.url ? `
        <div class="ws-item" data-act="opennew"><span class="mi-ic">${ICONS.externalWindow}</span>Open in a new tab</div>
        <div class="ws-item" data-act="copy"><span class="mi-ic">${ICONS.copy}</span>Copy link</div>
        <div class="ws-item" data-act="addcol"><span class="mi-ic">${ICONS.folderPlus}</span>Add to Collection…</div>
        <hr>
        <div class="ws-item" data-act="details"><span class="mi-ic">${ICONS.target}</span>Details<span class="mi-right">${ICONS.chevronRight}</span></div>` : ''}`;
    const close = showDropdown(menu, rect, 240);
    menu.querySelector('[data-act=open]').onclick = () => { close(); reopenSession(item)(); };
    if (item.url) {
      menu.querySelector('[data-act=opennew]').onclick = () => { close(); sendMsg('OPEN_URL', { url: item.url, forceNewTab: true }); };
      menu.querySelector('[data-act=copy]').onclick = async () => { close(); if (await copyTextToClipboard(item.url)) toast('Link copied'); else toast("Couldn't copy"); };
      menu.querySelector('[data-act=addcol]').onclick = (e) => { close(); openUrlAddToCollectionMenu({ title: item.title || item.url, url: item.url, favicon: fav }, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 }); };
      menu.querySelector('[data-act=details]').onclick = () => { close(); openHistoryDetailsModal({ url: item.url, title: item.title || item.url, favicon: fav, lastVisitTime: item.closedAt }); };
    }
  }

  /* ============ BOARD (widgets) ============ */
  const filterQueryFor = { collections: '', sessions: '' };

  function renderBoard() {
    $('#view-collections').classList.remove('hidden');
    $('#view-sessions').classList.add('hidden');
    renderBoardSwitcher();
    const board = $('#board');
    const focus = captureFocusState();
    const q = filterQueryFor.collections.trim().toLowerCase();
    const widgets = widgetsForActiveWS().filter(w => {
      if (q && w.type === 'collection') {
        const col = STATE.collections[w.collectionId];
        return col && col.name.toLowerCase().includes(q);
      }
      return !q; // filter box only searches collection names
    });

    // Reconcile: reuse cards whose rendered data hasn't changed instead of
    // wiping the board and rebuilding every bookmark from scratch. This keeps
    // the notes/to-do inputs' focus, drag activity, and scroll position intact
    // across unrelated re-renders (the biggest regular cost was the notes
    // autosave and each click triggering a full rebuild).
    const prevBySig = new Map(); // widgetId -> card
    board.querySelectorAll(':scope > .widget').forEach(node => {
      if (node.dataset.widgetId) prevBySig.set(node.dataset.widgetId, node);
    });
    const prevGhost = board.querySelector(':scope > .widget-ghost');
    const ordered = [];
    widgets.forEach(w => {
      const prev = prevBySig.get(w.id);
      const sig = widgetRenderSig(w);
      if (prev && prev.dataset.sig === sig) {
        ordered.push(prev);
      } else {
        const fresh = renderWidget(w);
        fresh.dataset.sig = sig;
        if (prev) prev.replaceWith(fresh);
        ordered.push(fresh);
      }
    });

    let ghost = prevGhost || renderGhostWidget();
    if (!prevGhost) board.appendChild(ghost);
    // The ghost tile must always be last — move it if a card grew past it.
    if (board.lastElementChild !== ghost) board.appendChild(ghost);

    // Drop cards that no longer belong on this board (filtered out, widget
    // deleted, board switched).
    board.querySelectorAll(':scope > .widget').forEach(node => {
      if (!widgets.some(w => w.id === node.dataset.widgetId)) node.remove();
    });

    // Re-order to match the target layout, moving existing cards in place.
    let ref = board.firstChild;
    ordered.forEach(node => {
      if (node === ref) { ref = ref.nextSibling; return; }
      board.insertBefore(node, ref);
    });

    restoreFocusState(focus);
    syncLiveCards();
    updateBulkBar();
  }

  /* A cheap, deterministic fingerprint of everything that affects a widget's
     rendered output. Matching fingerprint on the next board pass means the
     card can be reused as-is (no DOM rebuild). Non-collection widgets are
     small, so their JSON is the fingerprint; collection widgets hash the
     collection + every bookmark with an FNV-style rolling hash so layout and
     content changes are caught without allocating huge signature strings. */
  function widgetRenderSig(w) {
    if (w.type === 'collection') {
      const col = STATE.collections[w.collectionId];
      if (!col) return w.id + ':' + w.collectionId;
      let h = 0;
      const mix = (v) => {
        const s = String(v == null ? '' : v);
        for (let i = 0; i < s.length; i++) {
          h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
      };
      mix(col.name); mix(col.color); mix(col.pinned); mix(col.sortMode);
      mix(col.viewMode); mix(col.description); mix(col.syncSource);
      for (const b of bookmarksForCollection(col.id)) {
        mix(b.id); mix(b.title); mix(b.url); mix(b.order);
        mix(b.pinned); mix(b.tintColor); mix(b.visitTime || 0);
        mix(SELECTED.has(b.id) ? 1 : 0);
      }
      return 'col:' + w.id + ':' + h + ':' + bookmarksForCollection(col.id).length;
    }
    return JSON.stringify(w);
  }

  /* Before a board rebuild, remember exactly which widget widget stood on and
     whether a text field inside it was focused (plus caret position), so we
     can hand focus straight back afterwards. Without this, the notes widget's
     autosave re-render would kick the caret out of the textarea mid-typing. */
  function captureFocusState() {
    const ae = document.activeElement;
    if (!ae || !ae.closest) return null;
    const card = ae.closest('.widget');
    if (!card || !card.dataset.widgetId) return null;
    const editable = ae.matches('textarea, input, [contenteditable]') ? ae : null;
    const sibs = editable ? Array.from(card.querySelectorAll('textarea, input, [contenteditable]')) : null;
    return {
      wid: card.dataset.widgetId,
      editable: !!editable,
      index: sibs ? sibs.indexOf(editable) : -1,
      start: editable ? editable.selectionStart : null,
      end: editable ? editable.selectionEnd : null
    };
  }
  function restoreFocusState(f) {
    if (!f) return;
    const card = document.querySelector(`.widget[data-widget-id="${CSS.escape ? CSS.escape(f.wid) : f.wid.replace(/["\\]/g, '')}"]`);
    if (!card) return;
    if (!f.editable) { card.focus(); return; }
    const sibs = card.querySelectorAll('textarea, input, [contenteditable]');
    const target = sibs[f.index >= 0 ? f.index : 0];
    if (!target) return;
    target.focus();
    if (typeof target.setSelectionRange === 'function') target.setSelectionRange(f.start, f.end);
  }

  /* Live widgets (timer / stopwatch / pomodoro) only need a DOM tick while
     they're actually running. We keep a small list of their cards, rebuilt on
     each board pass, and reschedule a short tick only while at least one of
     them is active — so a static dashboard never spends per-frame work. */
  let liveCardRefs = [];
  let liveTickTimer = null;
  const LIVE_TICK_MS = 250;
  function syncLiveCards() {
    liveCardRefs = [];
    $$('#board .widget[data-widget-id]').forEach(card => {
      const w = STATE.widgets[card.dataset.widgetId];
      if (w && (w.type === 'timer' || w.type === 'stopwatch' || w.type === 'pomodoro')) {
        liveCardRefs.push({ card, w });
      }
    });
    ensureLiveTick();
  }
  function ensureLiveTick() {
    if (liveTickTimer) return;
    liveTickTimer = setTimeout(liveTickRunner, LIVE_TICK_MS);
  }
  function liveTickRunner() {
    liveTickTimer = null;
    let anyActive = false;
    for (const ref of liveCardRefs) {
      if (!ref.card.isConnected) continue;
      if (ref.w.type === 'pomodoro') { updatePomodoroNode(ref.card, ref.w); if (ref.w.running) anyActive = true; }
      else if (ref.w.type === 'timer') { updateTimerNode(ref.card, ref.w); if (ref.w.running) anyActive = true; }
      else if (ref.w.type === 'stopwatch') { updateStopwatchNode(ref.card, ref.w); if (ref.w.running) anyActive = true; }
    }
    if (anyActive) ensureLiveTick();
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
        const name = await uiPrompt('Board name', board ? board.name : '', { okLabel: 'Save', label: 'Name', placeholder: 'Board name' });
        if (name) { await DB.renameBoard(btn.dataset.rename, name); await reload(); }
      };
    });
    $$('[data-delete]', menu).forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation(); close();
        const board = STATE.boards[btn.dataset.delete];
        if (!(await uiConfirm(`Delete board "${board ? board.name : ''}"? Its widgets move to another board — nothing is deleted.`, { title: 'Delete board', danger: true }))) return;
        const res = await DB.deleteBoard(btn.dataset.delete);
        if (res && res.ok) toast(`Moved ${res.movedCount} widget${res.movedCount === 1 ? '' : 's'} to "${res.movedTo}"`);
        await reload();
      };
    });
    menu.querySelector('[data-act=new]').onclick = async () => {
      close();
      const name = await uiPrompt('New board name', `Board ${boardsForActiveWS().length + 1}`, { okLabel: 'Create', label: 'Name', placeholder: 'Board name' });
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
    if (w.type === 'topSites') return renderTopSitesWidget(w);
    if (w.type === 'downloads') return renderDownloadsWidget(w);
    if (w.type === 'history') return renderHistoryWidget(w);
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
      <p class="modal-subtitle">Leave unset to use the normal background.</p>
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

  function renderBrowserDataWidget(w, opts) {
    /* Renders live browser data (Most visited / History) in the exact same
       card + bookmark list/tile layout a real collection uses, so they read
       and behave like ordinary collection widgets. opts.fetch(done) supplies
       [{title, url, favicon, _i}]; items honor the global view mode and the
       widget's row count. */
    const viewMode = STATE.meta.settings.viewMode || 'grid';
    const shownCount = opts.count || w.count || 8;
    const metaFor = opts.meta || (() => '');
    const listEl = el('div', 'bookmarks-list is-empty');
    listEl.appendChild(el('div', 'empty-collection-hint', 'Loading…'));
    const titleHtml = `<span class="widget-title">${escapeHtml(opts.title || '')}</span>`;
    const { card, header } = widgetShell(w, opts.icon || ICONS.grid, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body');
    body.appendChild(listEl);
    card.appendChild(body);
    opts.fetch((items) => {
      items = (items || []).slice(0, shownCount);
      listEl.innerHTML = '';
      listEl.classList.toggle('view-grid', viewMode === 'grid' && items.length > 0);
      listEl.classList.toggle('is-empty', !items.length);
      if (!items.length) {
        listEl.appendChild(el('div', 'empty-collection-hint', opts.emptyText || 'Nothing here yet'));
        return;
      }
      items.forEach(item => listEl.appendChild(renderVirtualBookmark({
        id: 'vbm-' + w.id + (item._i !== undefined ? '-' + item._i : '-' + Math.random().toString(36).slice(2)),
        title: item.title || hostnameOf(item.url) || item.url,
        url: item.url,
        favicon: item.favicon || '',
        meta: metaFor(item)
      }, viewMode)));
    });
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
        <button type="button" class="todo-del" title="Delete to-do item">${ICONS.trash}</button>`;
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

  /* ---- Most visited: chrome.topSites hits the browser's most-visited list.
     Rendered as a normal collection widget (shared bookmark layout, open /
     copy / drag-to-save behavior). ---- */
  function renderTopSitesWidget(w) {
    return renderBrowserDataWidget(w, {
      title: 'Most visited', icon: ICONS.grid, emptyText: 'No top sites yet',
      fetch: (done) => {
        const finish = (sites) => done((sites || []).map((s, i) => ({ title: s.title || hostnameOf(s.url) || s.url, url: s.url, favicon: s.favicon || '', _i: i })));
        const api = chrome.topSites;
        if (!api || !api.get) { done([]); return; }
        try {
          // Firefox: pass {newtab:true} so the list matches the real
          // new-tab page (its default can come back empty). Chrome's
          // topSites.get is callback-only and takes no options.
          const isFx = (chrome.runtime && chrome.runtime.getURL('t').indexOf('moz-extension://') === 0);
          const opts = isFx ? { newtab: true, limit: Math.max(w.count || 8, 12) } : undefined;
          const p = api.get(opts);
          if (p && typeof p.then === 'function') p.then(finish, () => done([]));
          else api.get(finish);
        } catch (e) { done([]); }
      }
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
  }
  function formatRelTime(ts) {
    if (!ts) return '';
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  /* ---- Recent downloads: chrome.downloads lists the browser's recent
     completed downloads. Rows open the file (or reveal it in the download
     manager via the folder button). Fresh data on each render, like the
     Most visited widget. ---- */
  function renderDownloadsWidget(w) {
    const titleHtml = `<span class="widget-title">Downloads</span>`;
    const { card, header } = widgetShell(w, ICONS.download, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body bs-body');
    const list = el('div', 'bs-list');
    body.appendChild(list);
    const fill = (data) => {
      list.innerHTML = '';
      const items = (data && data.downloads) || [];
      if (!items.length) { body.appendChild(el('div', 'empty-collection-hint', 'No downloads yet')); return; }
      items.forEach(d => {
        const name = d.filename ? d.filename.split('/').pop() : hostnameOf(d.url);
        const row = el('div', 'bs-item');
        row.innerHTML = `
          <img class="favicon" src="${faviconFor(d.url)}" onerror="this.style.visibility='hidden'">
          <span class="bs-title" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <span class="bs-meta">${formatBytes(d.size)}${d.endTime ? ' · ' + formatRelTime(new Date(d.endTime).getTime()) : ''}</span>`;
        row.addEventListener('click', (e) => {
          e.preventDefault();
          sendMsg('SHOW_DOWNLOAD', { id: d.id });
        });
        list.appendChild(row);
      });
    };
    sendMsg('GET_DOWNLOADS', { count: w.count || 8 }).then(fill, () => fill({ downloads: [] }));
    card.appendChild(body);
    return card;
  }

  /* ---- Browsing history: chrome.history shows pages visited recently.
     Rows are grouped by day (Today / Yesterday / weekday), show a relative
     visit time and visit count, mark pages typed into the address bar, and
     carry the same favicon/tile layout as a real collection. The ⋯ / right-
     click menu can open/copy the page, add it to a collection, inspect every
     visit (Details) or delete history back to the browser. ---- */
  function renderHistoryWidget(w) {
    const s = STATE.meta.settings;
    const count = Math.max(1, Number(w.count || s.historyCount) || 10);
    const showTimes = s.historyShowTimes !== false;
    const viewMode = STATE.meta.settings.viewMode || 'grid';
    const isTile = viewMode === 'grid';
    const titleHtml = `<span class="widget-title">History</span>`;
    const { card, header } = widgetShell(w, ICONS.rotateCcwClock, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body');
    const listWrap = el('div', 'bookmarks-list is-empty');
    listWrap.appendChild(el('div', 'empty-collection-hint', 'Loading…'));
    body.appendChild(listWrap);
    card.appendChild(body);
    const fill = (raw) => {
      const items = (raw || []).slice(0, count);
      listWrap.classList.toggle('view-grid', viewMode === 'grid' && items.length > 0);
      listWrap.classList.toggle('is-empty', !items.length);
      listWrap.innerHTML = '';
      if (!items.length) { listWrap.appendChild(el('div', 'empty-collection-hint', 'No browsing history yet')); return; }
      const n = new Date();
      const todayStart = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
      let lastKey = null;
      items.forEach((it, i) => {
        const t = it.lastVisitTime || 0;
        const key = t >= todayStart ? 'Today' : t >= todayStart - 86400000 ? 'Yesterday' : new Date(t).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        if (key !== lastKey) {
          listWrap.appendChild(el('div', 'hs-day-label', escapeHtml(key)));
          lastKey = key;
        }
        const fav = it.favIconUrl || faviconFor(it.url);
        const metaBits = [];
        if (showTimes && t) metaBits.push(formatRelTime(t));
        if (it.visitCount) metaBits.push(it.visitCount + (it.visitCount === 1 ? ' visit' : ' visits'));
        const metaStr = metaBits.join(' · ');
        const info = { url: it.url, title: it.title || it.url, favicon: fav, visitCount: it.visitCount || 0, typedCount: it.typedCount || 0, lastVisitTime: t };
        const item = el('div', isTile ? 'bookmark-tile hs-item' : 'bookmark-item hs-item');
        item.draggable = true;
        if (isTile) {
          item.innerHTML = `
            <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
            <div class="bm-title" title="${escapeHtml(info.url)}">${escapeHtml(info.title)}</div>
            ${it.typedCount ? `<div class="hs-typed" title="Typed ${it.typedCount}x into the address bar"></div>` : ''}
            ${metaStr ? `<div class="bm-meta" title="${escapeHtml(metaStr)}">${escapeHtml(metaStr)}</div>` : ''}`;
        } else {
          item.innerHTML = `
            <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
            <span class="bm-title" title="${escapeHtml(info.url)}">${escapeHtml(info.title)}</span>
            ${it.typedCount ? `<span class="hs-typed" title="Typed ${it.typedCount}x into the address bar"></span>` : ''}
            ${metaStr ? `<span class="bm-meta" title="${escapeHtml(metaStr)}">${escapeHtml(metaStr)}</span>` : ''}`;
        }
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('application/x-tdb-tab', JSON.stringify({ title: info.title, url: info.url, favIconUrl: fav }));
          item.classList.add('dragging');
          document.body.classList.add('dragging-tab');
        });
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
          document.body.classList.remove('dragging-tab');
        });
        item.addEventListener('click', (e) => {
          e.preventDefault();
          openBookmarkUrl({ url: info.url });
        });
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault(); e.stopPropagation();
          openHistoryMenu(info, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 });
        });
        listWrap.appendChild(item);
      });
    };
    sendMsg('GET_HISTORY', { count: Math.max(count, 30), days: w.days || 1 })
      .then((data) => fill((data && data.history) || []), () => fill([]));
    return card;
  }

  /* ---- History entry context menu: open/copy/add-to-collection/Details.
     No destructive actions here — inspecting a page's visits is handled by
     the Details modal, which can forget the page via deleteUrl. ---- */
  function openHistoryMenu(info, rect) {
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="open"><span class="mi-ic">${ICONS.openAll}</span>Open</div>
      <div class="ws-item" data-act="opennew"><span class="mi-ic">${ICONS.externalWindow}</span>Open in a new tab</div>
      <div class="ws-item" data-act="copy"><span class="mi-ic">${ICONS.copy}</span>Copy link</div>
      <div class="ws-item" data-act="addcol"><span class="mi-ic">${ICONS.folderPlus}</span>Add to Collection…</div>
      <hr>
      <div class="ws-item" data-act="details"><span class="mi-ic">${ICONS.target}</span>Details<span class="mi-right">${ICONS.chevronRight}</span></div>`;
    const close = showDropdown(menu, rect, 240);
    menu.querySelector('[data-act=open]').onclick = () => { close(); openBookmarkUrl({ url: info.url }); };
    menu.querySelector('[data-act=opennew]').onclick = () => { close(); sendMsg('OPEN_URL', { url: info.url, forceNewTab: true }); };
    menu.querySelector('[data-act=copy]').onclick = async () => { close(); if (await copyTextToClipboard(info.url)) toast('Link copied'); else toast("Couldn't copy"); };
    menu.querySelector('[data-act=addcol]').onclick = (e) => { close(); openUrlAddToCollectionMenu({ title: info.title, url: info.url, favicon: info.favicon }, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 }); };
    menu.querySelector('[data-act=details]').onclick = () => { close(); openHistoryDetailsModal(info); };
  }

  /* ---- History "Details" modal, rebuilt around the full chrome.history
     surface. Reads: getVisits (per-visit timeline + transition kinds) and
     two search calls — one reconciling this page's own counters, one scoped
     to its hostname for the "Site" tab. Writes: addUrl ("Remember") and
     deleteUrl ("Forget this page" / the per-page loop behind "Forget this
     site"). The onVisited / onVisitRemoved / onTitleChanged events keep an
     open modal live; the bulk clears don't exist anywhere in the UI. */
  const TRANSITION_LABELS = {
    link: 'Followed a link', typed: 'Typed into the address bar', reload: 'Reloaded',
    auto_bookmark: 'Opened from a bookmark', form_submit: 'Submitted a form',
    generated: 'Redirected', keyword: 'Opened from a search', keyword_generated: 'Redirected from a search',
    auto_subframe: 'Embedded (frame)', auto_toplevel: 'Opened automatically',
    manual_subframe: 'Navigated (frame)', embed: 'Embedded',
    start_page: 'Start-up page', anchor: 'Via an anchor link'
  };
  const TRANSITION_DOTS = {
    typed: 'typed', reload: 'reload', auto_bookmark: 'book',
    form_submit: 'form', generated: 'gen', keyword: 'kw', keyword_generated: 'kw',
    auto_toplevel: 'auto', link: 'link', start_page: 'start', anchor: 'anchor',
    auto_subframe: 'embed', embed: 'embed', manual_subframe: 'embed'
  };
  function transitionLabel(t) { return TRANSITION_LABELS[t] || 'Visited'; }
  function transitionDotClass(t) { return TRANSITION_DOTS[t] || 'other'; }
  // Row time is just the clock — the day grouping header already says which
// day a visit belongs to, so a per-row "Today · " prefix would just be noise.
  function formatVisitTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function formatFullDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function dayGroupKey(ts) {
    const d = new Date(ts);
    const today = new Date().setHours(0, 0, 0, 0);
    const day = d.setHours(0, 0, 0, 0);
    if (day === today) return { label: 'Today', key: 'today' };
    if (day === today - 86400000) return { label: 'Yesterday', key: 'yesterday' };
    return { label: d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }), key: String(day) };
  }

  function openHistoryDetailsModal(info) {
    const fav = info.favicon || faviconFor(info.url);
    const host = hostnameOf(info.url);
    const MAX_VISITS = 60;
    const alive = { v: true };
    let refreshTimer = null;
    let lastDetails = null;

    const dispose = () => {
      alive.v = false;
      if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
      if (chrome.history && chrome.history.onVisited) {
        chrome.history.onVisited.removeListener(onVisited);
        chrome.history.onVisitRemoved.removeListener(onVisitRemoved);
        chrome.history.onTitleChanged.removeListener(onTitleChanged);
      }
    };
    function onVisited(item) { if (item && item.url === info.url) scheduleRefresh(); }
    function onVisitRemoved() { scheduleRefresh(); }
    function onTitleChanged(item) {
      if (!alive.v || !item || item.url !== info.url || !item.title) return;
      const t = $('#hdm-title');
      if (t) t.textContent = item.title;
    }
    function scheduleRefresh() {
      if (!alive.v) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = null; load(); }, 280);
    }

    function setStat(id, text) { const n = document.getElementById(id); if (n) n.textContent = text; }

    function renderVisits(visits) {
      const panel = $('#hdm-panel-visits');
      if (!panel) return;
      panel.innerHTML = '';
      if (!visits.length) {
        panel.appendChild(el('div', 'hdm-empty', 'No visit records found. Visiting the page writes one.'));
        return;
      }
      const shown = visits.slice(-MAX_VISITS);
      const hidden = visits.length - shown.length;
      let lastKey = null;
      shown.forEach(v => {
        const g = dayGroupKey(v.visitTime);
        if (g.key !== lastKey) { lastKey = g.key; panel.appendChild(el('div', 'hdm-day', escapeHtml(g.label))); }
        const row = el('div', 'hdm-row');
        row.innerHTML = `
          <span class="hdm-dot ${transitionDotClass(v.transition)}" title="${escapeHtml(transitionLabel(v.transition))}"></span>
          <span class="hdm-time">${escapeHtml(formatVisitTime(v.visitTime))}</span>
          <span class="hdm-trans">${escapeHtml(transitionLabel(v.transition))}</span>`;
        panel.appendChild(row);
      });
      if (hidden > 0) {
        panel.appendChild(el('div', 'hdm-day', `+ ${hidden} older visit${hidden === 1 ? '' : 's'} not shown`));
      }
    }

    function renderDomain(domain) {
      const panel = $('#hdm-panel-domain');
      if (!panel) return;
      panel.innerHTML = '';
      if (!domain || !domain.host) {
        panel.appendChild(el('div', 'hdm-empty', 'No site data found.'));
        return;
      }
      const sum = el('div', 'hdm-dsum');
      const bits = [];
      bits.push(`${domain.pageCount} page${domain.pageCount === 1 ? '' : 's'}`);
      bits.push(`${domain.totalVisits} visit${domain.totalVisits === 1 ? '' : 's'}`);
      if (domain.totalTyped) bits.push(`${domain.totalTyped} typed`);
      sum.innerHTML = `
        <div class="hdm-dsum-n">${escapeHtml(bits.join(' · '))}</div>
        <div class="hdm-dsum-s">${domain.firstVisit ? 'activity since ' + escapeHtml(formatFullDate(domain.firstVisit)) : ''}</div>`;
      panel.appendChild(sum);
      if (!domain.pages.length) {
        panel.appendChild(el('div', 'hdm-empty', 'Nothing else recorded on this site yet.'));
        return;
      }
      const list = el('div', 'hdm-dlist');
      domain.pages.forEach(p => {
        const r = el('div', 'hdm-drow');
        r.innerHTML = `
          <img class="favicon" src="${p.favIconUrl || faviconFor(p.url)}" onerror="this.style.visibility='hidden'">
          <span class="hdm-drow-title" title="${escapeHtml(p.url)}">${escapeHtml(p.title || p.url)}</span>
          <span class="hdm-drow-meta">${p.visitCount} visit${p.visitCount === 1 ? '' : 's'}${p.typedCount ? ' · ' + p.typedCount + ' typed' : ''}</span>`;
        r.addEventListener('click', () => openBookmarkUrl({ url: p.url }));
        list.appendChild(r);
      });
      panel.appendChild(list);
      const forgetSite = $('#hdm-forget-site');
      if (forgetSite) {
        forgetSite.title = `Remove every page on ${domain.host} from your browsing history`;
        forgetSite.classList.remove('hidden');
      }
    }

    function fill(details) {
      if (!details || !details.ok) {
        const panel = $('#hdm-panel-visits');
        if (panel) panel.innerHTML = '<div class="hdm-empty">Couldn\'t read browser history.</div>';
        setStat('hdm-stat-visits', '—');
        setStat('hdm-stat-first', '—');
        setStat('hdm-stat-last', '—');
        return;
      }
      lastDetails = details;
      const page = details.page || {};
      const visits = details.visits || [];
      const domain = details.domain || null;
      if (page.title && page.title !== info.url) {
        const t = $('#hdm-title');
        if (t && (!info.title || info.title === info.url)) t.textContent = page.title;
      }
      if (page.favIconUrl) { const f = $('.hdm-fav'); if (f) f.src = page.favIconUrl; }
      // "typed" counts the typed transitions in the actual timeline rather than
      // trusting search's typedCount, which can report 0 for a visit whose
      // transition IS "typed" (they're tracked separately by the browser).
      const typedVisits = visits.filter(v => /typed/.test(v.transition || '')).length;
      setStat('hdm-stat-visits', String(page.visitCount != null ? page.visitCount : visits.length));
      setStat('hdm-stat-typed', String(typedVisits || '—'));
      setStat('hdm-stat-first', formatFullDate(visits.length ? visits[0].visitTime : page.lastVisitTime));
      setStat('hdm-stat-last', page.lastVisitTime ? formatRelTime(page.lastVisitTime) : '—');
      setStat('hdm-tab-visits-n', String(visits.length));
      setStat('hdm-tab-domain-n', domain ? String(domain.pageCount) : '0');
      renderVisits(visits);
      renderDomain(domain);
    }

    async function load() {
      if (!alive.v) return;
      const res = await sendMsg('GET_HISTORY_DETAILS', { url: info.url, title: info.title || '' });
      if (!alive.v) return;
      fill(res || { ok: false });
    }

    openModal(`
      <div class="hdm">
        <div class="hdm-head">
          <img class="hdm-fav" src="${fav}" onerror="this.style.visibility='hidden'">
          <div class="hdm-title-wrap">
            <h2 class="hdm-title" id="hdm-title" title="${escapeHtml(info.url)}">${escapeHtml(info.title || info.url)}</h2>
            <a class="hdm-host" href="${escapeHtml(info.url)}" target="_blank" rel="noopener">${escapeHtml(host)}</a>
          </div>
          <button class="icon-btn" id="hdm-close" title="Close"></button>
        </div>

        <div class="hdm-stats">
          <div class="hdm-stat"><span class="hdm-stat-n" id="hdm-stat-visits">…</span><span class="hdm-stat-l">visits</span></div>
          <div class="hdm-stat"><span class="hdm-stat-n" id="hdm-stat-typed">…</span><span class="hdm-stat-l">typed</span></div>
          <div class="hdm-stat"><span class="hdm-stat-n" id="hdm-stat-first">…</span><span class="hdm-stat-l">first seen</span></div>
          <div class="hdm-stat"><span class="hdm-stat-n" id="hdm-stat-last">…</span><span class="hdm-stat-l">last visit</span></div>
        </div>

        <div class="segmented hdm-tabs" role="tablist">
          <button class="hdm-tab active" id="hdm-tab-visits" role="tab" aria-selected="true">Visits <span class="hdm-tab-n" id="hdm-tab-visits-n"></span></button>
          <button class="hdm-tab" id="hdm-tab-domain" role="tab" aria-selected="false">Site <span class="hdm-tab-n" id="hdm-tab-domain-n"></span></button>
        </div>

        <div class="hdm-panel" id="hdm-panel-visits"><div class="hdm-empty">Loading visit records…</div></div>
        <div class="hdm-panel hidden" id="hdm-panel-domain"><div class="hdm-empty">Loading site activity…</div></div>
      </div>

      <div class="modal-actions">
        <div class="hdm-foot-group">
          <button class="mini-btn danger" id="hdm-forget"><span class="btn-ic-sm">${ICONS.trash}</span>Forget page</button>
          <button class="mini-btn danger hidden" id="hdm-forget-site"><span class="btn-ic-sm">${ICONS.trash}</span>Forget site</button>
        </div>
        <button class="mini-btn" id="hdm-cancel">Cancel</button>
      </div>`, () => {
      $('#hdm-close').innerHTML = icon('close');

      const switchTab = (which) => {
        $('#hdm-tab-visits').classList.toggle('active', which === 'visits');
        $('#hdm-tab-domain').classList.toggle('active', which === 'domain');
        $('#hdm-tab-visits').setAttribute('aria-selected', which === 'visits');
        $('#hdm-tab-domain').setAttribute('aria-selected', which === 'domain');
        $('#hdm-panel-visits').classList.toggle('hidden', which !== 'visits');
        $('#hdm-panel-domain').classList.toggle('hidden', which !== 'domain');
      };
      $('#hdm-tab-visits').onclick = () => switchTab('visits');
      $('#hdm-tab-domain').onclick = () => switchTab('domain');

      $('#hdm-close').onclick = () => { dispose(); closeModal(); };
      $('#hdm-cancel').onclick = () => { dispose(); closeModal(); };
      $('#hdm-forget').onclick = async () => {
        if (!(await uiConfirm('Remove this page from your browsing history? This forgets every visit.\n\nIt cannot be undone.', { title: 'Forget this page', okLabel: 'Forget page', danger: true }))) return;
        dispose();
        const res = await sendMsg('DELETE_HISTORY', { mode: 'url', url: info.url });
        closeModal();
        if (res && res.ok) {
          toast('Page removed from history');
          boardInvalidateForHistory();
        } else {
          toast("Couldn't remove that page");
        }
      };
      $('#hdm-forget-site').onclick = async () => {
        const domain = lastDetails && lastDetails.domain;
        if (!domain || !domain.pages || !domain.pages.length) return;
        const ok = await uiConfirm(`Remove every page on ${domain.host} from your browsing history?`, { title: `Forget ${domain.host}`, okLabel: 'Forget site', danger: true });
        dispose();
        if (!ok) return;
        let failed = 0;
        closeModal();
        for (const p of domain.pages) {
          const res = await sendMsg('DELETE_HISTORY', { mode: 'url', url: p.url });
          if (!(res && res.ok)) failed++;
        }
        if (failed) toast(`Removed ${domain.pages.length - failed} page${domain.pages.length - failed === 1 ? '' : 's'} (${failed} failed)`);
        else toast(`Forgot ${domain.pages.length} page${domain.pages.length === 1 ? '' : 's'} on ${domain.host}`);
        boardInvalidateForHistory();
      };

      // Keep the open modal in sync with the browser's history events.
      if (chrome.history && chrome.history.onVisited) {
        chrome.history.onVisited.addListener(onVisited);
        chrome.history.onVisitRemoved.addListener(onVisitRemoved);
        chrome.history.onTitleChanged.addListener(onTitleChanged);
      }
      // Backdrop click also cleans up the listeners.
      registerOverlayCloser('modal-overlay', () => { dispose(); closeModal(); });
      load();
    }, 'hdm-modal');
  }

  /* The History widget re-fetches on reload but reconciles cards by signature,
     so a page removed from history wouldn't leave. Wipe the board to force a
     fresh render (mirrors what the history widget menu does). */
  function boardInvalidateForHistory() {
    const board = $('#board');
    if (board) board.innerHTML = '';
    reload();
  }

  /* ---- Countdown: days remaining until a date ---- */
  function renderCountdownWidget(w) {
    const titleHtml = `<span class="widget-title">${escapeHtml(w.label || 'Countdown')}</span>`;
    const { card, header } = widgetShell(w, ICONS.hourglass, titleHtml);
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
      <h2>Edit countdown</h2>
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
    const { card, header } = widgetShell(w, ICONS.target, titleHtml);
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
    const { card, header } = widgetShell(w, ICONS.stopwatch, titleHtml);
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
    const { card, header } = widgetShell(w, ICONS.timer, titleHtml);
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
  function openTimerEditModal(w) {
    const body = `
      <h2>Edit timer</h2>
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
      <h2>Edit stopwatch</h2>
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
    const { card, header } = widgetShell(w, ICONS.cloudSun, titleHtml);
    header.querySelector('[data-act=menu]').onclick = (e) => { e.stopPropagation(); openGenericWidgetMenu(w, e.currentTarget); };
    const body = el('div', 'widget-body weather-body');
    if (!w.lat || !w.lon) {
      body.innerHTML = `<div class="empty-collection-hint">Set a location from this widget's ⋯ menu</div>`;
      card.appendChild(body);
      return card;
    }
    body.innerHTML = `<div class="empty-collection-hint">Loading…</div>`;
    card.appendChild(body);
    const units = w.units || STATE.meta.settings.weatherUnits || 'c';
    fetchWeather(w.lat, w.lon, units).then(data => {
      if (!data) { body.innerHTML = `<div class="empty-collection-hint">Couldn't load weather</div>`; return; }
      const desc = WEATHER_CODES[data.weathercode] || '—';
      const unitLabel = units === 'f' ? '°F' : '°C';
      body.innerHTML = `<div class="weather-temp">${Math.round(data.temperature)}<span class="weather-unit">${unitLabel}</span></div><div class="weather-desc">${desc}</div>`;
    });
    return card;
  }
  async function fetchWeather(lat, lon, units) {
    try {
      const tempUnit = units === 'f' ? '&temperature_unit=fahrenheit' : '';
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true${tempUnit}`);
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
      <h2>Set weather location</h2>
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
    const { card, header } = widgetShell(w, ICONS.rss, titleHtml);
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
  function revokeFeedPermission(url, excludeWidgetId) {
    // Tidy up when an RSS widget goes away: drop the host-origin grant it
    // requested, unless another RSS widget still needs the same origin.
    const pattern = originPatternFor(url);
    if (!pattern || !chrome.permissions || !chrome.permissions.remove) return;
    const stillNeeded = Object.values(STATE.widgets || {}).some(o =>
      o.id !== excludeWidgetId && o.type === 'rss' && o.feedUrl && originPatternFor(o.feedUrl) === pattern);
    if (stillNeeded) return;
    try {
      const p = chrome.permissions.remove({ origins: [pattern] });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* non-fatal */ }
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
  const rssRefreshing = new Set();
  async function refreshRssWidget(w, silent) {
    if (!w.feedUrl) { if (!silent) toast('Set a feed URL first'); return; }
    if (rssRefreshing.has(w.id)) return;
    rssRefreshing.add(w.id);
    try {
      if (silent) {
        // Auto-refresh runs outside a user gesture, so chrome.permissions
        // .request() would fail/no-op — only refresh feeds whose origin was
        // already granted, and stay quiet about it.
        const pattern = originPatternFor(w.feedUrl);
        if (pattern && chrome.permissions) {
          const granted = await new Promise(res => chrome.permissions.contains({ origins: [pattern] }, res));
          if (!granted) return;
        }
      } else {
        const ok = await ensureFeedPermission(w.feedUrl);
        if (!ok) { toast('Permission for that feed was not granted'); return; }
      }
      const result = await fetchFeed(w.feedUrl);
      if (!result) { if (!silent) toast("Couldn't load that feed"); return; }
      await DB.updateWidget(w.id, { items: result.items, label: w.label || result.label, lastFetched: Date.now() });
      if (!silent) await reload();
      if (!silent) toast('Feed refreshed');
    } finally {
      rssRefreshing.delete(w.id);
    }
  }

  // Periodic auto-refresh for RSS widgets. New items appear in the cached
  // list on the widget, which renderRssWidget already reads, so this only
  // needs a full re-render (reload()) when an idle feed actually refreshed.
  async function runRssAutoRefresh() {
    const minutes = (STATE.meta.settings && STATE.meta.settings.rssRefreshInterval) || 0;
    if (!(minutes > 0)) return;
    const minMs = minutes * 60000;
    const nowTs = Date.now();
    for (const w of Object.values(STATE.widgets)) {
      if (w.type !== 'rss' || !w.feedUrl) continue;
      if (w.lastFetched && (nowTs - w.lastFetched) < minMs) continue;
      const fetchedBefore = w.lastFetched;
      await refreshRssWidget(w, true);
      const after = await DB.getState().then(d => d.widgets[w.id]);
      if (!after) continue;
      if (after.lastFetched !== fetchedBefore) await reload();
    }
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
    const WIDGET_LABELS = { notes: 'Notes', todo: 'To-Do', clock: 'Clock', search: 'Search', countdown: 'Countdown', pomodoro: 'Pomodoro', timer: 'Timer', stopwatch: 'Stopwatch', weather: 'Weather', rss: 'RSS Feed', topSites: 'Most visited', downloads: 'Downloads', history: 'History' };
    const wl = WIDGET_LABELS[w.type];
    const removeLabel = wl ? `Delete ${wl} widget` : 'Delete widget';
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
    } else if (w.type === 'downloads' || w.type === 'history') {
      extra = `<div class="ws-item" data-act="refreshlist"><span class="mi-ic">${ICONS.refresh}</span>Refresh list</div><hr>`;
    }
    menu.innerHTML = `${extra.replace(/<hr>\s*$/, '')}${tintMenuItemHtml()}<hr>${widthMenuItemsHtml(w)}${heightMenuItemsHtml(w)}<hr><div class="ws-item" data-act="remove" data-danger><span class="mi-ic">${ICONS.trash}</span>${removeLabel}</div>`;
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
    const refreshListBtn = menu.querySelector('[data-act=refreshlist]');
    if (refreshListBtn) refreshListBtn.onclick = async () => { close(); await reload(); };
    wireWidthMenuItems(menu, w, close);
    wireHeightMenuItems(menu, w, close);
    wireTintMenuItem(menu, w, close);
    menu.querySelector('[data-act=remove]').onclick = async () => {
      close();
      if (w.type === 'rss' && w.feedUrl) revokeFeedPermission(w.feedUrl, w.id);
      await DB.deleteWidget(w.id);
      await reload();
    };
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
      return indicator;
    }
    return item;
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
