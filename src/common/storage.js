/* TabsBoard — shared storage & data model
 * Works identically under chrome.* (Chrome MV3) and chrome.* alias (Firefox MV2).
 * Everything lives under a single chrome.storage.local key so we can read/write
 * the whole app state atomically and keep sync logic trivial.
 */

const STORAGE_KEY = 'tdb_data';
const SCHEMA_VERSION = 20;

const DEFAULT_COLLECTION_COLORS = (typeof self !== 'undefined' && self.Themes) ? self.Themes.COLLECTION_COLORS : [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#0ea5e9'
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function now() { return Date.now(); }

/* Resolves which board a newly created widget should land on: the
   workspace's current active board, or its first board if that's somehow
   missing. Centralizing this means every widget-creating function just
   takes a workspaceId like before — no call site elsewhere needs to know
   boards exist at all. */
function activeBoardIdFor(d, workspaceId) {
  const ws = d.workspaces[workspaceId];
  if (ws && ws.activeBoardId && d.boards[ws.activeBoardId]) return ws.activeBoardId;
  const fallback = Object.values(d.boards).filter(b => b.workspaceId === workspaceId).sort((a, b) => a.order - b.order)[0];
  return fallback ? fallback.id : null;
}

/* ---------- Board grid layout ----------

   Widgets live on a CSS grid in explicit cells so empty spaces can be left
   open ("empty grid items"). Each widget carries its top-left cell as
   `row`/`col` (1-based) plus `span` (column width) and `rowSpan` (height).
   Rather than decode CSS layout, we keep placement logic in one place here.

   `occupiedCellsOfBoard` returns a Set of "r,c" strings for everything
   currently placed on a board. `firstEmptyCell` finds the top-left-most
   cell where a widget of the given size fits without overlapping. Box packing
   fills toward the top-left, matching how a normal grid reads. */
function occupiedCellsOfBoard(d, boardId) {
  const occ = new Set();
  for (const w of Object.values(d.widgets || {})) {
    if (w.boardId !== boardId || !w.row || !w.col) continue;
    const span = Math.max(1, w.span || 1);
    const rowSpan = Math.max(1, w.rowSpan || 1);
    for (let r = 0; r < rowSpan; r++) for (let c = 0; c < span; c++) occ.add((w.row + r) + ',' + (w.col + c));
  }
  return occ;
}

function boardColumnCount(d) {
  return (d.meta && d.meta.settings && d.meta.settings.dashboard && d.meta.settings.dashboard.columns) || 4;
}

function firstEmptyCell(d, boardId, span, rowSpan) {
  span = Math.max(1, span || 1);
  rowSpan = Math.max(1, rowSpan || 1);
  const cols = boardColumnCount(d);
  const occ = occupiedCellsOfBoard(d, boardId);
  for (let r = 1; ; r++) {
    for (let c = 1; c <= cols; c++) {
      let fits = true;
      for (let dr = 0; dr < rowSpan && fits; dr++) for (let dc = 0; dc < span; dc++) {
        if (c + dc > cols || occ.has((r + dr) + ',' + (c + dc))) { fits = false; break; }
      }
      if (fits) return { row: r, col: c };
    }
  }
}

/* Assign a top-left cell to a widget that is already in `d.widgets[wid]`,
   choosing the first empty cell on its board. Used by every creation path so
   new widgets respect (and never clobber) gaps left open by the user. Only
   touches the given widget — existing placements are preserved. */
function assignWidgetPosition(d, wid) {
  const w = d.widgets[wid];
  if (!w) return;
  const spot = firstEmptyCell(d, w.boardId, w.span, w.rowSpan);
  w.row = spot.row;
  w.col = spot.col;
}

/* Does the rectangle (row,col,span,rowSpan) overlap any widget on `boardId`
   besides the one with id `ignoreId`? Used to keep swaps and placements from
   ever stacking widgets, even when the widgets involved have different
   sizes. */
function rectOverlapsWidget(d, boardId, row, col, span, rowSpan, ignoreIds) {
  span = Math.max(1, span || 1);
  rowSpan = Math.max(1, rowSpan || 1);
  for (const o of Object.values(d.widgets || {})) {
    if (o.boardId !== boardId || !o.row || !o.col) continue;
    if (ignoreIds && ignoreIds.has(o.id)) continue;
    const oc = o.col, or = o.row, oSpan = o.span || 1, oRow = o.rowSpan || 1;
    if (row < or + oRow && row + rowSpan > or && col < oc + oSpan && col + span > oc) return true;
  }
  return false;
}

/* Swap two widgets on the board by exchanging their top-left cells. Used for
   drag-to-reorder so arrangement (including open gaps) stays in the user's
   control. If the two widgets have different sizes, a plain cell swap could
   make one overlap a *third* widget — in that case the swap is refused so the
   board never stacks things. */
async function swapWidgetPositions(idA, idB) {
  return setState((d) => {
    const a = d.widgets[idA], b = d.widgets[idB];
    if (!a || !b) return;
    if (a.boardId !== b.boardId) return;
    const aSpan = Math.max(1, a.span || 1), aRow = Math.max(1, a.rowSpan || 1);
    const bSpan = Math.max(1, b.span || 1), bRow = Math.max(1, b.rowSpan || 1);
    const self = new Set([idA, idB]);
    // A lands where B was, B lands where A was. Both must fit without running
    // into a third widget, otherwise the swap is unsafe and we bail.
    const aFits = !rectOverlapsWidget(d, a.boardId, b.row, b.col, aSpan, aRow, self);
    const bFits = !rectOverlapsWidget(d, a.boardId, a.row, a.col, bSpan, bRow, self);
    if (!aFits || !bFits) return;
    const r = a.row, c = a.col;
    a.row = b.row; a.col = b.col;
    b.row = r; b.col = c;
  });
}

/* Directly move a widget to a specific top-left cell, used by drag-into-empty
   space and "place here" affordances. Clamps to the column count so a widget
   never hangs off the right edge. */
async function moveWidgetTo(id, row, col) {
  return setState((d) => {
    const w = d.widgets[id];
    if (!w) return;
    const cols = boardColumnCount(d);
    const span = Math.max(1, w.span || 1);
    const rowSpan = Math.max(1, w.rowSpan || 1);
    const maxCol = Math.max(1, cols - span + 1);
    const r = Math.max(1, Math.round(row || 1));
    const c = Math.max(1, Math.min(maxCol, Math.round(col || 1)));
    // Refuse if the destination would overlap another widget — the board
    // never stacks things.
    for (const o of Object.values(d.widgets || {})) {
      if (o.id === id || o.boardId !== w.boardId || !o.row || !o.col) continue;
      const oc = o.col, or = o.row, oSpan = o.span || 1, oRow = o.rowSpan || 1;
      if (r < or + oRow && r + rowSpan > or && c < oc + oSpan && c + span > oc) return;
    }
    w.row = r;
    w.col = c;
  });
}

/* Repack every board's widgets into explicit row/col coordinates. This is the
   migration path — it approximates the old auto-flow look (top-left, in
   `order`, honoring spans) so nothing visually changes on upgrade. It is only
   ever run for data that lacks coordinates; existing placements are left
   alone so user-made gaps survive. */
function repackBoardWidgets(d) {
  const occPerBoard = {};
  // Seed each board's occupied set from any widgets that already carry
  // coordinates, so packing never lands a widget on top of an existing one.
  const boards = new Set(Object.values(d.widgets || {}).map(w => w.boardId).filter(Boolean));
  for (const bid of boards) occPerBoard[bid] = occupiedCellsOfBoard(d, bid);
  for (const wid of Object.keys(d.widgets || {})) {
    const w = d.widgets[wid];
    if (!w || w.row || w.col) continue;
    const bid = w.boardId;
    if (!occPerBoard[bid]) occPerBoard[bid] = new Set();
    const occ = occPerBoard[bid];
    const span = Math.max(1, w.span || 1);
    const rowSpan = Math.max(1, w.rowSpan || 1);
    const cols = boardColumnCount(d);
    let spot = null;
    for (let r = 1; !spot; r++) {
      for (let c = 1; c <= cols; c++) {
        let fits = true;
        for (let dr = 0; dr < rowSpan && fits; dr++) for (let dc = 0; dc < span; dc++) {
          if (c + dc > cols || occ.has((r + dr) + ',' + (c + dc))) { fits = false; break; }
        }
        if (fits) { spot = { r, c }; break; }
      }
    }
    w.row = spot.r;
    w.col = spot.c;
    for (let dr = 0; dr < rowSpan; dr++) for (let dc = 0; dc < span; dc++) occ.add((spot.r + dr) + ',' + (spot.c + dc));
  }
}

function defaultState() {
  const wsId = uid();
  const boardId = uid();
  const colId = uid();
  const widgetId = uid();
  return {
    version: SCHEMA_VERSION,
    meta: {
      activeWorkspaceId: wsId,
      settings: {
        themeId: 'auto',           // preset id or 'auto' (follows the OS)
        density: 'comfortable',    // spacious | comfortable | compact | dense
        radius: 'default',         // shape scale: sharp | default | rounded
        searchEngine: 'google',    // fallback engine for address-bar + palette web search
        viewMode: 'grid',          // grid | list — bookmark tiles vs rows *inside* a collection widget
        sidebarCollapsed: false,
        sidebarCompact: false,     // icon-only sidebar: favicons only, no titles
        confirmDelete: true,
        faviconSource: 'google',   // google | duckduckgo | none
        animations: true,
        borders: true,              // show 1px outlines around cards, buttons, and inputs
        popupBlur: true,            // blur the page behind modals, the palette, and settings
        openBookmarksInNewTab: false, // false = open bookmarks in the current tab, true = open in a new tab
        lightThemeId: 'serika',    // used when themeId is 'auto' and the OS is in light mode
        darkThemeId: 'serika_dark', // used when themeId is 'auto' and the OS is in dark mode
        clockFormat: '24',         // '12' | '24' — default for new Clock widgets
        weatherUnits: 'c',         // 'c' | 'f' — default for new Weather widgets
        pomodoroFocus: 25,         // default focus minutes for new Pomodoro widgets
        pomodoroBreak: 5,          // default break minutes for new Pomodoro widgets
        countdownDays: 7,          // default target (days out) for new Countdown widgets
        rssRefreshInterval: 0,     // minutes between automatic RSS refreshes; 0 = manual only
        recentlyClosedLimit: 20,   // how many recently-closed tabs the sidebar shows
        historyShowTimes: true,    // show a relative visit time on History widget entries
        historyCount: 10,          // how many entries each History widget lists
        topSitesCount: 12,         // how many top sites each Most visited collection syncs
        trashRetentionDays: 0,     // days to keep trash items before auto-purge; 0 = keep forever
        confirmRestoreSession: false, // ask before restoring a saved session
        trashBadgeSeen: 0,         // trash badge mark-as-read count; persisted so it stays dismissed
        showTopbarSearch: true,    // show the "Jump to…" search bar in the header
        showShortcutsButton: true, // show the keyboard-shortcuts button in the header
        showTrashButton: true,     // show the trash button in the header
        interfaceFontSize: 100,       // interface font size as a % (80–150)
        interfaceFont: '',         // custom interface font family; '' = system default
        dashboard: {
          columns: 4               // board width in columns (3–6); each widget spans 1–N of these
        },
        tabsList: {
          groupPinned: true,       // show pinned open tabs in their own group above the rest
          showTabAudio: true,      // show mute controls for audible or muted tabs
          dimInactive: true,       // fade + desaturate tabs that aren't the focused one
          inactiveOpacity: 55,     // percent
          inactiveGrayscale: true
        }
      }
    },
    workspaces: {
      [wsId]: { id: wsId, name: 'Personal', order: 0, activeBoardId: boardId, createdAt: now() }
    },
    boards: {
      [boardId]: { id: boardId, workspaceId: wsId, name: 'Board 1', order: 0, createdAt: now() }
    },
    collections: {
      [colId]: { id: colId, workspaceId: wsId, name: 'Reading List', color: '#6366f1', order: 0, pinned: false, description: '', sortMode: 'manual', viewMode: null, createdAt: now() }
    },
    widgets: {
      [widgetId]: { id: widgetId, workspaceId: wsId, boardId, type: 'collection', collectionId: colId, span: 1, rowSpan: 1, col: 1, row: 1, tintColor: null, order: 0, createdAt: now() }
    },
    bookmarks: {},
    sessions: {},
    trash: {}
  };
}

/* ---------- Migration ---------- */

function migrate(data) {
  if (!data.version || data.version < 2) {
    const s = data.meta.settings || {};
    const newSettings = {
      themeId: s.darkMode === 'on' ? 'dark' : 'serika',
      density: s.density || 'comfortable',
      viewMode: s.viewMode || 'grid',
      sidebarCollapsed: false,
      confirmDelete: true,
      faviconSource: 'google'
    };
    data.meta.settings = newSettings;
    for (const col of Object.values(data.collections || {})) {
      if (col.pinned === undefined) col.pinned = false;
      if (col.description === undefined) col.description = '';
      if (col.sortMode === undefined) col.sortMode = 'manual';
    }
    for (const bm of Object.values(data.bookmarks || {})) {
      if (bm.pinned === undefined) bm.pinned = false;
    }
    data.version = 2;
  }
  if (data.version < 3) {
    // v3: introduces the widget board. Every existing collection becomes a
    // 'collection' widget (span 1), ordered the way collections used to be
    // (pinned first, then manual order) so the board looks the same as the
    // old collections grid on first load. Also backfills the new settings
    // this version introduces.
    data.widgets = data.widgets || {};
    const s = data.meta.settings;
    if (s.animations === undefined) s.animations = true;
    if (!s.dashboard) s.dashboard = { columns: 4 };
    if (!s.tabsList) s.tabsList = { groupPinned: true, dimInactive: true, inactiveOpacity: 55, inactiveGrayscale: true };

    const existingCollectionIds = new Set(Object.values(data.widgets).filter(w => w.type === 'collection').map(w => w.collectionId));
    const cols = Object.values(data.collections || {})
      .filter(c => !existingCollectionIds.has(c.id))
      .sort((a, b) => (b.pinned - a.pinned) || (a.order - b.order));
    let order = Object.keys(data.widgets).length;
    for (const col of cols) {
      const wid = uid();
      data.widgets[wid] = { id: wid, workspaceId: col.workspaceId, type: 'collection', collectionId: col.id, span: 1, order: order++, createdAt: now() };
    }
    data.version = 3;
  }
  if (data.version < 4) {
    // v4: introduces multiple named boards per workspace. Every workspace
    // gets a single default board holding all of its existing widgets, so
    // the layout looks identical right after the update — "Board 1" is
    // just the old single board, now with a name and room for siblings.
    data.boards = data.boards || {};
    for (const ws of Object.values(data.workspaces || {})) {
      if (ws.activeBoardId && data.boards[ws.activeBoardId]) continue;
      const bid = uid();
      data.boards[bid] = { id: bid, workspaceId: ws.id, name: 'Board 1', order: 0, createdAt: now() };
      ws.activeBoardId = bid;
      for (const w of Object.values(data.widgets || {})) {
        if (w.workspaceId === ws.id && !w.boardId) w.boardId = bid;
      }
    }
    data.version = 4;
  }
  if (data.version < 5) {
    // v5: Speed Dial was removed as a widget type shortly after being
    // added — this deletes any that got created in that window so no one
    // is left with a dead, unrenderable widget slot on their board.
    for (const wid of Object.keys(data.widgets || {})) {
      if (data.widgets[wid].type === 'speeddial') delete data.widgets[wid];
    }
    data.version = 5;
  }
  if (data.version < 6) {
    // v6: replaces the single global "tint with accent color" switch with
    // a per-widget background color (any widget type, defaulting to no
    // tint at all).
    delete data.meta.settings.bgTint;
    for (const wid of Object.keys(data.widgets || {})) {
      if (data.widgets[wid].tintColor === undefined) data.widgets[wid].tintColor = null;
    }
    data.version = 6;
  }
  if (data.version < 7) {
    // v7: per-board accent color was added and then removed shortly after
    // — this strips the leftover field from anyone who passed through that
    // window, so it doesn't linger as dead data.
    for (const bid of Object.keys(data.boards || {})) {
      delete data.boards[bid].accent;
    }
    data.version = 7;
  }
  if (data.version < 8) {
    // v8: workspace colors are gone — the switcher never actually showed
    // them anywhere after the color-dot was removed, so the field was
    // dead weight. Also adds per-bookmark background tint, same idea as
    // the per-widget one, defaulting to none.
    for (const wid of Object.keys(data.workspaces || {})) {
      delete data.workspaces[wid].color;
    }
    for (const bid of Object.keys(data.bookmarks || {})) {
      if (data.bookmarks[bid].tintColor === undefined) data.bookmarks[bid].tintColor = null;
    }
    data.version = 8;
  }
  if (data.version < 9) {
    // v9: widgets move to explicit grid placement, so empty cells can be
    // left open. Backfill every board's widgets with row/col coordinates by
    // packing them top-left in `order` — the same look as the old flow.
    repackBoardWidgets(data);
    data.version = 9;
  }
  if (data.version < 10) {
    // v10: "open bookmarks in the current tab" becomes the default. Existing
    // users keep whatever opening-in-tabs behavior was baked into their
    // builds (they had no choice — it always opened a new tab), so give them
    // a new tab unless they've opted into it moving forward.
    if (data.meta.settings.openBookmarksInNewTab === undefined) data.meta.settings.openBookmarksInNewTab = false;
    data.version = 10;
  }
  if (data.version < 11) {
    // v11: new widget defaults, topbar/retention/font options. Backfill
    // missing keys so every existing user gets sensible values.
    const s = data.meta.settings;
    const d11 = {
      clockFormat: '24', weatherUnits: 'c', pomodoroFocus: 25, pomodoroBreak: 5,
      countdownDays: 7, rssRefreshInterval: 0, recentlyClosedLimit: 20,
      trashRetentionDays: 0, confirmRestoreSession: false,
      showTopbarSearch: true, showTopbarButtons: true, interfaceFontLarge: false,
    };
    for (const [k, v] of Object.entries(d11)) { if (s[k] === undefined) s[k] = v; }
    data.version = 11;
  }
  if (data.version < 12) {
    // v12: auto theme becomes two user-chosen themes (light + dark) instead
    // of a hardcoded pair. Existing users keep the classic defaults.
    const s = data.meta.settings;
    if (s.lightThemeId === undefined) s.lightThemeId = 'serika';
    if (s.darkThemeId === undefined) s.darkThemeId = 'serika_dark';
    data.version = 12;
  }
  if (data.version < 13) {
    // v13: history widget options — visit times and how many entries each
    // History widget lists.
    const s = data.meta.settings;
    if (s.historyShowTimes === undefined) s.historyShowTimes = true;
    if (s.historyCount === undefined) s.historyCount = 10;
    data.version = 13;
  }
  if (data.version < 14) {
    // v14: History / Most visited collections become live-synced mirrors of
    // browser data. Collections created by the browser-data add flow are named
    // exactly "History" / "Most visited", so tag those as synced so the
    // background sync keeps them fresh.
    for (const c of Object.values(data.collections || {})) {
      if (!c || c.syncSource) continue;
      if (c.name === 'History') c.syncSource = 'history';
      else if (c.name === 'Most visited') c.syncSource = 'topSites';
    }
    data.version = 14;
  }
  if (data.version < 15) {
    // v15: "Most visited" collections size follows a dedicated setting.
    const s = data.meta.settings;
    if (s.topSitesCount === undefined) s.topSitesCount = 12;
    data.version = 15;
  }
  if (data.version < 16) {
    // v16: persist the trash badge's mark-as-read count so the badge stays
    // dismissed across reloads instead of reappearing every time.
    const s = data.meta.settings;
    if (s.trashBadgeSeen === undefined) s.trashBadgeSeen = 0;
    data.version = 16;
  }
    if (data.version < 17) {
    // v17: blur on popups can be turned off — defaults on so nothing changes
    // for existing installs.
    const s = data.meta.settings;
    if (s.popupBlur === undefined) s.popupBlur = true;
    data.version = 17;
  }
  if (data.version < 18) {
    // v18: per-user interface font; '' keeps the system default stack.
    const s = data.meta.settings;
    if (s.interfaceFont === undefined) s.interfaceFont = '';
    data.version = 18;
  }
  if (data.version < 19) {
    // v19: font size moves from a boolean "large" flag to a percentage scale.
    const s = data.meta.settings;
    if (s.interfaceFontSize === undefined) s.interfaceFontSize = s.interfaceFontLarge === true ? 109 : 100;
    data.version = 19;
  }
  if (data.version < 20) {
    const s = data.meta.settings;
    const showTopbarButtons = s.showTopbarButtons !== false;
    if (s.showShortcutsButton === undefined) s.showShortcutsButton = showTopbarButtons;
    if (s.showTrashButton === undefined) s.showTrashButton = showTopbarButtons;
    delete s.showTopbarButtons;
    s.tabsList = s.tabsList || {};
    if (s.tabsList.showTabAudio === undefined) s.tabsList.showTabAudio = true;
    data.version = 20;
  }
  return data;
}

function storageGet() {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      resolve(res && res[STORAGE_KEY] ? res[STORAGE_KEY] : null);
    });
  });
}

