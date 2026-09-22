  /* Bookmarks, selection/bulk actions, nav, sessions, trash and the
   add-widget flow. Composes with the other newtab modules via the shared
   global scope (see index.html). */
  /* ============ BOOKMARKS ============ */
  function openBookmarkUrl(bm) { sendMsg('OPEN_URL', { url: bm.url }); }

  /* Virtual bookmarks: live browser data (Most visited, History) rendered
     through the same bookmark-item/tile look and open/copy behavior as a
     real collection, but with no store operations behind them. */
  async function copyTextToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }
  function openVirtualBookmarkMenu(bm, rect, titleEl) {
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="open"><span class="mi-ic">${ICONS.openAll}</span>Open</div>
      <div class="ws-item" data-act="opennew"><span class="mi-ic">${ICONS.externalWindow}</span>Open in a new tab</div>
      <div class="ws-item" data-act="copy"><span class="mi-ic">${ICONS.copy}</span>Copy link</div>`;
    const close = showDropdown(menu, rect, 200);
    menu.querySelector('[data-act=open]').onclick = () => { close(); openBookmarkUrl(bm); };
    menu.querySelector('[data-act=opennew]').onclick = () => { close(); sendMsg('OPEN_URL', { url: bm.url, forceNewTab: true }); };
    menu.querySelector('[data-act=copy]').onclick = async () => { close(); if (await copyTextToClipboard(bm.url)) toast('Link copied'); else toast("Couldn't copy"); };
  }
  function renderVirtualBookmark(bm, viewMode) {
    const isTile = viewMode === 'grid';
    const item = el('div', (isTile ? 'bookmark-tile' : 'bookmark-item'));
    item.dataset.bookmarkId = bm.id;
    item.draggable = true;
    const fav = bm.favicon || faviconFor(bm.url);
    const metaHtml = bm.meta ? (isTile
      ? `<div class="bm-meta" title="${escapeHtml(bm.meta)}">${escapeHtml(bm.meta)}</div>`
      : `<span class="bm-meta" title="${escapeHtml(bm.meta)}">${escapeHtml(bm.meta)}</span>`) : '';
    if (isTile) {
      item.innerHTML = `
        <button class="bm-menu-btn" data-act="menu" title="Bookmark actions">${ICONS.dots}</button>
        <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
        <div class="bm-title" title="${escapeHtml(bm.title)}">${escapeHtml(bm.title)}</div>
        ${metaHtml}`;
    } else {
      item.innerHTML = `
        <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
        <span class="bm-title" title="${escapeHtml(bm.url)}">${escapeHtml(bm.title)}</span>
        ${metaHtml}
        <button class="bm-menu-btn" data-act="menu" title="Bookmark actions">${ICONS.dots}</button>`;
    }
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-tdb-tab', JSON.stringify({ title: bm.title, url: bm.url, favIconUrl: fav }));
      item.classList.add('dragging');
      document.body.classList.add('dragging-tab');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.body.classList.remove('dragging-tab');
    });
    item.addEventListener('click', (e) => {
      const menuBtn = e.target.closest('[data-act=menu]');
      if (menuBtn) {
        e.preventDefault(); e.stopPropagation();
        openVirtualBookmarkMenu(bm, menuBtn.getBoundingClientRect(), item.querySelector('.bm-title'));
        return;
      }
      openBookmarkUrl(bm);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openVirtualBookmarkMenu(bm, { left: e.clientX, top: e.clientY, bottom: e.clientY, height: 0, width: 0 }, item.querySelector('.bm-title'));
    });
    return item;
  }

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
    if (SELECTED.has(bm.id)) {
      item.style.background = isTile
        ? `color-mix(in srgb, var(--main-color) 20%, var(--sub-alt-color))`
        : `color-mix(in srgb, var(--main-color) 20%, var(--bg-color))`;
    }
    const fav = bm.favicon || faviconFor(bm.url);
    const tagsHtml = (bm.tags || []).slice(0, 2).map(t => `<span class="bm-tag">${escapeHtml(t)}</span>`).join('');
    // Browser-synced collections store each entry's visit time; show it as a
    // small relative badge (honoring the "Show visit time" setting).
    const timeHtml = (bm.visitTime && STATE.meta.settings.historyShowTimes !== false)
      ? (isTile
        ? `<div class="bm-meta" title="${escapeHtml(formatRelTime(bm.visitTime))}">${escapeHtml(formatRelTime(bm.visitTime))}</div>`
        : `<span class="bm-meta" title="${escapeHtml(formatRelTime(bm.visitTime))}">${escapeHtml(formatRelTime(bm.visitTime))}</span>`)
      : '';

    if (isTile) {
      const selectHtml = selectMode
        ? `<input type="checkbox" class="bm-select checkbox bm-select-tile" ${SELECTED.has(bm.id) ? 'checked' : ''}>`
        : (bm.pinned ? `<span class="bm-pin-ic">${ICONS.pin}</span>` : '');
      item.innerHTML = `
        ${selectHtml}
        <button class="bm-menu-btn" data-act="menu" title="Bookmark actions">${ICONS.dots}</button>
        <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
        <div class="bm-title" title="${escapeHtml(bm.title)}">${escapeHtml(bm.title)}</div>
        ${timeHtml}`;
    } else {
      item.innerHTML = `
        ${selectMode ? `<input type="checkbox" class="bm-select checkbox" ${SELECTED.has(bm.id) ? 'checked' : ''}>` : ''}
        ${bm.pinned ? `<span class="bm-pin-ic">${ICONS.pin}</span>` : ''}
        <img class="bm-favicon" src="${fav}" onerror="this.style.visibility='hidden'">
        <span class="bm-title" title="${escapeHtml(bm.url)}">${escapeHtml(bm.title)}</span>
        ${timeHtml}
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
      ${col.syncSource ? `<div class="ws-item" data-act="sync"><span class="mi-ic">${ICONS.refresh}</span>Sync from browser now</div>` : ''}
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
    const syncItem = menu.querySelector('[data-act=sync]');
    if (syncItem) syncItem.onclick = async () => {
      close();
      toast('Syncing from browser…');
      const res = await sendMsg('SYNC_BROWSER_COLLECTIONS', {});
      await reload();
      toast((res && res.changed) ? `Synced ${res.changed} collection${res.changed === 1 ? '' : 's'}` : 'Collections are up to date');
    };
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
    if (STATE.meta.settings.confirmDelete && !(await uiConfirm(`Delete ${ids.length} bookmark${ids.length === 1 ? '' : 's'}?`, { title: 'Delete bookmarks', danger: true }))) return;
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
    const name = await uiPrompt('Session name', `Session ${new Date().toLocaleString()}`, { okLabel: 'Save', label: 'Name', placeholder: 'Session name' });
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
    const name = await uiPrompt('Session name', `All windows — ${new Date().toLocaleString()}`, { okLabel: 'Save', label: 'Name', placeholder: 'Session name' });
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
        if (STATE.meta.settings.confirmRestoreSession && !(await uiConfirm(`Restore "${s.name}" (${s.tabs.length} tabs)${newWindow ? ' in a new window' : ''}?`, { title: 'Restore session', okLabel: 'Restore' }))) return;
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
      const name = await uiPrompt('Rename session', s.name, { okLabel: 'Rename', label: 'Name', placeholder: 'Session name' });
      if (name && name !== s.name) { await DB.renameSession(s.id, name); await reload(); }
    };
    menu.querySelector('[data-act=dup]').onclick = async () => { close(); await DB.duplicateSession(s.id); await reload(); };
    menu.querySelector('[data-act=tocol]').onclick = async () => {
      close();
      const name = await uiPrompt('New collection name', s.name, { okLabel: 'Create', label: 'Name', placeholder: 'Collection name' });
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
      if (!(await uiConfirm(`Delete session "${s.name}"?`, { title: 'Delete session', danger: true }))) return;
      await DB.deleteSession(s.id);
      await reload();
    };
  }

  /* ============ TRASH ============ */
  function updateTrashBadge() {
    const badge = $('#trash-badge');
    if (!badge) return;
    const count = Object.keys(STATE.trash || {}).length;
    const seen = Number(STATE.meta.settings.trashBadgeSeen || 0);
    badge.textContent = String(Math.min(count, 99));
    /* Mark-as-read: the badge hides once the trash panel has been opened for
       the current count, and only reappears when new items are deleted. The
       seen count is persisted so it stays dismissed across reloads. */
    badge.classList.toggle('hidden', count === 0 || seen === count);
  }

  function openTrashPanel() {
    const list = $('#trash-list');
    const summary = $('#trash-summary');
    const countPill = $('#trash-count-pill');
    const emptyBtn = $('#empty-trash-btn');
    const items = Object.values(STATE.trash).sort((a, b) => b.deletedAt - a.deletedAt);
    const count = items.length;
    STATE.meta.settings.trashBadgeSeen = count;
    DB.updateSettings({ trashBadgeSeen: count });
    updateTrashBadge();
    emptyBtn.disabled = !count;
    countPill.textContent = String(count);
    countPill.hidden = !count;
    summary.textContent = count
      ? `${count} item${count === 1 ? '' : 's'} — deleted collections and bookmarks live here until you purge them.`
      : 'Nothing here — deleted collections and bookmarks land in the trash.';
    list.innerHTML = '';
    items.forEach(item => {
      const isCol = item.type === 'collection';
      const title = isCol ? item.data.collection.name : (item.data.title || item.data.url);
      const color = isCol ? item.data.collection.color : null;
      const iconHtml = isCol
        ? `<span class="trash-item-icon" style="color:${color ? escapeHtml(color) : 'var(--main-color)'}">${ICONS.folder}</span>`
        : `<span class="trash-item-icon">${item.data.favicon ? `<img src="${item.data.favicon}" alt="" onerror="this.style.display='none'">` : ICONS.link}</span>`;
      const row = el('div', 'trash-item');
      row.dataset.type = item.type;
      row.innerHTML = `${iconHtml}
        <div class="trash-item-main">
          <div class="trash-item-title">${escapeHtml(title)}</div>
          <div class="trash-item-meta"><span class="ti-type">${isCol ? 'Collection' : 'Bookmark'}</span><span class="ti-time">${formatRelTime(item.deletedAt)}</span></div>
        </div>
        <div class="trash-actions">
          <button data-act="restore" title="Restore" aria-label="Restore">${ICONS.refresh}</button>
          <button data-act="purge" title="Delete forever" aria-label="Delete forever">${ICONS.trash}</button>
        </div>`;
      row.querySelector('[data-act=restore]').onclick = async () => {
        await DB.restoreTrashItem(item.id);
        await reload();
        openTrashPanel();
      };
      row.querySelector('[data-act=purge]').onclick = async () => {
        if (STATE.meta.settings.confirmDelete && !(await uiConfirm('Permanently delete this item? This cannot be undone.', { title: 'Delete permanently', danger: true }))) return;
        await DB.purgeTrashItem(item.id);
        await reload();
        openTrashPanel();
      };
      list.appendChild(row);
    });
    if (!items.length) {
      const empty = el('div', 'trash-empty');
      empty.innerHTML = `<span class="trash-empty-ic">${ICONS.archive}</span>
        <span>Trash is empty — deleted collections and bookmarks<br>land here so nothing is lost until you purge it.</span>`;
      list.appendChild(empty);
    }
    showOverlay('#trash-overlay');
  }

  /* ============ WIDGETS: add ============ */
  const WIDGET_TYPE_LABELS = {
    notes: 'Notes', todo: 'To-Do', clock: 'Clock',
    search: 'Search box', countdown: 'Countdown', pomodoro: 'Pomodoro', timer: 'Timer', stopwatch: 'Stopwatch',
    weather: 'Weather', rss: 'RSS Feed', topSites: 'Most visited', downloads: 'Recent downloads', history: 'Browsing history'
  };
  async function addWidget(type) {
    // Most visited / History are snapshotted into a *real* collection
    // (stored bookmarks + a normal collection widget), not rendered as a
    // live browser-data view.
    if (type === 'topSites' || type === 'history') {
      await addBrowserDataCollection(type);
      return;
    }
    await DB.createWidget(activeWorkspaceId(), type);
    await reload();
    toast(`${WIDGET_TYPE_LABELS[type] || 'Widget'} added`);
  }

  async function addBrowserDataCollection(kind) {
    const s = STATE.meta.settings;
    const msg = { kind, workspaceId: activeWorkspaceId() };
    if (kind === 'history') msg.count = Math.max(1, Number(s.historyCount) || 10);
    else msg.count = Math.max(1, Number(s.topSitesCount) || 12);
    const res = await sendMsg('ADD_BROWSER_COLLECTION', msg);
    if (!res || !res.ok) {
      const err = res && res.error;
      toast(err === 'not supported' ? 'Not supported in this browser' : err === 'empty' ? 'Nothing to copy from the browser yet' : 'Could not create the collection');
      return;
    }
    await reload();
    toast(`Created "${res.name}" collection with ${res.count} item${res.count === 1 ? '' : 's'} — it stays in sync with the browser`);
  }

  /* Widgets of the old live-preview era (type topSites/history) are one-time
     converted into real collections on load — that's the behavior the user
     asked for, and it also removes their stale "No top sites available" /
     "No browsing history yet" empty states. Runs once per session, off to
     the side so it never delays first paint. */
  let migratedBrowserWidgets = false;
  async function migrateLegacyBrowserWidgets() {
    if (migratedBrowserWidgets) return;
    migratedBrowserWidgets = true;
    const legacy = widgetsForActiveWS().filter(w => w.type === 'topSites' || w.type === 'history');
    if (!legacy.length) return;
    let converted = 0;
    for (const w of legacy) {
      const kind = w.type === 'topSites' ? 'topSites' : 'history';
      const s = STATE.meta.settings || {};
      const count = kind === 'history'
        ? Math.max(1, Number(s.historyCount) || 10)
        : Math.max(1, Number(s.topSitesCount) || 12);
      const res = await sendMsg('ADD_BROWSER_COLLECTION', { kind, workspaceId: activeWorkspaceId(), count });
      if (res && res.ok) {
        await DB.deleteWidget(w.id);
        converted++;
      }
    }
    if (converted) {
      await reload();
      toast(`Converted ${converted} browser widget${converted === 1 ? '' : 's'} into real collection${converted === 1 ? '' : 's'}`);
    }
  }
  function openAddWidgetMenu(anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menu = el('div', 'dropdown-menu');
    menu.innerHTML = `
      <div class="ws-item" data-act="notes"><span class="mi-ic">${ICONS.notes}</span>Notes</div>
      <div class="ws-item" data-act="todo"><span class="mi-ic">${ICONS.checkSquare}</span>To-Do checklist</div>
      <div class="ws-item" data-act="clock"><span class="mi-ic">${ICONS.clock}</span>Clock &amp; date</div>
      <div class="ws-item" data-act="search"><span class="mi-ic">${ICONS.search}</span>Search box</div>
      <div class="ws-item" data-act="countdown"><span class="mi-ic">${ICONS.hourglass}</span>Countdown</div>
      <div class="ws-item" data-act="pomodoro"><span class="mi-ic">${ICONS.target}</span>Pomodoro timer</div>
      <div class="ws-item" data-act="timer"><span class="mi-ic">${ICONS.timer}</span>Timer</div>
      <div class="ws-item" data-act="stopwatch"><span class="mi-ic">${ICONS.stopwatch}</span>Stopwatch</div>
      <div class="ws-item" data-act="weather"><span class="mi-ic">${ICONS.cloudSun}</span>Weather</div>
      <div class="ws-item" data-act="rss"><span class="mi-ic">${ICONS.rss}</span>RSS Feed</div>
      <div class="ws-item" data-act="topSites"><span class="mi-ic">${ICONS.grid}</span>Most visited collection</div>
      <div class="ws-item" data-act="downloads"><span class="mi-ic">${ICONS.download}</span>Recent downloads</div>
      <div class="ws-item" data-act="history"><span class="mi-ic">${ICONS.rotateCcwClock}</span>History collection</div>`;
    const close = showDropdown(menu, rect, 200);
    $$('.ws-item', menu).forEach(item => { item.onclick = () => { close(); addWidget(item.dataset.act); }; });
  }

  /* Uses the browser's own search engine via chrome.search (a new tab
     keeps focus on the dashboard). Falls back to the saved web engine's
     URL when the API isn't available. */
  const SEARCH_URLS = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q='
  };
  const SEARCH_ENGINE_LABELS = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' };
  async function searchTheWeb() {
    const engine = STATE.meta.settings.searchEngine || 'google';
    const q = await uiPrompt('Search the web', '', { okLabel: 'Search', placeholder: 'Search query…', message: `Engine: ${SEARCH_ENGINE_LABELS[engine] || 'Google'}` });
    if (q === null || !q.trim()) return;
    const res = await sendMsg('SEARCH_WEB', { text: q.trim() });
    if (!res || !res.ok) {
      sendMsg('OPEN_URL', { url: (SEARCH_URLS[engine] || SEARCH_URLS.google) + encodeURIComponent(q.trim()), forceNewTab: true });
    }
  }

  /* Pulls the browser's own bookmarks (chrome.bookmarks) into the active
     workspace as collections. Runs in the background so the tree walk and
     the bulk write happen outside the dashboard, and the context menus
     rebuild once instead of per bookmark. */
  async function importBrowserBookmarksViaFilePicker() {
    if (!(await uiConfirm('Import browser bookmarks into this workspace? New collections will be created for your bookmark folders.', { title: 'Import bookmarks', okLabel: 'Import' }))) return;
    const res = await sendMsg('IMPORT_BOOKMARKS');
    if (!res || !res.ok) {
      toast((res && res.error) === 'not supported' ? 'Bookmarks API unavailable in this browser' : 'Bookmark import failed');
      return;
    }
    await reload();
    toast(`Imported ${res.bookmarks} bookmark${res.bookmarks === 1 ? '' : 's'} into ${res.collections} collection${res.collections === 1 ? '' : 's'}`);
  }
