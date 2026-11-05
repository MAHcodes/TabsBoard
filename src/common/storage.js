/* TabsBoard — shared storage & data model
 * Works identically under chrome.* (Chrome MV3) and chrome.* alias (Firefox MV2).
 * The state is persisted in IndexedDB through Dexie (see "Persistence" below):
 * one row per record, only changed rows are written, and there is no 10 MB
 * chrome.storage quota to hit. The app still sees one plain state object via
 * getState() / setState(mutator).
 */

/* Key of the legacy single-blob store. Only read once, to migrate old installs into Dexie. */
const STORAGE_KEY = 'tdb_data';
/* The data shape is version 1 and always will be until there is a reason to
   change it — there is no migration ladder. Anything stored under a different
   version is thrown away and replaced with a fresh install (see init()). */
const SCHEMA_VERSION = 1;

const DEFAULT_COLLECTION_COLORS = (typeof self !== 'undefined' && self.Themes) ? self.Themes.COLLECTION_COLORS : [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#0ea5e9'
];

/* Notification preferences (Settings → Notifications). Three channels:
   - toast*:   the in-app toasts shown in the dashboard
   - browser*: system notifications raised by the background script
   - pomodoro*: system notifications when a Pomodoro widget cycle ends
   Stored as settings.notifications; always read through notificationSettings()
   so installs / backups that predate these keys still get these defaults. */
const NOTIFICATION_DEFAULTS = {
  toastLevel: 'all',            // all | important (errors, warnings, anything with an action such as Undo) | errors | off
  toastPosition: 'bottom-right', // bottom-right | bottom-left | bottom-center | top-right | top-left | top-center
  toastDuration: 0,             // ms on screen; 0 = automatic (by message length), -1 = stay until dismissed
  toastMax: 4,                  // most toasts visible at once
  toastSize: 'normal',          // small | normal | large
  toastProgress: true,          // countdown bar along the bottom of each toast
  toastIcons: true,             // status icon on each toast
  toastPauseOnHover: true,      // hovering a toast pauses its countdown
  toastGroupDuplicates: true,   // repeat of a visible message shows ×N instead of stacking
  browserEnabled: true,         // system notifications from the background script
  browserSelectionSaved: true,  //   ...when highlighted text is saved from the context menu
  browserTimeout: 0,            // seconds before auto-clear; 0 = browser default, -1 = stay until dismissed (Chrome only)
  browserSilent: false,         // no sound
  pomodoroEnabled: true,        // system notification when a Pomodoro focus/break ends
  pomodoroOnFocusEnd: true,
  pomodoroOnBreakEnd: true,
  pomodoroSound: true
};
function notificationSettings(settings) {
  return Object.assign({}, NOTIFICATION_DEFAULTS, (settings && settings.notifications) || {});
}

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

/* Board width is a per-workspace setting, so it is looked up through the board's
   workspace (falling back to the active one when the board is unknown). */
function boardColumnCount(d, boardId) {
  const board = boardId && d.boards ? d.boards[boardId] : null;
  const wsId = (board && board.workspaceId) || (d.meta && d.meta.activeWorkspaceId);
  const ws = wsId && d.workspaces ? d.workspaces[wsId] : null;
  const cols = ws && ws.settings && ws.settings.dashboard && ws.settings.dashboard.columns;
  return (typeof cols === 'number' && cols >= 1) ? cols : 4;
}