function storageSet(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: data }, () => resolve(data));
  });
}

async function init() {
  let data = await storageGet();
  if (!data) {
    data = defaultState();
    await storageSet(data);
  } else if (!data.version || data.version < SCHEMA_VERSION) {
    data = migrate(data);
    await storageSet(data);
  }
  return data;
}

async function getState() {
  const data = await storageGet();
  if (!data) return init();
  if (!data.version || data.version < SCHEMA_VERSION) return init();
  return data;
}

/* Factory reset: wipes every workspace, board, collection, bookmark, widget,
   session, and setting back to a pristine install. Returns the fresh state. */
async function clearAll() {
  const fresh = defaultState();
  await storageSet(fresh);
  return fresh;
}

async function setState(mutatorFn) {
  const data = await getState();
  const result = mutatorFn(data);
  await storageSet(data);
  return result !== undefined ? result : data;
}

/* ---------- Workspaces ---------- */

async function createWorkspace(name) {
  return setState((d) => {
    const id = uid();
    const order = Object.keys(d.workspaces).length;
    const boardId = uid();
    d.boards[boardId] = { id: boardId, workspaceId: id, name: 'Board 1', order: 0, createdAt: now() };
    d.workspaces[id] = { id, name: name || 'New Workspace', order, activeBoardId: boardId, createdAt: now() };
    return d.workspaces[id];
  });
}

