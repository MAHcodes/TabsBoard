/* TabsBoard — board views.
   How the active board is shown. Each board can pick its own view (`board.boardMode`, set from
   the toolbar switcher, Settings → Board or the command palette); a board without one follows the
   workspace default (`settings.boardMode`).

     grid    widgets snap to the board's columns (the default)
     canvas  free-form: drag and resize widgets anywhere, snapped to a 20px grid
     split   a collections list on the left and the selected collection on the right

   Canvas rectangles live on the widget records (cx, cy, cw, ch, cz). This is a classic
   script sharing the global scope with dashboard.js / widgets.js / bookmarks.js / palette.js;
   it loads after bookmarks.js and before palette.js (see index.html). */

  /* ============ CATALOG ============ */
  const BOARD_VIEWS = [
    { id: 'grid', label: 'Grid', icon: 'grid', desc: 'Widgets snap to columns. Drag a widget onto another to swap, resize from its edge.' },
    { id: 'canvas', label: 'Canvas', icon: 'move', desc: 'Free-form: drag widgets by their title bar and resize from the edges. Everything snaps to a 20 px grid. Keyboard: focus a title bar, arrows move, Shift+arrows resize.' },
    { id: 'split', label: 'Split', icon: 'columns', desc: 'A collections list on the left, the selected collection on the right — like a mail client. Drag a bookmark onto a collection in the list to move it.' }
  ];
  const BOARD_VIEW_IDS = BOARD_VIEWS.map(v => v.id);
  const boardViewOf = (s) => (s && BOARD_VIEW_IDS.includes(s.boardMode)) ? s.boardMode : 'grid';

  /* The workspace default, and the view the active board actually uses (its own choice if it has one). */
  const defaultBoardView = () => boardViewOf(DB.settingsOf(STATE));
  function boardOwnView() {
    const b = STATE.boards[activeBoardId()];
    return b && BOARD_VIEW_IDS.includes(b.boardMode) ? b.boardMode : null;
  }
  const activeBoardView = () => boardOwnView() || defaultBoardView();

  const canvasActive = () => activeBoardView() === 'canvas';
  const splitActive = () => activeBoardView() === 'split';

  /* Classes only, no DOM rebuilding. Runs on every render pass, since switching boards can switch views. */
  function applyBoardView() {
    const view = activeBoardView();
    const root = document.documentElement;
    BOARD_VIEW_IDS.forEach(id => root.classList.toggle('board-' + id, id === view));
    syncBoardViewUI(DB.settingsOf(STATE));
  }

  /* ============ SPLIT VIEW ============ */
  const splitSel = {};           // boardId -> selected widget id
  const splitKnown = {};         // boardId -> Set of widget ids seen (to select a freshly created one)
  let splitShownId = null;

  function splitStoredSel(boardId) {
    if (splitSel[boardId]) return splitSel[boardId];
    try { return sessionStorage.getItem('tb.split.' + boardId) || null; } catch (e) { return null; }
  }
  function splitSelectWidget(widgetId, rerender) {
    const w = STATE.widgets[widgetId];
    if (!w) return;
    splitSel[w.boardId] = widgetId;
    try { sessionStorage.setItem('tb.split.' + w.boardId, widgetId); } catch (e) {}
    if (rerender && currentNav === 'collections') renderBoard();
  }

  /* renderBoard() hands over the (query-filtered) widget list; two-pane shows only the selected one. */
  function boardViewVisibleWidgets(all) {
    if (!splitActive()) { splitShownId = null; return all; }
    const bid = activeBoardId();
    const known = splitKnown[bid];
    const ids = new Set(all.map(w => w.id));
    if (known) {
      const fresh = all.filter(w => !known.has(w.id) && w.type === 'collection');
      if (fresh.length) splitSelectWidget(fresh[fresh.length - 1].id);
    }
    splitKnown[bid] = new Set(Object.values(STATE.widgets).filter(w => w.boardId === bid).map(w => w.id));
    let id = splitStoredSel(bid);
    if (!id || !ids.has(id)) id = all.length ? all[0].id : null;
    splitShownId = id;
    return id ? all.filter(w => w.id === id) : [];
  }

  function paneItemLabel(w) {
    if (w.type === 'collection') { const c = STATE.collections[w.collectionId]; return c ? c.name : 'Collection'; }
    return (typeof WIDGET_TYPE_LABELS !== 'undefined' && WIDGET_TYPE_LABELS[w.type]) || (w.type === 'plugin' ? 'Plugin widget' : 'Widget');
  }
  function renderPaneList(all) {
    const list = $('#pane-list');
    if (!list) return;
    const cols = all.filter(w => w.type === 'collection');
    const others = all.filter(w => w.type !== 'collection');
    const item = (w) => {
      const c = w.type === 'collection' ? STATE.collections[w.collectionId] : null;
      const count = c ? (bmFilter && bmFilter.has(c.id) ? bmFilter.get(c.id).size : bookmarksForCollection(c.id).length) : null;
      const sel = w.id === splitShownId;
      return `<button type="button" role="option" class="pane-item${sel ? ' active' : ''}" data-wid="${escapeHtml(w.id)}" aria-selected="${sel}" tabindex="${sel ? 0 : -1}"${c && !c.syncSource ? ` data-col="${escapeHtml(c.id)}"` : ''}>
        ${c ? `<span class="pane-dot" style="background:${escapeHtml(c.color || 'var(--main-color)')}"></span>` : `<span class="pane-dot pane-dot-widget"></span>`}
        <span class="pane-name">${escapeHtml(paneItemLabel(w))}</span>
        ${count !== null ? `<span class="pane-count">${count}</span>` : ''}
      </button>`;
    };
    list.innerHTML = `
      <div class="pane-head"><span>Collections</span><button type="button" class="icon-btn small" data-pane-act="new" title="New collection (C)" aria-label="New collection">${icon('plus', 'sm')}</button></div>
      <div class="pane-items" role="listbox" aria-label="Collections">${cols.length ? cols.map(item).join('') : '<div class="pane-empty">No collections yet</div>'}</div>
      ${others.length ? `<div class="pane-head"><span>Widgets</span></div><div class="pane-items" role="listbox" aria-label="Widgets">${others.map(item).join('')}</div>` : ''}`;
  }

  function wirePaneList() {
    const list = $('#pane-list');
    if (!list) return;
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-pane-act=new]')) { openCollectionModal(); return; }
      const it = e.target.closest('.pane-item');
      if (it) splitSelectWidget(it.dataset.wid, true);
    });
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(list.querySelectorAll('.pane-item'));
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      splitSelectWidget(next.dataset.wid, true);
      const again = list.querySelector(`.pane-item[data-wid="${CSS.escape(next.dataset.wid)}"]`);
      if (again) again.focus();
    });
    // Drag a bookmark onto a collection in the list to move it there, as in a mail client.
    list.addEventListener('dragover', (e) => {
      const it = e.target.closest('.pane-item[data-col]');
      if (!it || !e.dataTransfer.types.includes('application/x-tdb-bookmark')) return;
      e.preventDefault();
      list.querySelectorAll('.drag-over').forEach(n => { if (n !== it) n.classList.remove('drag-over'); });
      it.classList.add('drag-over');
    });
    list.addEventListener('dragleave', (e) => {
      const it = e.target.closest('.pane-item');
      if (it && !it.contains(e.relatedTarget)) it.classList.remove('drag-over');
    });
    list.addEventListener('drop', async (e) => {
      const it = e.target.closest('.pane-item[data-col]');
      const id = e.dataTransfer.getData('application/x-tdb-bookmark');
      if (!it || !id) return;
      e.preventDefault();
      it.classList.remove('drag-over');
      const ids = SELECTED.has(id) && SELECTED.size > 1 ? Array.from(SELECTED) : [id];
      await DB.moveBookmarks(ids, it.dataset.col);
      SELECTED.clear(); selectMode = false;
      await reload();
      const c = STATE.collections[it.dataset.col];
      toast(`Moved ${ids.length === 1 ? 'bookmark' : ids.length + ' bookmarks'} to "${c ? c.name : 'collection'}"`);
    });
  }

  /* ============ FREE-FORM CANVAS ============ */
  const CANVAS_GRID = 20, CANVAS_MIN_W = 200, CANVAS_MIN_H = 120;
  const canvasSnap = (v) => Math.round(v / CANVAS_GRID) * CANVAS_GRID;
  const canvasPending = new Set();   // widget ids whose first placement is still being written

  function widgetHasRect(w) {
    return ['cx', 'cy', 'cw', 'ch'].every(k => typeof w[k] === 'number' && isFinite(w[k]));
  }

  /* Starting size for a widget that has never been placed on the canvas: its grid size. */
  function canvasDefaultSize(w, boardW) {
    const cols = Math.max(1, (DB.settingsOf(STATE).dashboard && DB.settingsOf(STATE).dashboard.columns) || 4);
    const colW = (boardW - CANVAS_GRID * (cols - 1)) / cols;
    const span = Math.max(1, w.span || 1), rows = Math.max(1, w.rowSpan || 1);
    return {
      w: Math.min(canvasSnap(boardW), Math.max(CANVAS_MIN_W, canvasSnap(span * colW + (span - 1) * CANVAS_GRID))),
      h: Math.max(CANVAS_MIN_H, canvasSnap(rows * 240 + (rows - 1) * CANVAS_GRID))
    };
  }

  /* First free spot (left→right, top→bottom, on the snap grid) for a w×h rectangle. */
  function canvasFindSpot(rects, w, h, boardW) {
    const list = Array.from(rects.values());
    const free = (x, y) => !list.some(r => x < r.x + r.w + CANVAS_GRID && x + w + CANVAS_GRID > r.x && y < r.y + r.h + CANVAS_GRID && y + h + CANVAS_GRID > r.y);   // one cell of breathing room
    for (let y = 0; ; y += CANVAS_GRID) {
      for (let x = 0; x + w <= boardW + 1; x += CANVAS_GRID) if (free(x, y)) return { x, y };
    }
  }

  function applyCanvasRect(card, r) {
    card.__cr = r;
    card.style.setProperty('--cx', r.x + 'px');
    card.style.setProperty('--cy', r.y + 'px');
    card.style.setProperty('--cw', r.w + 'px');
    card.style.setProperty('--ch', r.h + 'px');
    card.style.setProperty('--cz', String(r.z || 0));
  }
  function updateCanvasHeight() {
    const board = $('#board');
    if (!board) return;
    let bottom = 0;
    board.querySelectorAll(':scope > .widget').forEach(c => { if (c.__cr) bottom = Math.max(bottom, c.__cr.y + c.__cr.h); });
    board.style.setProperty('--canvas-h', (bottom + 160) + 'px');
  }

  function paintCanvas() {
    const board = $('#board');
    if (!board) return;
    const boardW = board.clientWidth;
    if (boardW < 240) return;                       // hidden (Sessions view) or not laid out yet
    const all = Object.values(STATE.widgets).filter(w => w.boardId === activeBoardId() && (w.type !== 'collection' || STATE.collections[w.collectionId]));
    const rects = new Map();
    const missing = [];
    all.forEach(w => {
      if (widgetHasRect(w)) rects.set(w.id, { x: w.cx, y: w.cy, w: w.cw, h: w.ch, z: w.cz || 0 });
      else missing.push(w);
    });
    if (missing.length) {
      const patches = {};
      missing.sort((a, b) => a.order - b.order).forEach(w => {
        const size = canvasDefaultSize(w, boardW);
        const pos = canvasFindSpot(rects, size.w, size.h, boardW);
        const r = { x: pos.x, y: pos.y, w: size.w, h: size.h, z: 0 };
        rects.set(w.id, r);
        if (!canvasPending.has(w.id)) patches[w.id] = { cx: r.x, cy: r.y, cw: r.w, ch: r.h, cz: 0 };
      });
      const ids = Object.keys(patches);
      if (ids.length) {
        ids.forEach(id => canvasPending.add(id));
        DB.setWidgetRects(patches).finally(() => ids.forEach(id => canvasPending.delete(id)));
      }
    }
    board.querySelectorAll(':scope > .widget').forEach(card => {
      const r = rects.get(card.dataset.widgetId);
      if (!r) return;
      // Never let a widget hang off the right edge (e.g. after the window got narrower):
      // only the displayed rectangle is clamped, the stored one is left alone.
      const w = Math.min(r.w, boardW);
      applyCanvasRect(card, { x: Math.max(0, Math.min(r.x, boardW - w)), y: r.y, w, h: r.h, z: r.z });
    });
    updateCanvasHeight();
  }

  async function canvasAutoArrange() {
    const board = $('#board');
    const boardW = board ? board.clientWidth : 0;
    if (!boardW) { toast('Open the Collections view first'); return; }
    const widgets = widgetsForActiveWS().slice().sort((a, b) => {
      const ay = widgetHasRect(a) ? a.cy : 1e9, by = widgetHasRect(b) ? b.cy : 1e9;
      return ay - by || (widgetHasRect(a) ? a.cx : 0) - (widgetHasRect(b) ? b.cx : 0) || a.order - b.order;
    });
    const rects = new Map(), patches = {};
    widgets.forEach(w => {
      const base = widgetHasRect(w) ? { w: Math.min(boardW, Math.max(CANVAS_MIN_W, canvasSnap(w.cw))), h: Math.max(CANVAS_MIN_H, canvasSnap(w.ch)) } : canvasDefaultSize(w, boardW);
      const pos = canvasFindSpot(rects, base.w, base.h, boardW);
      rects.set(w.id, { x: pos.x, y: pos.y, w: base.w, h: base.h });
      patches[w.id] = { cx: pos.x, cy: pos.y, cw: base.w, ch: base.h, cz: 0 };
    });
    await DB.setWidgetRects(patches);
    await reload();
    toast('Widgets arranged');
  }

  function startCanvasDrag(card, e, mode, axes) {
    const board = $('#board');
    const id = card.dataset.widgetId;
    const r0 = Object.assign({}, card.__cr || { x: 0, y: 0, w: card.offsetWidth, h: card.offsetHeight, z: 0 });
    const boardW = board.clientWidth;
    const startX = e.clientX, startY = e.clientY;
    let maxZ = 0;
    board.querySelectorAll(':scope > .widget').forEach(c => { if (c.__cr) maxZ = Math.max(maxZ, c.__cr.z || 0); });
    const cur = Object.assign({}, r0, { z: Math.max(r0.z || 0, maxZ + 1) });   // the widget you're working on comes to the front
    card.classList.add(mode === 'move' ? 'canvas-moving' : 'canvas-resizing');
    applyCanvasRect(card, cur);
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (mode === 'move') {
        cur.x = Math.max(0, Math.min(canvasSnap(r0.x + dx), Math.max(0, boardW - r0.w)));
        cur.y = Math.max(0, canvasSnap(r0.y + dy));
      } else {
        if (axes.x) cur.w = Math.max(CANVAS_MIN_W, Math.min(canvasSnap(r0.w + dx), Math.max(CANVAS_MIN_W, boardW - r0.x)));
        if (axes.y) cur.h = Math.max(CANVAS_MIN_H, canvasSnap(r0.h + dy));
      }
      applyCanvasRect(card, cur);
      updateCanvasHeight();
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      card.classList.remove('canvas-moving', 'canvas-resizing');
      const changed = cur.x !== r0.x || cur.y !== r0.y || cur.w !== r0.w || cur.h !== r0.h || cur.z !== r0.z;
      if (changed) { await DB.setWidgetRects({ [id]: { cx: cur.x, cy: cur.y, cw: cur.w, ch: cur.h, cz: cur.z } }); await reload(); }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function wireCanvas() {
    const board = $('#board');
    if (!board) return;
    // Capture phase: in canvas mode these handlers take over from the grid's own resize / drag-swap.
    board.addEventListener('mousedown', (e) => {
      if (!board.classList.contains('canvas') || e.button !== 0) return;
      const card = e.target.closest('.widget');
      if (!card || card.parentElement !== board) return;
      const handle = e.target.closest('.widget-resize-handle, .widget-resize-handle-b, .widget-resize-handle-c');
      if (handle) {
        const axes = handle.classList.contains('widget-resize-handle') ? { x: true, y: false } : handle.classList.contains('widget-resize-handle-b') ? { x: false, y: true } : { x: true, y: true };
        e.preventDefault(); e.stopPropagation();
        startCanvasDrag(card, e, 'resize', axes);
        return;
      }
      const header = e.target.closest('.widget-header');
      if (header && header.parentElement === card && !e.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) {
        e.preventDefault();
        startCanvasDrag(card, e, 'move');
      }
    }, true);

    // Keyboard: focus a widget's title bar, arrows move it, Shift+arrows resize it.
    let keyTimer = null;
    board.addEventListener('keydown', (e) => {
      if (!board.classList.contains('canvas') || !e.target.classList || !e.target.classList.contains('widget-header')) return;
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const card = e.target.parentElement;
      const r = Object.assign({}, card.__cr);
      const boardW = board.clientWidth;
      if (e.shiftKey) {
        r.w = Math.max(CANVAS_MIN_W, Math.min(r.w + dir[0] * CANVAS_GRID, Math.max(CANVAS_MIN_W, boardW - r.x)));
        r.h = Math.max(CANVAS_MIN_H, r.h + dir[1] * CANVAS_GRID);
      } else {
        r.x = Math.max(0, Math.min(r.x + dir[0] * CANVAS_GRID, Math.max(0, boardW - r.w)));
        r.y = Math.max(0, r.y + dir[1] * CANVAS_GRID);
      }
      applyCanvasRect(card, r);
      updateCanvasHeight();
      clearTimeout(keyTimer);
      keyTimer = setTimeout(async () => {
        await DB.setWidgetRects({ [card.dataset.widgetId]: { cx: r.x, cy: r.y, cw: r.w, ch: r.h } });
        await reload();
      }, 350);
    });

    const tidy = $('#canvas-tidy-btn');
    if (tidy) tidy.onclick = canvasAutoArrange;
  }

  /* ============ AFTER EVERY BOARD PASS ============ */
  function boardViewAfterRender(allWidgets) {
    const board = $('#board');
    if (!board) return;
    const canvas = canvasActive();
    board.classList.toggle('canvas', canvas);
    const tidy = $('#canvas-tidy-btn');
    if (tidy) tidy.classList.toggle('hidden', !canvas);
    board.querySelectorAll(':scope > .widget').forEach(card => {
      const w = STATE.widgets[card.dataset.widgetId];
      if (w) { card.dataset.span = String(w.span || 1); card.dataset.rowspan = String(w.rowSpan || 1); }
      const header = card.querySelector(':scope > .widget-header');
      if (header) {
        header.draggable = !canvas;                         // the canvas has its own pointer-driven drag
        if (canvas) { header.tabIndex = 0; header.setAttribute('aria-label', 'Widget title bar. Arrow keys move, Shift plus arrows resize.'); }
        else { header.removeAttribute('tabindex'); header.removeAttribute('aria-label'); }
      }
    });
    if (splitActive()) renderPaneList(allWidgets);
    if (canvas) paintCanvas(); else board.style.removeProperty('--canvas-h');
  }

  /* ============ SWITCHERS (toolbar + Settings → Board) ============ */
  const viewLabel = (id) => (BOARD_VIEWS.find(v => v.id === id) || {}).label || id;

  function syncBoardViewUI() {
    const view = activeBoardView(), own = boardOwnView(), def = defaultBoardView();
    $$('#board-view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === view));
    $$('#boardview-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === def));
    $$('#boardview-this-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === (own || 'default')));
    const board = STATE.boards[activeBoardId()];
    const name = $('#boardview-this-name');
    if (name) name.textContent = board ? board.name : '';
    const hint = $('#boardview-hint');
    if (hint) {
      const v = BOARD_VIEWS.find(x => x.id === view);
      hint.textContent = (own ? '' : `Following the default (${viewLabel(def)}). `) + (v ? v.desc : '');
    }
    const cols = $('#row-board-cols');
    if (cols) cols.classList.toggle('hidden', view !== 'grid');
    const tidy = $('#canvas-tidy-btn');
    if (tidy) tidy.classList.toggle('hidden', view !== 'canvas');
  }

  /* Pick a view for the active board; null hands the choice back to the workspace default. */
  async function setBoardView(view) {
    const id = activeBoardId();
    if (!id || boardOwnView() === (view || null)) return;
    await DB.setBoardMode(id, view);
    await reload();
    if (typeof syncSettingsUI === 'function') syncSettingsUI();
  }

  async function setDefaultBoardView(view) {
    if (!BOARD_VIEW_IDS.includes(view) || defaultBoardView() === view) return;
    await DB.updateSettings({ boardMode: view });
    await reload();
    if (typeof syncSettingsUI === 'function') syncSettingsUI();
  }

  function wireBoardViewSettings() {
    const fill = (sel, extra, handler) => {
      const box = $(sel);
      if (!box) return;
      const btn = (id, label, icon, title) => `<button type="button" data-val="${id}" title="${escapeHtml(title)}">${icon ? `<span class="seg-ic">${icon}</span>` : ''}<span class="seg-label">${escapeHtml(label)}</span></button>`;
      box.innerHTML = (extra ? btn('default', 'Default', '', 'Follow the workspace default') : '') +
        BOARD_VIEWS.map(v => btn(v.id, v.label, ICONS[v.icon] || '', sel === '#board-view-toggle' ? `${v.label} view for this board` : `${v.label} view`)).join('');
      box.addEventListener('click', (e) => { const b = e.target.closest('button[data-val]'); if (b) handler(b.dataset.val); });
    };
    fill('#board-view-toggle', false, (v) => setBoardView(v));
    fill('#boardview-this-toggle', true, (v) => setBoardView(v === 'default' ? null : v));
    fill('#boardview-toggle', false, setDefaultBoardView);
    syncBoardViewUI();
  }

  /* ============ WIRING ============ */
  function wireBoardViews() {
    wirePaneList();
    wireCanvas();
    wireBoardViewSettings();
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if ($('#board') && $('#board').classList.contains('canvas')) paintCanvas();
      }, 120);
    });
  }
