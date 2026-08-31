/* TabsBoard — shared storage & data model
 * Works identically under chrome.* (Chrome MV3) and chrome.* alias (Firefox MV2).
 * Everything lives under a single chrome.storage.local key so we can read/write
 * the whole app state atomically and keep sync logic trivial.
 */

const STORAGE_KEY = 'tdb_data';
const SCHEMA_VERSION = 8;

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
        themeId: 'auto',           // preset id, 'auto' (follows the OS), or a custom theme id
        customThemes: {},          // id -> { id, name, type, bg, text, accent }
        density: 'comfortable',    // comfortable | compact
        viewMode: 'grid',          // grid | list — bookmark tiles vs rows *inside* a collection widget
        sidebarCollapsed: false,
        sidebarCompact: false,     // icon-only sidebar: favicons only, no titles
        confirmDelete: true,
        faviconSource: 'google',   // google | duckduckgo | none
        animations: true,
        dashboard: {
          columns: 4               // board width in columns (3–6); each widget spans 1–N of these
        },
        tabsList: {
          groupPinned: true,       // show pinned open tabs in their own group above the rest
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
      [widgetId]: { id: widgetId, workspaceId: wsId, boardId, type: 'collection', collectionId: colId, span: 1, tintColor: null, order: 0, createdAt: now() }
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
      themeId: s.darkMode === 'on' ? 'dark' : 'light',
      customThemes: {},
      density: s.density || 'comfortable',
      viewMode: s.viewMode || 'grid',
      sidebarCollapsed: false,
      confirmDelete: true,
      faviconSource: 'google'
    };
    // Preserve a custom accent as a saved custom theme so nothing is lost.
    if (s.theme && s.theme !== '#6366f1') {
      const id = 'custom-' + uid();
      newSettings.customThemes[id] = {
        id, name: 'My Theme', type: s.darkMode === 'on' ? 'dark' : 'light',
        bg: s.darkMode === 'on' ? '#14151c' : '#f4f5f9',
        text: s.darkMode === 'on' ? '#eef0f6' : '#1c1e26',
        accent: s.theme
      };
      newSettings.themeId = id;
    }
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
    d.widgets[wid] = { id: wid, workspaceId, boardId, type: 'collection', collectionId: id, span: 1, tintColor: null, order: widgetOrder, createdAt: now() };
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
    d.widgets[wid] = { id: wid, workspaceId: src.workspaceId, boardId, type: 'collection', collectionId: newId, span: srcWidget ? srcWidget.span : 1, tintColor: srcWidget ? (srcWidget.tintColor || null) : null, order: widgetOrder, createdAt: now() };
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

async function moveBookmarks(ids, targetCollectionId) {
  return setState((d) => {
    ids.forEach((id, i) => {
      if (d.bookmarks[id]) {
        d.bookmarks[id].collectionId = targetCollectionId;
        d.bookmarks[id].order = i;
      }
    });
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

function widgetDefaults(type) {
  const base = { tintColor: null }; // per-widget background tint override; null = default surface color
  if (type === 'notes') return { ...base, text: '' };
  if (type === 'todo') return { ...base, items: [] };
  if (type === 'clock') return { ...base, format: '24', timezone: '' };
  if (type === 'search') return { ...base, engine: 'google' };
  if (type === 'countdown') return { ...base, label: 'Countdown', targetDate: '' };
  if (type === 'pomodoro') return { ...base, focusMinutes: 25, breakMinutes: 5, mode: 'focus', running: false, endsAt: null };
  if (type === 'timer') return { ...base, durationSec: 300, remainingMs: 300000, running: false, startedAt: null, showMs: false };
  if (type === 'stopwatch') return { ...base, running: false, startedAt: null, accumMs: 0, showMs: false };
  if (type === 'weather') return { ...base, query: '', label: '', lat: null, lon: null };
  if (type === 'rss') return { ...base, feedUrl: '', label: '', items: [], lastFetched: null };
  return base;
}

async function createWidget(workspaceId, type, extra) {
  return setState((d) => {
    const id = uid();
    const boardId = activeBoardIdFor(d, workspaceId);
    const order = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    d.widgets[id] = { id, workspaceId, boardId, type, span: 1, rowSpan: 1, order, createdAt: now(), ...widgetDefaults(type), ...(extra || {}) };
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
      d.widgets[wid] = { id: wid, workspaceId: item.data.collection.workspaceId, boardId, type: 'collection', collectionId: item.data.collection.id, span: 1, tintColor: null, order: widgetOrder, createdAt: now() };
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
    d.widgets[wid] = { id: wid, workspaceId: src.workspaceId, boardId, type: 'collection', collectionId: colId, span: 1, tintColor: null, order: widgetOrder, createdAt: now() };
    return d.collections[colId];
  });
}

/* ---------- Settings ---------- */

async function updateSettings(patch) {
  return setState((d) => { Object.assign(d.meta.settings, patch); });
}

async function saveCustomTheme(theme) {
  return setState((d) => {
    const id = theme.id || ('custom-' + uid());
    d.meta.settings.customThemes[id] = { ...theme, id };
    return d.meta.settings.customThemes[id];
  });
}

async function deleteCustomTheme(id) {
  return setState((d) => {
    delete d.meta.settings.customThemes[id];
    if (d.meta.settings.themeId === id) d.meta.settings.themeId = 'light';
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
    // merge mode: add incoming workspaces/collections/bookmarks/sessions with fresh ids
    // to avoid collisions, but keep structure intact.
    const idMap = {};
    for (const ws of Object.values(incoming.workspaces || {})) {
      const nid = uid();
      idMap[ws.id] = nid;
      d.workspaces[nid] = { ...ws, id: nid, name: ws.name + ' (imported)' };
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
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TabsDB = {
  uid, DEFAULT_COLLECTION_COLORS,
  init, getState, setState,
  createWorkspace, updateWorkspace, deleteWorkspace, setActiveWorkspace,
  createCollection, updateCollection, reorderCollections, softDeleteCollection,
  toggleCollectionPin, duplicateCollection, setCollectionSortMode, setCollectionViewMode,
  createBookmark, updateBookmark, moveBookmarks, reorderBookmarks, softDeleteBookmarks, toggleBookmarkPin, duplicateBookmark,
  restoreTrashItem, purgeTrashItem, emptyTrash,
  createSession, deleteSession, renameSession, updateSessionTabs, duplicateSession, convertSessionToCollection,
  updateSettings, saveCustomTheme, deleteCustomTheme,
  createWidget, updateWidget, deleteWidget, reorderWidgets,
  createBoard, renameBoard, deleteBoard, setActiveBoard,
  exportJSON, importJSON, bookmarksHTMLExport
};

if (typeof module !== 'undefined') module.exports = TabsDB;