/* Move a collection (with its bookmarks and widget) into a brand-new
   workspace, then make that workspace active so the user lands on it.
   The collection widget moves onto the new workspace's board. */
async function moveCollectionToNewWorkspace(colId, name) {
  const created = await createWorkspace(name);
  await moveCollectionToWorkspace(colId, created.id);
}

/* Move a collection (with its bookmarks and widget) onto an existing
   workspace's active board, then make that workspace active so the user
   lands on it. */
async function moveCollectionToWorkspace(colId, wsId) {
  return setState((d) => {
    const col = d.collections[colId];
    const ws = d.workspaces[wsId];
    if (!col || !ws) return;
    col.workspaceId = ws.id;
    for (const bm of Object.values(d.bookmarks || {})) {
      if (bm.collectionId === colId) bm.workspaceId = ws.id;
    }
    const widget = Object.values(d.widgets || {}).find(w => w.type === 'collection' && w.collectionId === colId);
    if (widget) {
      widget.workspaceId = ws.id;
      widget.boardId = ws.activeBoardId;
      delete widget.row; delete widget.col;
      assignWidgetPosition(d, widget.id);
    }
    d.meta.activeWorkspaceId = ws.id;
  });
}

async function updateWorkspace(id, patch) {
  return setState((d) => {
    if (d.workspaces[id]) Object.assign(d.workspaces[id], patch);
    return d.workspaces[id];
  });
}