function firstEmptyCell(d, boardId, span, rowSpan) {
  span = Math.max(1, span || 1);
  rowSpan = Math.max(1, rowSpan || 1);
  const cols = boardColumnCount(d, boardId);
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
    const cols = boardColumnCount(d, w.boardId);
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


/* ---------- Settings: one set per workspace ----------

   Every workspace owns its own settings (theme, density, board width, sidebar,
   widget defaults, notifications…), stored on the workspace record itself as
   `workspaces[id].settings`. Switching workspace switches the whole look and
   behavior; a backup carries them because they live inside the workspace rows.

   Three things are deliberately NOT per workspace, because the data they
   govern is shared by all workspaces (kept in `meta.globalSettings`):
     - customThemes        the library of themes you built; which one a workspace
                           *uses* (themeId / lightThemeId / darkThemeId) is per workspace
     - trashRetentionDays  the trash is one bin for every workspace
     - trashBadgeSeen      ...and so is its "already looked at" counter

   Code never reads these raw rows. settingsOf(state[, workspaceId]) returns the
   resolved view — defaults, then the workspace's own values, then the shared
   keys — so a key added in a later version just works on old data. Writes go
   through updateSettings(patch[, workspaceId]), which routes each key to the
   right place. */

const GLOBAL_SETTING_KEYS = ['customThemes', 'trashRetentionDays', 'trashBadgeSeen'];

/* The themes a fresh workspace uses (themeId 'auto' = follow the OS between these two).
   Keep in step with Themes.DEFAULT_LIGHT_ID / DEFAULT_DARK_ID in themes.js. */
const DEFAULT_LIGHT_THEME_ID = 'iceberg_light';
const DEFAULT_DARK_THEME_ID = 'iceberg_dark';

function defaultGlobalSettings() {
  return {
    customThemes: [],          // user-built themes (Themes builder); any workspace can pick any of them
    trashRetentionDays: 0,     // days to keep trash items before auto-purge; 0 = keep forever
    trashBadgeSeen: 0          // trash badge mark-as-read count; persisted so it stays dismissed
  };
}

function defaultWorkspaceSettings() {
  return {
    themeId: 'auto',           // preset id, custom theme id, or 'auto' (follows the OS)
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
    floatingBars: false,        // lift the top bar and sidebar off the edges as separate floating panels, with a gap around them
    boardMode: 'grid',         // how the board is shown: grid (snap to columns) | canvas (free-form, snap-to-grid) | split (collections list + one collection)
    popupBlur: true,            // blur the page behind modals, the palette, and settings
    openBookmarksInNewTab: false, // false = open bookmarks in the current tab, true = open in a new tab
    lightThemeId: DEFAULT_LIGHT_THEME_ID, // used when themeId is 'auto' and the OS is in light mode
    darkThemeId: DEFAULT_DARK_THEME_ID,   // used when themeId is 'auto' and the OS is in dark mode
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
    confirmRestoreSession: false, // ask before restoring a saved session
    showPreviews: true,        // global switch for page-preview thumbnails on grid tiles (each bookmark can override it in Edit details)
    notifications: Object.assign({}, NOTIFICATION_DEFAULTS), // see NOTIFICATION_DEFAULTS
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
  };
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function cloneJSON(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/* defaults ⊕ own, merging the nested groups (dashboard, tabsList, notifications)
   one level deep so a workspace that only stored { dashboard: { columns: 5 } }
   still resolves every other dashboard key. */
function mergeSettingGroups(base, own) {
  const out = cloneJSON(base);
  for (const [k, v] of Object.entries(own || {})) {
    if (v === undefined) continue;
    out[k] = (isPlainObject(v) && isPlainObject(out[k])) ? Object.assign(out[k], cloneJSON(v)) : cloneJSON(v);
  }
  return out;
}

/* The settings of one workspace, fully resolved. Pure: never mutates `d`. */
function resolveSettings(d, workspaceId) {
  const ws = d && d.workspaces && workspaceId ? d.workspaces[workspaceId] : null;
  const out = mergeSettingGroups(defaultWorkspaceSettings(), ws && isPlainObject(ws.settings) ? ws.settings : {});
  const shared = Object.assign(defaultGlobalSettings(), d && d.meta && isPlainObject(d.meta.globalSettings) ? cloneJSON(d.meta.globalSettings) : {});
  for (const k of GLOBAL_SETTING_KEYS) out[k] = shared[k];
  out.notifications = notificationSettings(out);
  return out;
}

/* Resolved settings of `workspaceId` (default: the active workspace) from a
   state returned by getState(). Cached per state object — getState() hands out
   a fresh object after every change, so the cache can never go stale. Treat the
   result as read-only; change settings with updateSettings(). */
const _settingsCache = new WeakMap();
function settingsOf(state, workspaceId) {
  if (!state || typeof state !== 'object') return resolveSettings(null, null);
  const id = workspaceId || (state.meta && state.meta.activeWorkspaceId) || null;
  let per = _settingsCache.get(state);
  if (!per) { per = new Map(); _settingsCache.set(state, per); }
  if (!per.has(id)) per.set(id, resolveSettings(state, id));
  return per.get(id);
}

/* Just the shared (cross-workspace) settings. */
function globalSettingsOf(state) {
  const s = settingsOf(state);
  const out = {};
  for (const k of GLOBAL_SETTING_KEYS) out[k] = s[k];
  return out;
}

/* A resolved settings object minus the shared keys: exactly what a workspace stores. */
function workspaceOnlySettings(resolved) {
  const out = cloneJSON(resolved) || {};
  for (const k of GLOBAL_SETTING_KEYS) delete out[k];
  return out;
}

/* ---- Validation of settings that arrive from outside (backup files, old installs) ----
   A backup is untrusted input and some values end up in CSS or drive layout
   math, so anything that isn't a known key of the right type and range is
   dropped (it then resolves to its default). Not applied to values the UI
   itself writes. */
const SETTING_ENUMS = {
  density: ['spacious', 'comfortable', 'compact', 'dense'],
  radius: ['sharp', 'default', 'rounded', 'extra', 'none'],
  searchEngine: ['google', 'duckduckgo', 'bing'],
  viewMode: ['grid', 'list'],
  boardMode: ['grid', 'canvas', 'split'],
  faviconSource: ['google', 'duckduckgo', 'none'],
  clockFormat: ['12', '24'],
  weatherUnits: ['c', 'f']
};
const SETTING_RANGES = {
  pomodoroFocus: [1, 180], pomodoroBreak: [1, 60], countdownDays: [1, 365],
  rssRefreshInterval: [0, 1440], recentlyClosedLimit: [0, 500],
  historyCount: [1, 200], topSitesCount: [1, 200], interfaceFontSize: [80, 150]
};
const GROUP_RANGES = { dashboard: { columns: [3, 6] }, tabsList: { inactiveOpacity: [0, 100] } };
const NOTIFICATION_ENUMS = {
  toastLevel: ['all', 'important', 'errors', 'off'],
  toastPosition: ['bottom-right', 'bottom-left', 'bottom-center', 'top-right', 'top-left', 'top-center'],
  toastSize: ['small', 'normal', 'large']
};
const NOTIFICATION_RANGES = { toastDuration: [-1, 120000], toastMax: [1, 10], browserTimeout: [-1, 3600] };
const THEME_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const THEME_HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CUSTOM_THEME_COLOR_KEYS = ['bg', 'main', 'caret', 'sub', 'subAlt', 'text', 'error', 'errorExtra', 'colorfulError', 'colorfulErrorExtra'];
const MAX_CUSTOM_THEMES_STORED = 20;   // keep in step with Themes.MAX_CUSTOM_THEMES

function cleanLeaf(key, value, def, enums, ranges) {
  if (typeof def === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  if (typeof def === 'number') {
    if (typeof value !== 'number' || !isFinite(value)) return { ok: false };
    const r = ranges && ranges[key];
    if (r && (value < r[0] || value > r[1])) return { ok: false };
    return { ok: true, value: Math.round(value) };
  }
  if (typeof def === 'string') {
    if (typeof value !== 'string') return { ok: false };
    if (enums && enums[key]) return enums[key].includes(value) ? { ok: true, value } : { ok: false };
    if (key === 'themeId' || key === 'lightThemeId' || key === 'darkThemeId') return THEME_ID_RE.test(value) ? { ok: true, value } : { ok: false };
    if (key === 'interfaceFont') {
      const f = value.trim();
      return f.length <= 40 && !/["'\\<>{};\n\r]/.test(f) ? { ok: true, value: f } : { ok: false };
    }
    return value.length <= 200 ? { ok: true, value } : { ok: false };
  }
  return { ok: false };
}

/* Returns only the valid, known workspace-level keys of `raw` (never the shared ones). */
function sanitizeWorkspaceSettings(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  const defs = defaultWorkspaceSettings();
  if (raw.layout === 'explorer' && !('boardMode' in raw)) raw = { ...raw, boardMode: 'split' };   // short-lived 'layout' setting
  for (const [key, def] of Object.entries(defs)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (isPlainObject(def)) {
      if (!isPlainObject(value)) continue;
      const enums = key === 'notifications' ? NOTIFICATION_ENUMS : null;
      const ranges = key === 'notifications' ? NOTIFICATION_RANGES : (GROUP_RANGES[key] || null);
      const group = {};
      for (const [sub, subDef] of Object.entries(def)) {
        if (!(sub in value)) continue;
        const r = cleanLeaf(sub, value[sub], subDef, enums, ranges);
        if (r.ok) group[sub] = r.value;
      }
      out[key] = group;
    } else {
      const r = cleanLeaf(key, value, def, SETTING_ENUMS, SETTING_RANGES);
      if (r.ok) out[key] = r.value;
    }
  }
  return out;
}

function sanitizeCustomThemes(list) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    if (!isPlainObject(t) || typeof t.id !== 'string' || !/^custom-[A-Za-z0-9_-]{1,60}$/.test(t.id) || seen.has(t.id)) continue;
    const rec = { id: t.id, name: String(t.name == null ? '' : t.name).trim().slice(0, 40) || 'My theme', type: t.type === 'light' ? 'light' : 'dark', custom: true };
    for (const k of CUSTOM_THEME_COLOR_KEYS) if (typeof t[k] === 'string' && THEME_HEX_RE.test(t[k].trim())) rec[k] = t[k].trim();
    seen.add(t.id);
    out.push(rec);
    if (out.length >= MAX_CUSTOM_THEMES_STORED) break;
  }
  return out;
}

function sanitizeGlobalSettings(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  if ('customThemes' in raw) out.customThemes = sanitizeCustomThemes(raw.customThemes);
  if (typeof raw.trashRetentionDays === 'number' && isFinite(raw.trashRetentionDays) && raw.trashRetentionDays >= 0 && raw.trashRetentionDays <= 3650) out.trashRetentionDays = Math.round(raw.trashRetentionDays);
  if (typeof raw.trashBadgeSeen === 'number' && isFinite(raw.trashBadgeSeen) && raw.trashBadgeSeen >= 0) out.trashBadgeSeen = Math.round(raw.trashBadgeSeen);
  return out;
}

/* Brings any state — an old install that stored one flat `meta.settings` for the
   whole app, a legacy blob, an old backup — to the current layout, in place:
   the flat settings are copied to every workspace (so nothing changes visibly
   after the upgrade) and the shared keys move to `meta.globalSettings`.
   Idempotent, and a no-op on state that is already current. Returns true if it
   changed anything. */
function normalizeSettingsLayout(state) {
  if (!state || typeof state !== 'object') return false;
  if (!isPlainObject(state.meta)) state.meta = {};
  let changed = false;
  const legacy = isPlainObject(state.meta.settings) ? state.meta.settings : null;
  if (legacy) {
    const own = sanitizeWorkspaceSettings(legacy);
    for (const ws of Object.values(state.workspaces || {})) {
      if (ws && !isPlainObject(ws.settings)) ws.settings = cloneJSON(own);
    }
    state.meta.globalSettings = Object.assign(defaultGlobalSettings(), sanitizeGlobalSettings(legacy), isPlainObject(state.meta.globalSettings) ? state.meta.globalSettings : {});
    delete state.meta.settings;
    changed = true;
  }
  if (!isPlainObject(state.meta.globalSettings)) { state.meta.globalSettings = defaultGlobalSettings(); changed = true; }
  for (const ws of Object.values(state.workspaces || {})) {
    if (ws && !isPlainObject(ws.settings)) { ws.settings = defaultWorkspaceSettings(); changed = true; }
  }
  return changed;
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
      globalSettings: defaultGlobalSettings()
    },
    workspaces: {
      [wsId]: { id: wsId, name: 'Personal', order: 0, activeBoardId: boardId, createdAt: now(), settings: defaultWorkspaceSettings() }
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

/* ---------- Persistence: Dexie (IndexedDB) ----------

   The app state keeps the exact same in-memory shape as before — one object
   with `meta`, `workspaces`, `boards`, `collections`, `widgets`, `bookmarks`,
   `sessions`, `trash` — so every function in this file (and every caller in
   the dashboard / background / popup) keeps using getState() and
   setState(mutator) unchanged.

   What changed is how it is stored. Instead of one `tdb_data` blob that was
   re-serialised in full on every edit (and capped by the 10 MB
   chrome.storage quota), each record is its own IndexedDB row, one table per
   collection of records. setState() runs the mutator inside a single
   read-write transaction, diffs the result against what it read, and writes
   only the rows that actually changed. Because the read-modify-write happens
   in one IndexedDB transaction, writes from the dashboard and the background
   worker are serialised by the browser instead of racing each other.

   Tables use out-of-line keys: the key is the record's id in its dictionary,
   exactly like the old object-of-objects layout, so nothing about the data
   model has to be rewritten. */

const DB_NAME = 'tdb_store';
const RECORD_TABLES = ['workspaces', 'boards', 'collections', 'widgets', 'bookmarks', 'sessions', 'trash'];
const META_TABLE = 'meta';          // rows: '__version', '__rev', plus one row per key of state.meta
const REV_STORAGE_KEY = 'tdb_rev';  // tiny chrome.storage.local value used purely as a cross-context "something changed" signal
const VERSION_ROW = '__version';
const REV_ROW = '__rev';

let _tdbDb = null;
let _tdbReady = null;

function tdbDexie() {
  if (_tdbDb) return _tdbDb;
  const Ctor = (typeof Dexie !== 'undefined') ? Dexie : (typeof self !== 'undefined' ? self.Dexie : null);
  if (!Ctor) throw new Error('Dexie is not loaded — include common/dexie.min.js before storage.js');
  const store = { [META_TABLE]: '' };
  RECORD_TABLES.forEach(t => { store[t] = ''; });   // '' = out-of-line primary key (we supply the id)
  _tdbDb = new Ctor(DB_NAME);
  _tdbDb.version(1).stores(store);
  return _tdbDb;
}

function tdbTables() {
  const d = tdbDexie();
  return [d[META_TABLE]].concat(RECORD_TABLES.map(t => d[t]));
}

/* The legacy single-blob store, only ever read once to migrate old installs. */
function legacyGet() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(null);
    try {
      chrome.storage.local.get(STORAGE_KEY, (res) => resolve(res && res[STORAGE_KEY] ? res[STORAGE_KEY] : null));
    } catch (e) { resolve(null); }
  });
}
function legacyRemove() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve();
    try { chrome.storage.local.remove(STORAGE_KEY, () => resolve()); } catch (e) { resolve(); }
  });
}