async function deleteWorkspace(id) {
  return setState((d) => {
    delete d.workspaces[id];
    for (const cid of Object.keys(d.collections)) {
      if (d.collections[cid].workspaceId === id) delete d.collections[cid];
    }
    for (const bid of Object.keys(d.bookmarks)) {
      if (d.bookmarks[bid].workspaceId === id) delete d.bookmarks[bid];
    }
    for (const sid of Object.keys(d.sessions)) {
      if (d.sessions[sid].workspaceId === id) delete d.sessions[sid];
    }
    for (const wid of Object.keys(d.widgets)) {
      if (d.widgets[wid].workspaceId === id) delete d.widgets[wid];
    }
    for (const bid of Object.keys(d.boards || {})) {
      if (d.boards[bid].workspaceId === id) delete d.boards[bid];
    }
    if (d.meta.activeWorkspaceId === id) {
      const remaining = Object.values(d.workspaces).sort((a, b) => a.order - b.order);
      d.meta.activeWorkspaceId = remaining.length ? remaining[0].id : null;
    }
  });
}

async function setActiveWorkspace(id) {
  return setState((d) => { d.meta.activeWorkspaceId = id; });
}

/* ---------- Collections ---------- */

async function createCollection(workspaceId, name, color) {
  return setState((d) => {
    const id = uid();
    const siblings = Object.values(d.collections).filter(c => c.workspaceId === workspaceId);
    const order = siblings.length;
    d.collections[id] = {
      id, workspaceId,
      name: name || 'New Collection',
      color: color || DEFAULT_COLLECTION_COLORS[order % DEFAULT_COLLECTION_COLORS.length],
      order, pinned: false, description: '', sortMode: 'manual', viewMode: null, createdAt: now()
    };
    const wid = uid();
    const boardId = activeBoardIdFor(d, workspaceId);
    const widgetOrder = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    d.widgets[wid] = { id: wid, workspaceId, boardId, type: 'collection', collectionId: id, span: 1, rowSpan: 1, tintColor: null, order: widgetOrder, createdAt: now() };
    assignWidgetPosition(d, wid);
    return d.collections[id];
  });
}

async function updateCollection(id, patch) {
  return setState((d) => {
    if (d.collections[id]) Object.assign(d.collections[id], patch);
    return d.collections[id];
  });
}

async function toggleCollectionPin(id) {
  return setState((d) => {
    if (d.collections[id]) d.collections[id].pinned = !d.collections[id].pinned;
  });
}

async function duplicateCollection(id) {
  return setState((d) => {
    const src = d.collections[id];
    if (!src) return;
    const newId = uid();
    const siblings = Object.values(d.collections).filter(c => c.workspaceId === src.workspaceId);
    d.collections[newId] = { ...src, id: newId, name: src.name + ' (copy)', order: siblings.length, pinned: false, createdAt: now() };
    const srcBookmarks = Object.values(d.bookmarks).filter(b => b.collectionId === id);
    srcBookmarks.forEach((b, i) => {
      const bid = uid();
      d.bookmarks[bid] = { ...b, id: bid, collectionId: newId, order: i, createdAt: now() };
    });
    const srcWidget = Object.values(d.widgets).find(w => w.type === 'collection' && w.collectionId === id);
    const wid = uid();
    const boardId = (srcWidget && srcWidget.boardId) || activeBoardIdFor(d, src.workspaceId);
    const widgetOrder = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    d.widgets[wid] = { id: wid, workspaceId: src.workspaceId, boardId, type: 'collection', collectionId: newId, span: srcWidget ? srcWidget.span : 1, rowSpan: srcWidget ? (srcWidget.rowSpan || 1) : 1, tintColor: srcWidget ? (srcWidget.tintColor || null) : null, order: widgetOrder, createdAt: now() };
    assignWidgetPosition(d, wid);
    return d.collections[newId];
  });
}

async function reorderCollections(orderedIds) {
  return setState((d) => {
    orderedIds.forEach((id, i) => { if (d.collections[id]) d.collections[id].order = i; });
  });
}

async function setCollectionSortMode(id, mode) {
  return setState((d) => {
    const col = d.collections[id];
    if (!col) return;
    col.sortMode = mode;
    const bms = Object.values(d.bookmarks).filter(b => b.collectionId === id);
    if (mode === 'alpha') bms.sort((a, b) => a.title.localeCompare(b.title));
    else if (mode === 'newest') bms.sort((a, b) => b.createdAt - a.createdAt);
    else if (mode === 'oldest') bms.sort((a, b) => a.createdAt - b.createdAt);
    if (mode !== 'manual') bms.forEach((b, i) => { b.order = i; });
  });
}

async function setCollectionViewMode(id, mode) {
  return setState((d) => {
    if (d.collections[id]) d.collections[id].viewMode = mode; // null | 'grid' | 'list'
  });
}

async function softDeleteCollection(id) {
  return setState((d) => {
    const col = d.collections[id];
    if (!col) return;
    const bookmarksInCol = Object.values(d.bookmarks).filter(b => b.collectionId === id);
    const tid = uid();
    d.trash[tid] = {
      id: tid, type: 'collection',
      data: { collection: col, bookmarks: bookmarksInCol },
      deletedAt: now()
    };
    delete d.collections[id];
    for (const b of bookmarksInCol) delete d.bookmarks[b.id];
    const widget = Object.values(d.widgets).find(w => w.type === 'collection' && w.collectionId === id);
    if (widget) delete d.widgets[widget.id];
  });
}

/* ---------- Bookmarks ---------- */

async function createBookmark(collectionId, workspaceId, { title, url, favicon, tags, notes }) {
  return setState((d) => {
    const id = uid();
    const siblings = Object.values(d.bookmarks).filter(b => b.collectionId === collectionId);
    d.bookmarks[id] = {
      id, collectionId, workspaceId,
      title: title || url, url,
      favicon: favicon || '',
      tags: tags || [],
      notes: notes || '',
      pinned: false,
      tintColor: null,
      order: siblings.length,
      createdAt: now()
    };
    return d.bookmarks[id];
  });
}

async function updateBookmark(id, patch) {
  return setState((d) => {
    if (d.bookmarks[id]) Object.assign(d.bookmarks[id], patch);
    return d.bookmarks[id];
  });
}

async function toggleBookmarkPin(id) {
  return setState((d) => {
    if (d.bookmarks[id]) d.bookmarks[id].pinned = !d.bookmarks[id].pinned;
  });
}

async function duplicateBookmark(id) {
  return setState((d) => {
    const src = d.bookmarks[id];
    if (!src) return;
    const nid = uid();
    const siblings = Object.values(d.bookmarks).filter(b => b.collectionId === src.collectionId);
    d.bookmarks[nid] = { ...src, id: nid, order: siblings.length, pinned: false, createdAt: now() };
    return d.bookmarks[nid];
  });
}

async function moveBookmarks(ids, targetCollectionId, targetIndex) {
  return setState((d) => {
    if (targetIndex === undefined || targetIndex === null) {
      const maxOrder = Math.max(-1, ...Object.values(d.bookmarks).filter(b => b.collectionId === targetCollectionId && !ids.includes(b.id)).map(b => b.order));
      ids.forEach((id, i) => {
        if (d.bookmarks[id]) {
          d.bookmarks[id].collectionId = targetCollectionId;
          d.bookmarks[id].order = maxOrder + 1 + i;
        }
      });
      return;
    }
    const siblings = Object.values(d.bookmarks).filter(b => b.collectionId === targetCollectionId && !ids.includes(b.id)).sort((a, b) => a.order - b.order);
    const toInsert = ids.map(id => d.bookmarks[id]).filter(Boolean);
    const insertAt = Math.min(targetIndex, siblings.length);
    const result = siblings.slice(0, insertAt).concat(toInsert).concat(siblings.slice(insertAt));
    result.forEach((bm, i) => { bm.collectionId = targetCollectionId; bm.order = i; });
  });
}

async function reorderBookmarks(collectionId, orderedIds) {
  return setState((d) => {
    orderedIds.forEach((id, i) => { if (d.bookmarks[id]) d.bookmarks[id].order = i; });
  });
}

async function softDeleteBookmarks(ids) {
  return setState((d) => {
    for (const id of ids) {
      const bm = d.bookmarks[id];
      if (!bm) continue;
      const tid = uid();
      d.trash[tid] = { id: tid, type: 'bookmark', data: bm, deletedAt: now() };
      delete d.bookmarks[id];
    }
  });
}

/* ---------- Widgets (dashboard board) ---------- */

function widgetDefaults(type, settings) {
  const s = settings || {};
  const base = { tintColor: null }; // per-widget background tint override; null = default surface color
  if (type === 'notes') return { ...base, text: '' };
  if (type === 'todo') return { ...base, items: [] };
  if (type === 'clock') return { ...base, format: s.clockFormat || '24', timezone: '' };
  if (type === 'search') return { ...base, engine: s.searchEngine || 'google' };
  if (type === 'countdown') {
    // Default target = a few days out, so a fresh Countdown widget means
    // something immediately instead of "no date set".
    const days = (s.countdownDays && s.countdownDays > 0 ? s.countdownDays : 7);
    const d = new Date(Date.now() + days * 86400000);
    return { ...base, label: 'Countdown', targetDate: d.toISOString().slice(0, 10) };
  }
  if (type === 'pomodoro') return { ...base, focusMinutes: s.pomodoroFocus || 25, breakMinutes: s.pomodoroBreak || 5, mode: 'focus', running: false, endsAt: null };
  if (type === 'timer') return { ...base, durationSec: 300, remainingMs: 300000, running: false, startedAt: null, showMs: false };
  if (type === 'stopwatch') return { ...base, running: false, startedAt: null, accumMs: 0, showMs: false };
  if (type === 'weather') return { ...base, query: '', label: '', lat: null, lon: null, units: s.weatherUnits || 'c' };
  if (type === 'rss') return { ...base, feedUrl: '', label: '', items: [], lastFetched: null };
  if (type === 'topSites') return { ...base, count: 8 };
  if (type === 'downloads') return { ...base, count: 8 };
  if (type === 'history') return { ...base, count: 10, days: 1 };
  return base;
}