/* Cross-context change signal. IndexedDB has no cross-context change event in
   extensions, so after each committed write we bump a tiny key in
   chrome.storage.local. onChange() listeners (dashboard, background) re-read
   the state when it fires. */
function notifyChanged(rev) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve();
    try { chrome.storage.local.set({ [REV_STORAGE_KEY]: { n: rev, t: Date.now() } }, () => { void (chrome.runtime && chrome.runtime.lastError); resolve(); }); }
    catch (e) { resolve(); }
  });
}
function onChange(cb) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[REV_STORAGE_KEY]) cb();
  });
}

async function readTable(table) {
  const [keys, vals] = await Promise.all([table.toCollection().primaryKeys(), table.toArray()]);
  const out = {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = vals[i];
  return out;
}

/* Reads every table into the in-memory state object. Must be called inside a
   Dexie transaction that includes all tables. */
async function readState() {
  const d = tdbDexie();
  const [metaRows, ...tables] = await Promise.all([readTable(d[META_TABLE])].concat(RECORD_TABLES.map(t => readTable(d[t]))));
  const state = { version: metaRows[VERSION_ROW], meta: {} };
  let rev = 0;
  for (const [k, v] of Object.entries(metaRows)) {
    if (k === VERSION_ROW) continue;
    if (k === REV_ROW) { rev = v || 0; continue; }
    state.meta[k] = v;
  }
  RECORD_TABLES.forEach((t, i) => { state[t] = tables[i]; });
  return { state, rev };
}

/* JSON fingerprints of everything currently stored, used to find which rows a
   mutator actually changed. */
function fingerprint(state) {
  const fp = { meta: new Map(), tables: {} };
  fp.meta.set(VERSION_ROW, JSON.stringify(state.version));
  for (const [k, v] of Object.entries(state.meta || {})) fp.meta.set(k, JSON.stringify(v));
  for (const t of RECORD_TABLES) {
    const m = new Map();
    for (const [k, v] of Object.entries(state[t] || {})) m.set(k, JSON.stringify(v));
    fp.tables[t] = m;
  }
  return fp;
}

/* Diff `state` against `before` and write only what changed. Returns the
   number of rows touched. Inside a Dexie transaction. */
async function writeDiff(state, before) {
  const d = tdbDexie();
  let touched = 0;
  const syncTable = async (table, current, prev) => {
    const putKeys = [], putVals = [], delKeys = [];
    for (const [k, v] of Object.entries(current || {})) {
      if (v === undefined) continue;
      if (prev.get(k) !== JSON.stringify(v)) { putKeys.push(k); putVals.push(v); }
    }
    for (const k of prev.keys()) {
      if (!current || !(k in current) || current[k] === undefined) delKeys.push(k);
    }
    if (putKeys.length) await table.bulkPut(putVals, putKeys);
    if (delKeys.length) await table.bulkDelete(delKeys);
    touched += putKeys.length + delKeys.length;
  };
  // meta table: version + one row per state.meta key
  const metaCurrent = Object.assign({}, state.meta || {}, { [VERSION_ROW]: state.version });
  const metaPrev = new Map(before.meta);
  metaPrev.delete(REV_ROW);
  await syncTable(d[META_TABLE], metaCurrent, metaPrev);
  for (const t of RECORD_TABLES) await syncTable(d[t], state[t], before.tables[t]);
  return touched;
}

/* Writes a complete state into empty tables (fresh install, or legacy migration). */
async function writeFull(state) {
  const d = tdbDexie();
  const metaKeys = [VERSION_ROW, REV_ROW], metaVals = [SCHEMA_VERSION, 0];
  for (const [k, v] of Object.entries(state.meta || {})) { metaKeys.push(k); metaVals.push(v); }
  await d[META_TABLE].bulkPut(metaVals, metaKeys);
  for (const t of RECORD_TABLES) {
    const keys = Object.keys(state[t] || {});
    if (keys.length) await d[t].bulkPut(keys.map(k => state[t][k]), keys);
  }
}

/* Opens the database and, the first time (per context), makes sure it holds a
   valid state: seeds it from the old `tdb_data` blob if one exists (one-time
   migration, verified before the old copy is deleted), otherwise from a fresh
   default state. Safe to call from several contexts at once — the seed runs
   in a transaction that re-checks whether someone else got there first. */
function ensureReady() {
  if (_tdbReady) return _tdbReady;
  _tdbReady = (async () => {
    const d = tdbDexie();
    await d.open();
    if ((await d[META_TABLE].get(VERSION_ROW)) === SCHEMA_VERSION) return;
    const legacy = await legacyGet();
    const migrating = !!(legacy && legacy.version === SCHEMA_VERSION);
    /* No migration ladder for the data *shape* (see SCHEMA_VERSION): a legacy
       blob of an unknown version, or no data at all, means a fresh install.
       Only the storage *engine* moved, and a blob of the current shape is
       carried over intact. */
    const seed = migrating ? legacy : defaultState();
    if (migrating) normalizeSettingsLayout(seed);   // old blob: one flat settings object -> per-workspace
    let seeded = false;
    await d.transaction('rw', tdbTables(), async () => {
      if ((await d[META_TABLE].get(VERSION_ROW)) === SCHEMA_VERSION) return; // another context already seeded
      await Promise.all(tdbTables().map(t => t.clear()));
      await writeFull(seed);
      seeded = true;
    });
    if (seeded && migrating) {
      // Only drop the old blob once every record demonstrably made it across.
      const ok = await d.transaction('r', tdbTables(), async () => {
        const { state } = await readState();
        return RECORD_TABLES.every(t => Object.keys(state[t] || {}).length === Object.keys(seed[t] || {}).length);
      });
      if (ok) await legacyRemove();
    }
  })().then(migrateSettingsLayout);
  _tdbReady.catch(() => { _tdbReady = null; });   // let the next call retry (e.g. a transient open error)
  return _tdbReady;
}

/* One-time, in-place upgrade of an install that predates per-workspace
   settings: the single flat `meta.settings` row is copied into every workspace
   and removed, and the shared keys move to `meta.globalSettings`. Runs in one
   transaction that re-checks first, so two contexts racing at startup can't
   both do it. The cheap probe makes every later start a single row read. */
async function migrateSettingsLayout() {
  const d = tdbDexie();
  const [oldRow, globalRow] = await Promise.all([d[META_TABLE].get('settings'), d[META_TABLE].get('globalSettings')]);
  if (oldRow === undefined && globalRow !== undefined) return;
  let rev = 0;
  await d.transaction('rw', tdbTables(), async () => {
    const read = await readState();
    const before = fingerprint(read.state);
    if (!normalizeSettingsLayout(read.state)) return;
    if (await writeDiff(read.state, before)) {
      rev = read.rev + 1;
      await d[META_TABLE].put(rev, REV_ROW);
    }
  });
  if (rev) await notifyChanged(rev);
}

async function init() {
  return getState();
}

async function getState() {
  await ensureReady();
  const d = tdbDexie();
  const { state } = await d.transaction('r', tdbTables(), () => readState());
  return state;
}

/* Factory reset: wipes every workspace, board, collection, bookmark, widget,
   session, and setting back to a pristine install. Returns the fresh state. */
async function clearAll() {
  await ensureReady();
  const d = tdbDexie();
  const fresh = defaultState();
  let rev = 0;
  await d.transaction('rw', tdbTables(), async () => {
    const cur = await d[META_TABLE].get(REV_ROW);
    await Promise.all(tdbTables().map(t => t.clear()));
    await writeFull(fresh);
    rev = (cur || 0) + 1;
    await d[META_TABLE].put(rev, REV_ROW);
  });
  await notifyChanged(rev);
  return fresh;
}

/* Runs `mutatorFn(state)` against the current state and persists what it
   changed. The read, the mutation and the write all happen in ONE IndexedDB
   transaction, so concurrent writers (dashboard + background) can't clobber
   each other. The mutator must be synchronous — it runs inside the
   transaction. Returns the mutator's return value, or the state if it
   returned nothing. */
async function setState(mutatorFn) {
  await ensureReady();
  const d = tdbDexie();
  let result, state, rev = 0, touched = 0;
  await d.transaction('rw', tdbTables(), async () => {
    const read = await readState();
    state = read.state;
    const before = fingerprint(state);
    result = mutatorFn(state);
    state.version = SCHEMA_VERSION;   // a "replace" import must not be able to change the stored schema version
    touched = await writeDiff(state, before);
    if (touched) {
      rev = read.rev + 1;
      await d[META_TABLE].put(rev, REV_ROW);
    }
  });
  if (touched) await notifyChanged(rev);
  return result !== undefined ? result : state;
}

/* Storage overview for the Settings → Data panel. */
async function storageStats() {
  await ensureReady();
  const d = tdbDexie();
  const counts = {};
  for (const t of RECORD_TABLES) counts[t] = await d[t].count();
  let usage = null, quota = null, persisted = null;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.estimate) { const e = await navigator.storage.estimate(); usage = e.usage; quota = e.quota; }
      if (navigator.storage.persisted) persisted = await navigator.storage.persisted();
    }
  } catch (e) { /* estimate is best-effort */ }
  return { counts, usage, quota, persisted };
}