async function createWidget(workspaceId, type, extra) {
  return setState((d) => {
    const id = uid();
    const boardId = activeBoardIdFor(d, workspaceId);
    const order = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    d.widgets[id] = { id, workspaceId, boardId, type, span: 1, rowSpan: 1, order, createdAt: now(), ...widgetDefaults(type, d.meta.settings), ...(extra || {}) };
    assignWidgetPosition(d, id);
    return d.widgets[id];
  });
}

async function updateWidget(id, patch) {
  return setState((d) => {
    if (d.widgets[id]) Object.assign(d.widgets[id], patch);
    return d.widgets[id];
  });
}

async function deleteWidget(id) {
  return setState((d) => { delete d.widgets[id]; });
}

async function reorderWidgets(orderedIds) {
  return setState((d) => {
    orderedIds.forEach((id, i) => { if (d.widgets[id]) d.widgets[id].order = i; });
  });
}

/* ---------- Boards (named layouts within a workspace) ---------- */

async function createBoard(workspaceId, name) {
  return setState((d) => {
    const id = uid();
    const siblings = Object.values(d.boards).filter(b => b.workspaceId === workspaceId);
    d.boards[id] = { id, workspaceId, name: name || `Board ${siblings.length + 1}`, order: siblings.length, createdAt: now() };
    if (d.workspaces[workspaceId]) d.workspaces[workspaceId].activeBoardId = id;
    return d.boards[id];
  });
}

async function renameBoard(id, name) {
  return setState((d) => { if (d.boards[id]) d.boards[id].name = name || d.boards[id].name; });
}

async function deleteBoard(id) {
  return setState((d) => {
    const board = d.boards[id];
    if (!board) return { ok: false, reason: 'not-found' };
    const siblings = Object.values(d.boards).filter(b => b.workspaceId === board.workspaceId && b.id !== id);
    if (!siblings.length) return { ok: false, reason: 'last-board' };
    // Never destroy widgets (and the collections/bookmarks behind them) —
    // fold them into the next board instead of deleting them along with
    // the board they happened to be sitting on.
    const target = siblings.sort((a, b) => a.order - b.order)[0];
    const widgetsHere = Object.values(d.widgets).filter(w => w.boardId === id);
    let targetOrder = Object.values(d.widgets).filter(w => w.boardId === target.id).length;
    widgetsHere.forEach(w => { w.boardId = target.id; w.order = targetOrder++; });
    delete d.boards[id];
    if (d.workspaces[board.workspaceId] && d.workspaces[board.workspaceId].activeBoardId === id) {
      d.workspaces[board.workspaceId].activeBoardId = target.id;
    }
    return { ok: true, movedTo: target.name, movedCount: widgetsHere.length };
  });
}

async function setActiveBoard(workspaceId, boardId) {
  return setState((d) => { if (d.workspaces[workspaceId]) d.workspaces[workspaceId].activeBoardId = boardId; });
}


async function restoreTrashItem(trashId) {
  return setState((d) => {
    const item = d.trash[trashId];
    if (!item) return;
    if (item.type === 'bookmark') {
      d.bookmarks[item.data.id] = item.data;
    } else if (item.type === 'collection') {
      d.collections[item.data.collection.id] = item.data.collection;
      for (const b of item.data.bookmarks) d.bookmarks[b.id] = b;
      const wid = uid();
      const boardId = activeBoardIdFor(d, item.data.collection.workspaceId);
      const widgetOrder = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
      d.widgets[wid] = { id: wid, workspaceId: item.data.collection.workspaceId, boardId, type: 'collection', collectionId: item.data.collection.id, span: 1, rowSpan: 1, tintColor: null, order: widgetOrder, createdAt: now() };
      assignWidgetPosition(d, wid);
    }
    delete d.trash[trashId];
  });
}

async function purgeTrashItem(trashId) {
  return setState((d) => { delete d.trash[trashId]; });
}

async function emptyTrash() {
  return setState((d) => { d.trash = {}; });
}

// Delete trash items older than retentionDays (0 = never). Returns how many
// were purged. Called by the background so it runs even when the dashboard
// isn't open.
async function purgeExpiredTrash(retentionDays) {
  if (!retentionDays || retentionDays < 1) return 0;
  const cutoff = now() - retentionDays * 86400000;
  return setState((d) => {
    let purged = 0;
    for (const [tid, item] of Object.entries(d.trash)) {
      if (item.deletedAt && item.deletedAt < cutoff) { delete d.trash[tid]; purged++; }
    }
    return purged;
  });
}

/* ---------- Sessions ---------- */

async function createSession(workspaceId, name, tabs, multiWindow, windowCount) {
  return setState((d) => {
    const id = uid();
    d.sessions[id] = {
      id, workspaceId,
      name: name || `Session ${new Date().toLocaleString()}`,
      tabs: tabs.map(t => ({ title: t.title, url: t.url, favicon: t.favIconUrl || t.favicon || '' })),
      multiWindow: !!multiWindow,
      windowCount: windowCount || 1,
      createdAt: now()
    };
    return d.sessions[id];
  });
}

async function deleteSession(id) {
  return setState((d) => { delete d.sessions[id]; });
}

async function renameSession(id, name) {
  return setState((d) => { if (d.sessions[id]) d.sessions[id].name = name; });
}

async function updateSessionTabs(id, tabs) {
  return setState((d) => {
    if (d.sessions[id]) d.sessions[id].tabs = tabs.map(t => ({ title: t.title, url: t.url, favicon: t.favIconUrl || '' }));
  });
}

async function duplicateSession(id) {
  return setState((d) => {
    const src = d.sessions[id];
    if (!src) return;
    const nid = uid();
    d.sessions[nid] = { ...src, id: nid, name: src.name + ' (copy)', createdAt: now() };
    return d.sessions[nid];
  });
}

async function convertSessionToCollection(id, name) {
  return setState((d) => {
    const src = d.sessions[id];
    if (!src) return;
    const colId = uid();
    const siblings = Object.values(d.collections).filter(c => c.workspaceId === src.workspaceId);
    d.collections[colId] = {
      id: colId, workspaceId: src.workspaceId, name: name || src.name,
      color: DEFAULT_COLLECTION_COLORS[siblings.length % DEFAULT_COLLECTION_COLORS.length],
      order: siblings.length, pinned: false, description: 'Converted from session', sortMode: 'manual', createdAt: now()
    };
    src.tabs.forEach((t, i) => {
      const bid = uid();
      d.bookmarks[bid] = { id: bid, collectionId: colId, workspaceId: src.workspaceId, title: t.title || t.url, url: t.url, favicon: t.favicon || '', tags: [], notes: '', pinned: false, order: i, createdAt: now() };
    });
    const wid = uid();
    const boardId = activeBoardIdFor(d, src.workspaceId);
    const widgetOrder = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    d.widgets[wid] = { id: wid, workspaceId: src.workspaceId, boardId, type: 'collection', collectionId: colId, span: 1, rowSpan: 1, tintColor: null, order: widgetOrder, createdAt: now() };
    assignWidgetPosition(d, wid);
    return d.collections[colId];
  });
}

/* ---------- Settings ---------- */

async function updateSettings(patch) {
  return setState((d) => {
    for (const [key, value] of Object.entries(patch)) {
      const cur = d.meta.settings[key];
      // Shallow-merge nested setting groups (dashboard, tabsList, …) so a patch
      // like { tabsList: { groupPinned: true } } keeps its sibling keys.
      if (value && typeof value === 'object' && !Array.isArray(value) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
        Object.assign(cur, value);
      } else {
        d.meta.settings[key] = value;
      }
    }
  });
}

/* ---------- Import / Export ---------- */

async function exportJSON() {
  const d = await getState();
  return JSON.stringify(d, null, 2);
}

async function importJSON(jsonString, mode = 'merge') {
  const incoming = JSON.parse(jsonString);
  return setState((d) => {
    if (mode === 'replace') {
      Object.assign(d, incoming);
      return;
    }
    // merge mode: add incoming workspaces/boards/collections/bookmarks/sessions
    // with fresh ids to avoid collisions, but keep structure intact.
    const idMap = {};
    // Workspaces (board ids are remapped below, so keep activeBoardId valid).
    for (const ws of Object.values(incoming.workspaces || {})) {
      const nid = uid();
      idMap[ws.id] = nid;
      const activeBoardId = idMap[ws.activeBoardId] || ws.activeBoardId;
      d.workspaces[nid] = { ...ws, id: nid, name: ws.name, activeBoardId };
    }
    // Boards — each workspace needs its board(s) for widgets to render on.
    for (const b of Object.values(incoming.boards || {})) {
      const nid = uid();
      idMap[b.id] = nid;
      d.boards[nid] = { ...b, id: nid, workspaceId: idMap[b.workspaceId] || b.workspaceId };
    }
    for (const col of Object.values(incoming.collections || {})) {
      const nid = uid();
      idMap[col.id] = nid;
      d.collections[nid] = { ...col, id: nid, workspaceId: idMap[col.workspaceId] || col.workspaceId };
    }
    for (const bm of Object.values(incoming.bookmarks || {})) {
      const nid = uid();
      d.bookmarks[nid] = {
        ...bm, id: nid,
        collectionId: idMap[bm.collectionId] || bm.collectionId,
        workspaceId: idMap[bm.workspaceId] || bm.workspaceId
      };
    }
    for (const s of Object.values(incoming.sessions || {})) {
      const nid = uid();
      d.sessions[nid] = { ...s, id: nid, workspaceId: idMap[s.workspaceId] || s.workspaceId };
    }
    // Widgets — remap and re-place so imported layouts render exactly as saved.
    const importedWidgetIds = new Set();
    for (const w of Object.values(incoming.widgets || {})) {
      const nid = uid();
      idMap['w:' + w.id] = nid;
      importedWidgetIds.add(nid);
      const place = Object.assign({}, w, {
        id: nid,
        workspaceId: idMap[w.workspaceId] || w.workspaceId,
        boardId: idMap[w.boardId] || w.boardId,
        collectionId: w.collectionId != null ? (idMap[w.collectionId] || w.collectionId) : w.collectionId
      });
      delete place.row; delete place.col;
      d.widgets[nid] = place;
      assignWidgetPosition(d, nid);
    }
    // Any collection that has no widget (e.g. older imports without widgets)
    // gets a brand-new collection widget so it shows up on its workspace's
    // first board.
    const collectionsSeen = new Set(
      Object.values(d.widgets || {})
        .filter(x => x.type === 'collection' && x.collectionId)
        .map(x => x.collectionId)
    );
    const incomingColIds = Object.values(incoming.collections || {}).map(c => c.id).map(id => idMap[id] || id);
    for (const cid of incomingColIds) {
      if (!collectionsSeen.has(cid) && d.collections[cid]) {
        const col = d.collections[cid];
        const board = Object.values(d.boards || {})
          .filter(b => b.workspaceId === col.workspaceId)
          .sort((a, b) => a.order - b.order)[0];
        if (!board) continue;
        const nid = uid();
        d.widgets[nid] = {
          id: nid, workspaceId: col.workspaceId, boardId: board.id,
          type: 'collection', collectionId: cid,
          span: 1, rowSpan: 1, tintColor: null, order: 0, createdAt: now()
        };
        assignWidgetPosition(d, nid);
      }
    }
  });
}

/* Imports browser bookmarks in bulk: one atomic storage write (so context
   menus don't rebuild per bookmark). `items` is a flat list of
   { collection, title, url } where `collection` names group bookmarks —
   each distinct name becomes a collection (plus a collection widget, like
   createCollection does) and its bookmarks go underneath it. */
async function addBrowserCollection(wsId, name, bookmarks, syncSource) {
  /* Snapshots live browser data (top sites / history) into a real collection:
     one atomic write creates the collection, its bookmarks, and the
     collection widget that shows it. When `syncSource` is given ('topSites'
     or 'history') the background sync keeps the collection mirrored against
     the browser's current data. */
  return setState((d) => {
    const colId = uid();
    const existing = Object.values(d.collections).filter(c => c.workspaceId === wsId);
    d.collections[colId] = {
      id: colId, workspaceId: wsId,
      name: name || 'Collection',
      color: DEFAULT_COLLECTION_COLORS[existing.length % DEFAULT_COLLECTION_COLORS.length],
      order: existing.length, pinned: false, description: '', sortMode: 'manual', viewMode: null, createdAt: now(),
      ...(syncSource ? { syncSource } : {})
    };
    const boardId = activeBoardIdFor(d, wsId);
    let order = 0;
    (bookmarks || []).slice(0, 200).forEach((b) => {
      if (!b || !b.url) return;
      const id = uid();
      d.bookmarks[id] = {
        id, collectionId: colId, workspaceId: wsId,
        title: b.title || b.url, url: b.url,
        favicon: b.favicon || '', tags: [], notes: '', pinned: false, tintColor: null,
        order: order++, createdAt: now(),
        ...((b.visitTime || b.lastVisitTime) ? { visitTime: b.visitTime || b.lastVisitTime } : {})
      };
    });
    const widgetOrder = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    const wid = uid();
    d.widgets[wid] = { id: wid, workspaceId: wsId, boardId, type: 'collection', collectionId: colId, span: 1, rowSpan: 1, tintColor: null, order: widgetOrder, createdAt: now() };
    assignWidgetPosition(d, wid);
    return { collectionId: colId, widgetId: wid, name: name || 'Collection', count: order };
  });
}