/* ---------- Workspaces ---------- */

/* `opts.settingsFrom` picks where the new workspace's settings start from:
   a workspace id (copy that workspace's), 'defaults' (factory settings), or
   nothing (copy the active workspace's, so a new workspace looks like the one
   you were just in). From then on the two are independent. */
async function createWorkspace(name, opts) {
  const o = opts || {};
  return setState((d) => {
    const id = uid();
    const order = Object.keys(d.workspaces).length;
    const boardId = uid();
    let settings;
    if (o.settingsFrom === 'defaults') settings = defaultWorkspaceSettings();
    else {
      const from = (o.settingsFrom && d.workspaces[o.settingsFrom]) ? o.settingsFrom : d.meta.activeWorkspaceId;
      settings = workspaceOnlySettings(resolveSettings(d, from));
    }
    d.boards[boardId] = { id: boardId, workspaceId: id, name: 'Board 1', order: 0, createdAt: now() };
    d.workspaces[id] = { id, name: name || 'New Workspace', order, activeBoardId: boardId, createdAt: now(), settings };
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

/* Only keep favicon URLs an extension page can actually load; chrome://,
   about:, other extensions' URLs and dead blob: URLs just render broken. */
function cleanFavicon(f) {
  return (typeof f === 'string' && (/^https?:\/\//i.test(f) || /^data:image\//i.test(f))) ? f : '';
}

async function createBookmark(collectionId, workspaceId, { title, url, favicon, tags, notes }) {
  favicon = cleanFavicon(favicon);
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
  if (patch && 'favicon' in patch) patch = Object.assign({}, patch, { favicon: cleanFavicon(patch.favicon) });
  return setState((d) => {
    if (d.bookmarks[id]) Object.assign(d.bookmarks[id], patch);
    return d.bookmarks[id];
  });
}

/* Free-form canvas: store {id: {cx, cy, cw, ch, cz}} rectangles for many widgets in ONE write. */
async function setWidgetRects(rects) {
  return setState((d) => {
    for (const [id, r] of Object.entries(rects || {})) {
      const w = d.widgets[id];
      if (!w || !r) continue;
      for (const k of ['cx', 'cy', 'cw', 'ch', 'cz']) {
        if (typeof r[k] === 'number' && isFinite(r[k])) w[k] = Math.round(r[k]);
      }
    }
  });
}

/* Apply many bookmark patches ({id: patch}) in ONE write, so refetching 40
   bookmarks triggers a single re-render instead of 40. */
async function updateBookmarks(patches) {
  return setState((d) => {
    for (const [id, patch] of Object.entries(patches || {})) {
      if (!d.bookmarks[id]) continue;
      const p = Object.assign({}, patch);
      if ('favicon' in p) p.favicon = cleanFavicon(p.favicon);
      Object.assign(d.bookmarks[id], p);
    }
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
  // CPU readings are live samples, never stored: a fresh card starts blank and
  // the widget fills itself in on the next tick.
  if (type === 'cpu') return { ...base };
  // Third-party plugin widget (sandboxed iframe). `data` is the widget's own
  // private key/value storage (see PluginProtocol); it's capped at runtime.
  if (type === 'plugin') return { ...base, pluginId: '', data: {} };
  return base;
}

async function createWidget(workspaceId, type, extra) {
  return setState((d) => {
    const id = uid();
    const boardId = activeBoardIdFor(d, workspaceId);
    const order = Object.values(d.widgets).filter(w => w.boardId === boardId).length;
    d.widgets[id] = { id, workspaceId, boardId, type, span: 1, rowSpan: 1, order, createdAt: now(), ...widgetDefaults(type, resolveSettings(d, workspaceId)), ...(extra || {}) };
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
    // Canvas positions belong to the board they were laid out on; dropping them lets the
    // new board pack these widgets into free space instead of stacking them on top of its own.
    widgetsHere.forEach(w => { w.boardId = target.id; w.order = targetOrder++; delete w.cx; delete w.cy; delete w.cw; delete w.ch; delete w.cz; });
    delete d.boards[id];
    if (d.workspaces[board.workspaceId] && d.workspaces[board.workspaceId].activeBoardId === id) {
      d.workspaces[board.workspaceId].activeBoardId = target.id;
    }
    return { ok: true, movedTo: target.name, movedCount: widgetsHere.length };
  });
}

/* Per-board view. `mode` is 'grid' | 'canvas' | 'split'; null clears the override so the board
   follows the workspace's default view again. */
const BOARD_MODES = ['grid', 'canvas', 'split'];
async function setBoardMode(boardId, mode) {
  return setState((d) => {
    const b = d.boards[boardId];
    if (!b) return;
    if (BOARD_MODES.includes(mode)) b.boardMode = mode; else delete b.boardMode;
  });
}

/* Move a widget (and so the collection it shows) to another board of the same workspace. It joins
   the end of the target board; canvas positions are dropped so it gets packed into free space. */
async function moveWidgetToBoard(widgetId, boardId) {
  return setState((d) => {
    const w = d.widgets[widgetId], target = d.boards[boardId], from = w && d.boards[w.boardId];
    if (!w || !target) return { ok: false, reason: 'not-found' };
    if (w.boardId === boardId) return { ok: false, reason: 'same-board' };
    if (from && from.workspaceId !== target.workspaceId) return { ok: false, reason: 'other-workspace' };
    w.order = Object.values(d.widgets).filter(x => x.boardId === boardId).length;
    w.boardId = boardId;
    delete w.cx; delete w.cy; delete w.cw; delete w.ch; delete w.cz;
    return { ok: true, boardName: target.name };
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

/* ---------- Widget plugins ----------
   The registry lives in meta.plugins: { [pluginId]: record } where a record is
   the validated manifest plus consent state (`granted`, `approved`). The UI
   always reads it back through PluginProtocol.effectivePlugin, which
   re-validates it, so nothing here is trusted on the way out. */

async function installPlugin(manifest, granted) {
  return setState((d) => {
    if (!d.meta.plugins) d.meta.plugins = {};
    const prev = d.meta.plugins[manifest.id];
    const perms = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    d.meta.plugins[manifest.id] = {
      id: manifest.id, name: manifest.name, version: manifest.version,
      description: manifest.description || '', author: manifest.author || '',
      entry: manifest.entry, permissions: perms.slice(),
      defaultSpan: manifest.defaultSpan || 1, defaultRowSpan: manifest.defaultRowSpan || 1,
      granted: (granted || []).filter((p, i, a) => perms.includes(p) && a.indexOf(p) === i),
      approved: true,
      installedAt: prev && prev.installedAt ? prev.installedAt : now(),
      updatedAt: now()
    };
    return d.meta.plugins[manifest.id];
  });
}

async function setPluginGrants(id, granted) {
  return setState((d) => {
    const rec = d.meta.plugins && d.meta.plugins[id];
    if (!rec) return;
    const perms = Array.isArray(rec.permissions) ? rec.permissions : [];
    rec.granted = (granted || []).filter((p, i, a) => perms.includes(p) && a.indexOf(p) === i);
    rec.approved = true;
    rec.updatedAt = now();
    return rec;
  });
}

/* Removing a plugin also removes the widgets (and their saved data) it powered. */
async function removePlugin(id) {
  return setState((d) => {
    if (d.meta.plugins) delete d.meta.plugins[id];
    for (const w of Object.values(d.widgets)) {
      if (w.type === 'plugin' && w.pluginId === id) delete d.widgets[w.id];
    }
  });
}

/* ---------- Settings ---------- */

/* Applies `patch` to the settings of one workspace (default: the active one).
   Each key is routed to where it lives: the shared keys (GLOBAL_SETTING_KEYS) go
   to meta.globalSettings, everything else to the workspace's own settings.
   Nested groups (dashboard, tabsList, notifications) are shallow-merged so a
   patch like { tabsList: { groupPinned: true } } keeps its sibling keys. */
async function updateSettings(patch, workspaceId) {
  return setState((d) => {
    const ws = d.workspaces[workspaceId || d.meta.activeWorkspaceId];
    if (!isPlainObject(d.meta.globalSettings)) d.meta.globalSettings = defaultGlobalSettings();
    const defs = defaultWorkspaceSettings();
    for (const [key, value] of Object.entries(patch || {})) {
      if (GLOBAL_SETTING_KEYS.includes(key)) { d.meta.globalSettings[key] = value; continue; }
      if (!ws) continue;
      if (!isPlainObject(ws.settings)) ws.settings = workspaceOnlySettings(resolveSettings(d, ws.id));
      const cur = ws.settings[key];
      if (isPlainObject(value) && (isPlainObject(cur) || isPlainObject(defs[key]))) {
        ws.settings[key] = Object.assign({}, isPlainObject(defs[key]) ? defs[key] : {}, isPlainObject(cur) ? cur : {}, value);
      } else {
        ws.settings[key] = value;
      }
    }
  });
}

/* Copies one workspace's settings onto another (the shared keys are untouched —
   they are not per workspace). */
async function copyWorkspaceSettings(fromId, toId) {
  return setState((d) => {
    if (!d.workspaces[fromId] || !d.workspaces[toId] || fromId === toId) return false;
    d.workspaces[toId].settings = workspaceOnlySettings(resolveSettings(d, fromId));
    return true;
  });
}

/* Sets a workspace's settings to exactly `settings` (as returned by
   settingsOf(); the shared keys in it are ignored). Used to undo a copy/reset. */
async function replaceWorkspaceSettings(workspaceId, settings) {
  return setState((d) => {
    const ws = d.workspaces[workspaceId];
    if (!ws) return false;
    ws.settings = workspaceOnlySettings(settings);
    return true;
  });
}

/* Puts a workspace's settings back to the factory defaults. */
async function resetWorkspaceSettings(workspaceId) {
  return setState((d) => {
    const ws = d.workspaces[workspaceId || d.meta.activeWorkspaceId];
    if (!ws) return false;
    ws.settings = defaultWorkspaceSettings();
    return true;
  });
}

/* Deletes a custom theme from the shared library and, in the same write, moves
   every workspace that was using it back to a preset. Returns the names of the
   workspaces that had to be changed. */
async function deleteCustomTheme(themeId) {
  return setState((d) => {
    const g = d.meta.globalSettings;
    if (!isPlainObject(g) || !Array.isArray(g.customThemes)) return [];
    g.customThemes = g.customThemes.filter(t => t && t.id !== themeId);
    const touched = [];
    for (const ws of Object.values(d.workspaces)) {
      if (!ws || !isPlainObject(ws.settings)) continue;
      const st = ws.settings;
      let hit = false;
      if (st.themeId === themeId) { st.themeId = (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches) ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID; hit = true; }
      if (st.lightThemeId === themeId) { st.lightThemeId = DEFAULT_LIGHT_THEME_ID; hit = true; }
      if (st.darkThemeId === themeId) { st.darkThemeId = DEFAULT_DARK_THEME_ID; hit = true; }
      if (hit) touched.push(ws.name);
    }
    return touched;
  });
}

/* ---------- Import / Export ----------

   A backup is the stored state itself: every table, `meta` (active workspace,
   plugin registry, shared settings) and — because they live on the workspace
   records — each workspace's own settings, all in the one file. Files from
   before per-workspace settings (one flat `meta.settings`) still import: those
   settings are applied to each workspace in the file. */

async function exportJSON() {
  const d = await getState();
  let appVersion;
  try { appVersion = chrome.runtime.getManifest().version; } catch (e) { /* not in an extension page (tests) */ }
  const out = Object.assign({ backup: { app: 'TabsBoard', format: 2, exportedAt: new Date().toISOString(), appVersion } }, d);
  // Write every workspace's settings out in full, so a restore doesn't depend on
  // the defaults of whatever version happens to import it.
  out.workspaces = {};
  for (const [id, ws] of Object.entries(d.workspaces)) {
    out.workspaces[id] = Object.assign({}, ws, { settings: workspaceOnlySettings(resolveSettings(d, id)) });
  }
  out.meta = Object.assign({}, d.meta, { globalSettings: globalSettingsOf(d) });
  return JSON.stringify(out, null, 2);
}

function backupError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/* Parses and validates a backup file's text. Returns the parsed object with
   its settings normalised to the current layout: each workspace's `settings`
   is sanitised (or null when the file carries none for it), `meta.globalSettings`
   is sanitised. Throws an Error with a `.code` ('not-json' | 'not-backup'). */
function parseBackup(jsonString) {
  let incoming;
  try { incoming = JSON.parse(jsonString); }
  catch (e) { throw backupError('not-json', 'That file is not valid JSON.'); }
  const isTable = (v) => isPlainObject(v);
  if (!isPlainObject(incoming) || !isTable(incoming.workspaces) || !Object.values(incoming.workspaces).some(isPlainObject)) {
    throw backupError('not-backup', "That file doesn't look like a TabsBoard backup.");
  }
  const meta = isPlainObject(incoming.meta) ? incoming.meta : {};
  const legacyFlat = isPlainObject(meta.settings) ? meta.settings : null;   // pre-per-workspace backups
  const legacyOwn = legacyFlat ? sanitizeWorkspaceSettings(legacyFlat) : null;
  const workspaces = {};
  for (const [id, ws] of Object.entries(isTable(incoming.workspaces) ? incoming.workspaces : {})) {
    if (!isPlainObject(ws)) continue;
    const copy = Object.assign({}, ws);
    copy.settings = isPlainObject(ws.settings) ? sanitizeWorkspaceSettings(ws.settings) : (legacyOwn ? cloneJSON(legacyOwn) : null);
    workspaces[id] = copy;
  }
  const globals = Object.assign({}, legacyFlat ? sanitizeGlobalSettings(legacyFlat) : {}, sanitizeGlobalSettings(meta.globalSettings));
  const normMeta = Object.assign({}, meta, { globalSettings: globals });
  delete normMeta.settings;
  return Object.assign({}, incoming, { workspaces, meta: normMeta });
}

/* What a backup file contains, for the import dialog. Never writes anything.
   Throws like parseBackup. */
function inspectBackup(jsonString) {
  const b = parseBackup(jsonString);
  const count = (t) => (isPlainObject(b[t]) ? Object.keys(b[t]).length : 0);
  const wsList = Object.values(b.workspaces).sort((x, y) => (x.order || 0) - (y.order || 0));
  return {
    workspaces: wsList.length,
    workspaceNames: wsList.map(w => String(w.name || 'Workspace')),
    collections: count('collections'),
    bookmarks: count('bookmarks'),
    widgets: count('widgets'),
    sessions: count('sessions'),
    hasSettings: wsList.some(w => w.settings),
    settingsWorkspaces: wsList.filter(w => w.settings).length,
    customThemes: (b.meta.globalSettings.customThemes || []).length,
    exportedAt: (isPlainObject(b.backup) && typeof b.backup.exportedAt === 'string') ? b.backup.exportedAt : null
  };
}

/* mode 'merge'   adds the file's workspaces next to yours (new ids; nothing existing is touched)
   mode 'replace' makes the file the whole truth
   opts.settings  (default true) carry the file's settings across. When false, or when the
                  file has none, imported workspaces start from your active workspace's
                  current settings instead. */
async function importJSON(jsonString, mode = 'merge', opts) {
  const useFileSettings = !opts || opts.settings !== false;
  const incoming = parseBackup(jsonString);
  return setState((d) => {
    // Fallback look for workspaces that arrive without (or without wanting) settings.
    const fallbackSettings = () => workspaceOnlySettings(resolveSettings(d, d.meta.activeWorkspaceId));
    const settingsFor = (ws) => (useFileSettings && ws.settings) ? cloneJSON(ws.settings) : fallbackSettings();
    if (!isPlainObject(d.meta.globalSettings)) d.meta.globalSettings = defaultGlobalSettings();

    if (mode === 'replace') {
      const keptShared = useFileSettings ? null : cloneJSON(globalSettingsOf(d));
      const keptLook = useFileSettings ? null : fallbackSettings();
      for (const t of RECORD_TABLES) d[t] = isPlainObject(incoming[t]) ? incoming[t] : {};
      for (const ws of Object.values(d.workspaces)) {
        ws.settings = (useFileSettings && ws.settings) ? ws.settings : (keptLook ? cloneJSON(keptLook) : defaultWorkspaceSettings());
      }
      const inMeta = incoming.meta || {};
      d.meta = {
        activeWorkspaceId: d.workspaces[inMeta.activeWorkspaceId] ? inMeta.activeWorkspaceId : ((Object.values(d.workspaces).sort((a, b) => (a.order || 0) - (b.order || 0))[0] || {}).id || null),
        globalSettings: Object.assign(defaultGlobalSettings(), useFileSettings ? inMeta.globalSettings : keptShared)
      };
      if (isPlainObject(inMeta.plugins)) d.meta.plugins = inMeta.plugins;
      // A backup file is untrusted input: it must not be able to hand a plugin
      // permissions the user never approved on this install. Imported plugin
      // records stay installed but are marked for review and won't run until
      // the user re-approves them (Settings → Widgets, or the widget's card).
      if (isPlainObject(d.meta.plugins)) {
        for (const rec of Object.values(d.meta.plugins)) { if (rec && typeof rec === 'object') rec.approved = false; }
      }
      return { mode: 'replace', workspaces: Object.keys(d.workspaces).length, settingsImported: useFileSettings && Object.values(incoming.workspaces).some(w => w.settings) };
    }

    // merge mode: add incoming workspaces/boards/collections/bookmarks/sessions
    // with fresh ids to avoid collisions, but keep structure intact.
    const idMap = {};
    const summary = { mode: 'merge', workspaces: 0, settingsImported: false, themesAdded: 0, themesSkipped: 0 };

    // Custom themes are a shared library: add the ones you don't have. A theme
    // whose id is taken by a *different* theme gets a new id, and the settings
    // of the incoming workspaces are pointed at it.
    const themeRemap = {};
    if (useFileSettings) {
      const lib = d.meta.globalSettings.customThemes = Array.isArray(d.meta.globalSettings.customThemes) ? d.meta.globalSettings.customThemes : [];
      for (const t of incoming.meta.globalSettings.customThemes || []) {
        const same = lib.find(x => x.id === t.id);
        if (same && JSON.stringify(same) === JSON.stringify(t)) continue;
        if (lib.length >= MAX_CUSTOM_THEMES_STORED) { summary.themesSkipped++; continue; }
        let id = t.id;
        if (same) { id = 'custom-' + uid(); themeRemap[t.id] = id; }
        lib.push(Object.assign({}, t, { id }));
        summary.themesAdded++;
      }
    }
    const libIds = new Set((d.meta.globalSettings.customThemes || []).map(t => t.id));
    const fixThemeRefs = (st) => {
      for (const k of ['themeId', 'lightThemeId', 'darkThemeId']) {
        if (typeof st[k] !== 'string') continue;
        if (themeRemap[st[k]]) st[k] = themeRemap[st[k]];
        else if (st[k].indexOf('custom-') === 0 && !libIds.has(st[k])) delete st[k];   // theme not in the file's library: fall back to default
      }
      return st;
    };

    // Workspaces (board ids are remapped below, so keep activeBoardId valid).
    const incomingWorkspaces = Object.values(incoming.workspaces || {}).sort((x, y) => (x.order || 0) - (y.order || 0));
    for (const ws of incomingWorkspaces) {
      const nid = uid();
      idMap[ws.id] = nid;
      const activeBoardId = idMap[ws.activeBoardId] || ws.activeBoardId;
      const settings = fixThemeRefs(settingsFor(ws));
      if (useFileSettings && ws.settings) summary.settingsImported = true;
      d.workspaces[nid] = { ...ws, id: nid, name: ws.name, activeBoardId, order: Object.keys(d.workspaces).length, settings };
      summary.workspaces++;
    }
    // Boards — each workspace needs its board(s) for widgets to render on.
    for (const b of Object.values(incoming.boards || {})) {
      const nid = uid();
      idMap[b.id] = nid;
      d.boards[nid] = { ...b, id: nid, workspaceId: idMap[b.workspaceId] || b.workspaceId };
    }
    for (const ws of incomingWorkspaces) {
      // activeBoardId was copied before its board had a new id; fix it up now.
      const w = d.workspaces[idMap[ws.id]];
      if (w && idMap[ws.activeBoardId]) w.activeBoardId = idMap[ws.activeBoardId];
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
    // Widgets — remap, and keep each widget on the cell it had when it fits (the
    // imported workspace brings its own board width, so layouts and gaps come
    // back as saved); anything that doesn't fit is packed into the first free cell.
    for (const w of Object.values(incoming.widgets || {})) {
      const nid = uid();
      idMap['w:' + w.id] = nid;
      const place = Object.assign({}, w, {
        id: nid,
        workspaceId: idMap[w.workspaceId] || w.workspaceId,
        boardId: idMap[w.boardId] || w.boardId,
        collectionId: w.collectionId != null ? (idMap[w.collectionId] || w.collectionId) : w.collectionId
      });
      const span = Math.max(1, place.span || 1), rowSpan = Math.max(1, place.rowSpan || 1);
      const fits = Number.isInteger(w.row) && Number.isInteger(w.col) && w.row >= 1 && w.col >= 1 &&
        w.col + span - 1 <= boardColumnCount(d, place.boardId) &&
        !rectOverlapsWidget(d, place.boardId, w.row, w.col, span, rowSpan, null);
      if (!fits) { delete place.row; delete place.col; }
      d.widgets[nid] = place;
      if (!fits) assignWidgetPosition(d, nid);
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
    return summary;
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
  uid, DEFAULT_COLLECTION_COLORS, NOTIFICATION_DEFAULTS, notificationSettings,
  init, getState, setState, clearAll, onChange, storageStats,
  createWorkspace, updateWorkspace, deleteWorkspace, setActiveWorkspace, moveCollectionToNewWorkspace, moveCollectionToWorkspace,
  createCollection, updateCollection, reorderCollections, softDeleteCollection,
  toggleCollectionPin, duplicateCollection, setCollectionSortMode, setCollectionViewMode,
  createBookmark, updateBookmark, updateBookmarks, moveBookmarks, reorderBookmarks, softDeleteBookmarks, toggleBookmarkPin, duplicateBookmark,
  restoreTrashItem, purgeTrashItem, emptyTrash, purgeExpiredTrash,
  createSession, deleteSession, renameSession, updateSessionTabs, duplicateSession, convertSessionToCollection,
  updateSettings, settingsOf, globalSettingsOf, copyWorkspaceSettings, resetWorkspaceSettings, replaceWorkspaceSettings, deleteCustomTheme,
  defaultWorkspaceSettings, GLOBAL_SETTING_KEYS, DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID,
  createWidget, updateWidget, deleteWidget, reorderWidgets, setWidgetRects,
  installPlugin, setPluginGrants, removePlugin,
  createBoard, renameBoard, setBoardMode, moveWidgetToBoard, deleteBoard, setActiveBoard,
  swapWidgetPositions, moveWidgetTo,
  occupiedCellsOfBoard, firstEmptyCell, assignWidgetPosition,
  exportJSON, importJSON, inspectBackup, bookmarksHTMLExport,
  importBrowserBookmarks,
  addBrowserCollection, syncBrowserCollection
};

if (typeof module !== 'undefined') module.exports = TabsDB;