/* Keeps a browser-synced collection mirrored against the current browser
   data: adds entries that appeared, updates titles/favicons/times, and
   removes entries that left the visible window. Returns what changed so the
   caller can decide whether context menus need rebuilding. */
async function syncBrowserCollection(colId, items, syncSource, max) {
  /* Mirrors the collection against the browser in one pass, but does a no-op
     (no storage write) when nothing actually changed. That matters because the
     background syncs on every tab close; a write would fire storage.onChanged
     in every open dashboard and force a full re-render even when the URL set
     is identical. The plan is computed against a read first, then applied in
     a single atomic write only if entries were added/removed/updated. */
  const state = await getState();
  const col = state.collections[colId];
  if (!col || (col.syncSource && col.syncSource !== syncSource)) return { added: 0, removed: 0, updated: 0, changed: false };
  const list = (items || []).slice(0, max);
  const byUrl = new Map();
  list.forEach(it => byUrl.set(it.url, it));
  const existing = Object.values(state.bookmarks).filter(b => b.collectionId === colId);
  const alive = new Set();
  const removedIds = [];
  const updatedBms = [];
  existing.forEach((b) => {
    const src = byUrl.get(b.url);
    if (!src) { removedIds.push(b.id); return; }
    alive.add(b.url);
    if ((src.title && b.title !== src.title) || (src.favicon && b.favicon !== src.favicon) || (src.visitTime && b.visitTime !== src.visitTime)) updatedBms.push(b);
  });
  const addedItems = [];
  list.forEach((it) => {
    if (alive.has(it.url)) return;
    addedItems.push(it);
    alive.add(it.url);
  });
  if (!addedItems.length && !removedIds.length && !updatedBms.length) return { added: 0, removed: 0, updated: 0, changed: false };

  return setState((d) => {
    let added = 0, removed = 0, updated = 0;
    removedIds.forEach((id) => { if (d.bookmarks[id]) { delete d.bookmarks[id]; removed++; } });
    updatedBms.forEach((b) => {
      const db = d.bookmarks[b.id];
      const src = byUrl.get(b.url);
      if (!db || !src) return;
      if (src.title && db.title !== src.title) { db.title = src.title; updated++; }
      if (src.favicon && db.favicon !== src.favicon) { db.favicon = src.favicon; updated++; }
      if (src.visitTime && db.visitTime !== src.visitTime) { db.visitTime = src.visitTime; updated++; }
    });
    addedItems.forEach((it) => {
      if (Object.values(d.bookmarks).some(x => x.collectionId === colId && x.url === it.url)) return;
      const id = uid();
      const siblings = Object.values(d.bookmarks).filter(x => x.collectionId === colId);
      d.bookmarks[id] = {
        id, collectionId: colId, workspaceId: col.workspaceId,
        title: it.title || it.url, url: it.url,
        favicon: it.favicon || '', tags: [], notes: '', pinned: false, tintColor: null,
        order: siblings.length, createdAt: now(),
        ...(it.visitTime ? { visitTime: it.visitTime } : {})
      };
      added++;
    });
    return { added, removed, updated, changed: true };
  });
}

async function importBrowserBookmarks(items, wsIdOverride) {
  return setState((d) => {
    const wsId = wsIdOverride || d.meta.activeWorkspaceId;
    const MAX_BOOKMARKS = 250;
    const MAX_COLLECTIONS = 6;
    const created = { collections: 0, bookmarks: 0, skippedBookmarks: 0 };
    const colIds = {};
    (items || []).forEach(it => {
      if (!it || !it.url) return;
      if (created.bookmarks >= MAX_BOOKMARKS) { created.skippedBookmarks++; return; }
      let colId = colIds[it.collection];
      if (!colId) {
        if (created.collections >= MAX_COLLECTIONS) return;
        colId = uid();
        const existing = Object.values(d.collections).filter(c => c.workspaceId === wsId);
        d.collections[colId] = {
          id: colId, workspaceId: wsId,
          name: it.collection || 'Imported bookmarks',
          color: DEFAULT_COLLECTION_COLORS[existing.length % DEFAULT_COLLECTION_COLORS.length],
          order: existing.length, pinned: false, description: '', sortMode: 'manual', viewMode: null, createdAt: now()
        };
        const boardId = activeBoardIdFor(d, wsId);
        const widgetOrder = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
        const wid = uid();
        d.widgets[wid] = { id: wid, workspaceId: wsId, boardId, type: 'collection', collectionId: colId, span: 1, rowSpan: 1, tintColor: null, order: widgetOrder, createdAt: now() };
        assignWidgetPosition(d, wid);
        colIds[it.collection] = colId;
        colOrder[colId] = 0;
        created.collections++;
      }
      const id = uid();
      const siblings = Object.values(d.bookmarks).filter(b => b.collectionId === colId);
      d.bookmarks[id] = {
        id, collectionId: colId, workspaceId: wsId,
        title: it.title || it.url, url: it.url,
        favicon: '', tags: [], notes: '', pinned: false, tintColor: null,
        order: siblings.length, createdAt: now()
      };
      created.bookmarks++;
    });
    return created;
  });
}

function bookmarksHTMLExport(collections, bookmarksByCollection) {
  let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
  for (const col of collections) {
    html += `  <DT><H3>${escapeHtml(col.name)}</H3>\n  <DL><p>\n`;
    for (const bm of (bookmarksByCollection[col.id] || [])) {
      html += `    <DT><A HREF="${escapeHtml(bm.url)}">${escapeHtml(bm.title)}</A>\n`;
    }
    html += '  </DL><p>\n';
  }
  html += '</DL><p>\n';
  return html;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TabsDB = {
  uid, DEFAULT_COLLECTION_COLORS,
  init, getState, setState, clearAll,
  createWorkspace, updateWorkspace, deleteWorkspace, setActiveWorkspace, moveCollectionToNewWorkspace, moveCollectionToWorkspace,
  createCollection, updateCollection, reorderCollections, softDeleteCollection,
  toggleCollectionPin, duplicateCollection, setCollectionSortMode, setCollectionViewMode,
  createBookmark, updateBookmark, moveBookmarks, reorderBookmarks, softDeleteBookmarks, toggleBookmarkPin, duplicateBookmark,
  restoreTrashItem, purgeTrashItem, emptyTrash, purgeExpiredTrash,
  createSession, deleteSession, renameSession, updateSessionTabs, duplicateSession, convertSessionToCollection,
  updateSettings,
  createWidget, updateWidget, deleteWidget, reorderWidgets,
  createBoard, renameBoard, deleteBoard, setActiveBoard,
  swapWidgetPositions, moveWidgetTo,
  occupiedCellsOfBoard, firstEmptyCell, assignWidgetPosition, repackBoardWidgets,
  exportJSON, importJSON, bookmarksHTMLExport,
  importBrowserBookmarks,
  addBrowserCollection, syncBrowserCollection
};

if (typeof module !== 'undefined') module.exports = TabsDB;
