/* TabsBoard — background script
 * Runs as an MV3 service worker in Chrome and an MV2 background page in Firefox.
 * Uses callback-style chrome.* APIs throughout, which both browsers support,
 * so the exact same file works unmodified in both builds.
 */

// Chrome MV3 service worker: pull in storage.js via importScripts.
// Firefox MV2 background page instead loads storage.js via a <script> tag
// in background.html, so TabsDB is already a global there.
if (typeof importScripts === 'function' && typeof TabsDB === 'undefined') {
  importScripts('../common/storage.js');
}
const DB = (typeof TabsDB !== 'undefined') ? TabsDB : self.TabsDB;

const CONTEXT_MENU_ROOT = 'tdb-add-to-collection';
const CONTEXT_MENU_PAGE = 'tdb-add-page';
const CONTEXT_MENU_LINK = 'tdb-add-link';
const CONTEXT_MENU_SELECTION = 'tdb-add-selection';

chrome.runtime.onInstalled.addListener(() => {
  DB.init();
  refreshSyncCollectionsFlag();
  rebuildContextMenus();
});

chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => {
  refreshSyncCollectionsFlag();
  rebuildContextMenus();
});

async function runTrashPurge() {
  try {
    const state = await DB.getState();
    const days = (state.meta.settings && state.meta.settings.trashRetentionDays) || 0;
    await DB.purgeExpiredTrash(days);
  } catch (e) { /* non-fatal */ }
}

/* chrome.alarms keeps housekeeping running even when the worker/page is
   idle: the trash purge runs every 12h and RSS widgets refresh on their
   setting-driven interval (so feeds stay fresh even if the dashboard is
   never opened). The alarm list is re-synced whenever settings change. */
async function syncAlarms() {
  if (!chrome.alarms) return;
  const state = await DB.getState();
  const rssMins = (state.meta.settings && state.meta.settings.rssRefreshInterval) || 0;
  chrome.alarms.create('tdb-trash-purge', { periodInMinutes: 12 * 60 });
  chrome.alarms.create('tdb-browser-sync', { periodInMinutes: 5 });
  if (rssMins > 0) chrome.alarms.create('tdb-rss-refresh', { periodInMinutes: rssMins });
  else chrome.alarms.clear('tdb-rss-refresh');
}
if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'tdb-trash-purge') runTrashPurge();
    else if (alarm.name === 'tdb-rss-refresh') runBackgroundRssRefresh();
    else if (alarm.name === 'tdb-browser-sync') runBrowserDataSync();
  });
}

/* ---- Background RSS refresh (mirrors the dashboard's per-widget fetch) ---- */
function originPatternFor(url) {
  try { return new URL(url).origin + '/*'; } catch { return null; }
}
function hasFeedPermission(url) {
  const pattern = originPatternFor(url);
  if (!pattern || !chrome.permissions || !chrome.permissions.contains) return Promise.resolve(true);
  return new Promise(res => chrome.permissions.contains({ origins: [pattern] }, res));
}
function fetchFeed(url) {
  return fetch(url)
    .then(res => res.text())
    .then((text) => {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      if (doc.querySelector('parsererror')) return null;
      const rssItems = Array.from(doc.querySelectorAll('item')).map(it => ({
        title: (it.querySelector('title') && it.querySelector('title').textContent) || 'Untitled',
        link: (it.querySelector('link') && it.querySelector('link').textContent) || ''
      }));
      const rssTitle = doc.querySelector('channel > title');
      if (rssItems.length) return { items: rssItems.filter(i => i.link).slice(0, 10), label: rssTitle ? rssTitle.textContent : '' };
      const atomEntries = Array.from(doc.querySelectorAll('entry')).map(en => {
        const linkEl = en.querySelector('link');
        return {
          title: (en.querySelector('title') && en.querySelector('title').textContent) || 'Untitled',
          link: linkEl ? (linkEl.getAttribute('href') || linkEl.textContent || '') : ''
        };
      });
      const feedTitle = doc.querySelector('feed > title');
      return { items: atomEntries.filter(i => i.link).slice(0, 10), label: feedTitle ? feedTitle.textContent : '' };
    })
    .catch(() => null);
}
async function runBackgroundRssRefresh() {
  try {
    const state = await DB.getState();
    const minMs = ((state.meta.settings && state.meta.settings.rssRefreshInterval) || 0) * 60000;
    if (!(minMs > 0)) return;
    for (const w of Object.values(state.widgets)) {
      if (w.type !== 'rss' || !w.feedUrl) continue;
      if (w.lastFetched && (Date.now() - w.lastFetched) < minMs) continue;
      if (!(await hasFeedPermission(w.feedUrl))) continue;
      const result = await fetchFeed(w.feedUrl);
      if (!result) continue;
      await DB.updateWidget(w.id, { items: result.items, label: w.label || result.label, lastFetched: Date.now() });
    }
  } catch (e) { /* non-fatal */ }
}

runTrashPurge();
syncAlarms();

/* ---- Browser-data collection sync ---- */
/* Shared fetchers used both when creating a browser-data collection and when
   the periodic sync mirrors it against the live browser. */
function fetchTopSitesItems(max) {
  return new Promise((res) => {
    const finish = (sites) => res(((sites || []).slice(0, max)).map(s => ({ title: s.title || '', url: s.url, favicon: s.favicon || '' })));
    try {
      const isFx = chrome.runtime && chrome.runtime.getURL('t').indexOf('moz-extension://') === 0;
      const p = chrome.topSites.get(isFx ? { newtab: true } : undefined);
      if (p && typeof p.then === 'function') p.then(finish, () => res([]));
      else chrome.topSites.get(finish);
    } catch (e) { res([]); }
  });
}
function fetchHistoryItems(max, days) {
  return new Promise((resolve) => {
    function done(list) {
      const seen = new Set();
      const out = [];
      (((list || []).filter(it => it && it.url))
        .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
        .filter(it => {
          if (/^(chrome|about|moz|edge|file|javascript|view-source):/i.test(it.url)) return false;
          if (seen.has(it.url)) return false;
          seen.add(it.url);
          return true;
        }))
        .forEach(it => out.push({
          title: (it.title || it.url).trim() || it.url,
          url: it.url, favicon: '',
          visitTime: it.lastVisitTime || 0
        }));
      resolve(out.slice(0, max));
    }
    try {
      chrome.history.search({ text: '', startTime: Date.now() - days * 86400000, maxResults: Math.max(max * 5, 50) }, done);
    } catch (e) { done(null); }
  });
}
async function runBrowserDataSync() {
  const summary = { synced: 0, changed: 0 };
  try {
    const state = await DB.getState();
    const settings = state.meta.settings || {};
    const historyMax = Math.max(1, Number(settings.historyCount) || 10);
    const topCount = Math.max(1, Number(settings.topSitesCount) || 12);
    for (const col of Object.values(state.collections)) {
      if (!col || !col.syncSource) continue;
      let items = [];
      let max = 0;
      if (col.syncSource === 'history') {
        items = await fetchHistoryItems(Math.max(historyMax, 20), 7);
        max = historyMax;
      } else if (col.syncSource === 'topSites') {
        items = await fetchTopSitesItems(topCount);
        max = topCount;
      }
      if (!items.length) continue;
      const result = await DB.syncBrowserCollection(col.id, items, col.syncSource, max);
      summary.synced++;
      if (result.changed) summary.changed++;
    }
  } catch (e) { /* non-fatal */ }
  return summary;
}

/* Live browser-data sync triggers. Synced collections mirror the browser
   whenever a tab is closed (the visit gets committed to history), and when
   the "History tabs shown" setting changes so the collection resizes to the
   new maximum immediately instead of waiting for the next alarm. The 5-minute
   alarm in syncAlarms() remains as a safety net. Debouncing coalesces a burst
   of tab closes (e.g. closing a whole window) into a single refresh, and the
   short delay lets the browser flush the visit before we re-query it. */
let bsyncTimer = null;
let hasSyncCollections = false;
async function refreshSyncCollectionsFlag() {
  try {
    const s = await DB.getState();
    hasSyncCollections = Object.values(s.collections || {}).some(c => c && c.syncSource);
  } catch (e) { hasSyncCollections = false; }
}
function scheduleBrowserDataSync(delayMs) {
  clearTimeout(bsyncTimer);
  bsyncTimer = setTimeout(() => { runBrowserDataSync().catch(() => {}); }, delayMs == null ? 2500 : delayMs);
}

async function rebuildContextMenus() {
  chrome.contextMenus.removeAll(async () => {
    const state = await DB.getState();
    const wsId = state.meta.activeWorkspaceId;
    const collections = Object.values(state.collections)
      .filter(c => c.workspaceId === wsId)
      .sort((a, b) => a.order - b.order);

    chrome.contextMenus.create({
      id: CONTEXT_MENU_PAGE,
      title: 'Add page to TabsBoard',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_LINK,
      title: 'Add link to TabsBoard',
      contexts: ['link']
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SELECTION,
      title: 'Save selection to TabsBoard',
      contexts: ['selection']
    });

    for (const ctx of ['page', 'link']) {
      const rootId = `tdb-${ctx}-root`;
      chrome.contextMenus.create({
        id: rootId,
        title: `  Add ${ctx === 'page' ? 'page' : 'link'} to collection…`,
        contexts: [ctx]
      });
      for (const col of collections) {
        chrome.contextMenus.create({
          id: `tdb-${ctx}-${col.id}`,
          parentId: rootId,
          title: col.name,
          contexts: [ctx]
        });
      }
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = info.menuItemId;
  if (typeof id !== 'string' || !id.startsWith('tdb-')) return;

  const isLink = id.startsWith('tdb-link-');
  const isPage = id.startsWith('tdb-page-');
  const url = isLink ? info.linkUrl : (info.pageUrl || (tab && tab.url));
  const title = isLink ? (info.linkUrl) : (tab && tab.title) || url;

  const state = await DB.getState();
  const wsId = state.meta.activeWorkspaceId;

  if (id === CONTEXT_MENU_SELECTION) {
    // Save the highlighted text as a note on a bookmark of the current page.
    const first = Object.values(state.collections).filter(c => c.workspaceId === wsId).sort((a, b) => a.order - b.order)[0];
    if (first) {
      await DB.createBookmark(first.id, wsId, {
        title: (tab && tab.title) || info.pageUrl || 'Selection',
        url: info.pageUrl || '',
        favicon: tab && tab.favIconUrl,
        notes: (info.selectionText || '').slice(0, 1000)
      });
      if (chrome.notifications && chrome.notifications.create) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'TabsBoard',
          message: 'Selection saved to "' + first.name + '"'
        });
      }
    }
    return;
  }

  if (id === CONTEXT_MENU_PAGE || id === CONTEXT_MENU_LINK) {
    // default: add to first collection in active workspace
    const first = Object.values(state.collections).filter(c => c.workspaceId === wsId).sort((a, b) => a.order - b.order)[0];
    if (first) await DB.createBookmark(first.id, wsId, { title, url, favicon: tab && tab.favIconUrl });
    return;
  }

  const collectionId = id.split('-').pop();
  if (state.collections[collectionId]) {
    await DB.createBookmark(collectionId, wsId, { title, url, favicon: tab && tab.favIconUrl });
  }
});

// Keyboard shortcuts (declared in manifest "commands")
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-dashboard') {
    const dashUrl = chrome.runtime.getURL('newtab/index.html');
    const existing = await new Promise(res => chrome.tabs.query({ url: dashUrl }, res));
    if (existing && existing[0]) {
      chrome.tabs.update(existing[0].id, { active: true });
      chrome.windows.update(existing[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: dashUrl });
    }
  } else if (command === 'quick-add-tab') {
    const [tab] = await new Promise(res => chrome.tabs.query({ active: true, currentWindow: true }, res));
    if (!tab) return;
    const state = await DB.getState();
    const wsId = state.meta.activeWorkspaceId;
    const first = Object.values(state.collections).filter(c => c.workspaceId === wsId).sort((a, b) => a.order - b.order)[0];
    if (first) {
      await DB.createBookmark(first.id, wsId, { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
      chrome.action ? chrome.action.setBadgeText({ text: '✓' }) : chrome.browserAction.setBadgeText({ text: '✓' });
      setTimeout(() => {
        (chrome.action || chrome.browserAction).setBadgeText({ text: '' });
        updateTabBadge();
      }, 1200);
    }
  } else if (command === 'toggle-sidebar') {
    // Broadcast to any open dashboard tab(s); dashboard.js listens for this
    // and flips its own sidebar-collapsed setting. A background script
    // can't reach into the newtab page's DOM/state directly, so this is
    // just a relay — it lets the shortcut be a real, remappable Chrome
    // command (visible in chrome://extensions/shortcuts) instead of only
    // working while a dashboard tab already has keyboard focus.
    chrome.runtime.sendMessage({ type: 'TOGGLE_SIDEBAR_REQUEST' }).catch(() => {});
  }
});

/* OPEN_URL handler shared with the dashboard. By default bookmarks open in
   the dashboard tab itself (navigating the new-tab page to the URL), so you
   don't accumulate a new tab every time. When settings.openBookmarksInNewTab
   is on, they open in a fresh tab instead. The dashboard's own tab is the
   sender here, so sender.tab is exactly the page the click came from. */
async function openUrlFromDashboard(msg, sender, done) {
  // Non-bookmark actions (search, RSS item clicks, "open all") force a new
  // tab so they never navigate the dashboard away.
  if (msg.forceNewTab) { chrome.tabs.create({ url: msg.url, active: msg.active !== false }, done); return; }
  const state = await DB.getState();
  const openInNew = !!(state.meta.settings && state.meta.settings.openBookmarksInNewTab);
  if (!openInNew && sender && sender.tab && sender.tab.id) {
    chrome.tabs.update(sender.tab.id, { url: msg.url }, done);
  } else {
    chrome.tabs.create({ url: msg.url, active: msg.active !== false }, done);
  }
}

// Message hub used by dashboard/popup for tab-related operations
// that require the background's persistent access to chrome.tabs.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'GET_OPEN_TABS': {
        const tabs = await new Promise(res => chrome.tabs.query({ currentWindow: true }, res));
        sendResponse({ tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active, pinned: t.pinned, mutedInfo: t.mutedInfo, audible: t.audible, discarded: t.discarded, canGoBack: t.canGoBack, canGoForward: t.canGoForward })) });
        break;
      }
      case 'GET_ALL_TABS': {
        // Every tab across every open window — used for "save all windows" sessions.
        const tabs = await new Promise(res => chrome.tabs.query({}, res));
        sendResponse({ tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, windowId: t.windowId })) });
        break;
      }
      case 'GET_WINDOW_COUNT': {
        chrome.windows.getAll({}, (wins) => sendResponse({ count: wins.length }));
        break;
      }
      case 'FOCUS_TAB': {
        chrome.tabs.update(msg.tabId, { active: true }, (tab) => {
          if (tab) chrome.windows.update(tab.windowId, { focused: true });
          sendResponse({ ok: true });
        });
        break;
      }
      case 'CLOSE_TAB': {
        chrome.tabs.remove(msg.tabId, () => sendResponse({ ok: true }));
        break;
      }
      case 'DUPLICATE_TAB': {
        chrome.tabs.duplicate(msg.tabId, () => sendResponse({ ok: true }));
        break;
      }
      case 'RELOAD_TAB': {
        const bypass = !!msg.bypassCache;
        chrome.tabs.reload(msg.tabId, { bypassCache: bypass }, () => sendResponse({ ok: true }));
        break;
      }
      case 'GO_BACK_TAB':
      case 'GO_FORWARD_TAB': {
        const navFn = msg.type === 'GO_BACK_TAB' ? (chrome.tabs.goBack) : (chrome.tabs.goForward);
        if (!navFn) { sendResponse({ ok: false, error: 'not supported' }); break; }
        let answered = false;
        const finish = (ok, errMsg) => {
          if (answered) return;
          answered = true;
          sendResponse({ ok, error: errMsg });
        };
        try {
          const p = msg.type === 'GO_BACK_TAB' ? chrome.tabs.goBack(msg.tabId) : chrome.tabs.goForward(msg.tabId);
          if (p && typeof p.then === 'function') p.then(() => finish(true), (err) => finish(false, (err && err.message) || String(err)));
          else (msg.type === 'GO_BACK_TAB' ? chrome.tabs.goBack(msg.tabId, (res) => {
            const err = chrome.runtime.lastError;
            finish(!err && res);
          }) : chrome.tabs.goForward(msg.tabId, (res) => {
            const err = chrome.runtime.lastError;
            finish(!err && res);
          }));
        } catch (err) {
          finish(false, (err && err.message) || String(err));
        }
        break;
      }
      case 'GET_DOWNLOADS': {
        if (!chrome.downloads || !chrome.downloads.search) { sendResponse({ downloads: [] }); break; }
        const count = msg.count || 8;
        const items = await new Promise(res => chrome.downloads.search({ limit: Math.max(count * 5, 40), orderBy: ['-startTime'] }, res));
        sendResponse({
          downloads: items
            .filter(d => d.state === 'complete')
            .slice(0, count)
            .map(d => ({ id: d.id, url: d.url || d.finalUrl || '', filename: d.filename || '', size: d.fileSize || d.bytesReceived || 0, endTime: d.endTime }))
        });
        break;
      }
      case 'OPEN_DOWNLOAD': {
        if (!chrome.downloads || !chrome.downloads.open) { sendResponse({ ok: false, error: 'not supported' }); break; }
        let answered = false;
        const finish = (ok, errMsg) => {
          if (answered) return;
          answered = true;
          sendResponse({ ok, error: errMsg });
        };
        try {
          const p = chrome.downloads.open(msg.id);
          if (p && typeof p.then === 'function') p.then(() => finish(true), (err) => finish(false, (err && err.message) || String(err)));
          else chrome.downloads.open(msg.id, () => {
            const err = chrome.runtime.lastError;
            finish(!err, err ? err.message : undefined);
          });
        } catch (err) {
          finish(false, (err && err.message) || String(err));
        }
        break;
      }
      case 'SHOW_DOWNLOAD': {
        if (!chrome.downloads || !chrome.downloads.show) { sendResponse({ ok: false }); break; }
        chrome.downloads.show(msg.id);
        sendResponse({ ok: true });
        break;
      }
      case 'GET_HISTORY': {
        if (!chrome.history || !chrome.history.search) { sendResponse({ history: [] }); break; }
        const count = msg.count || 10;
        const days = msg.days > 0 ? msg.days : 1;
        const items = await new Promise(res => chrome.history.search({
          text: '',
          startTime: Date.now() - days * 86400000,
          maxResults: count * 5
        }, res));
        const seen = new Set();
        const out = [];
        (items || [])
          .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
          .forEach(it => {
            if (!it || !it.url || /^(chrome|about|moz|edge|file|javascript|view-source):/i.test(it.url)) return;
            if (seen.has(it.url)) return;
            seen.add(it.url);
            out.push({ url: it.url, title: it.title || it.url, visitCount: it.visitCount || 0, lastVisitTime: it.lastVisitTime || 0 });
          });
        sendResponse({ history: out.slice(0, count) });
        break;
      }
      case 'TOGGLE_PIN_TAB': {
        chrome.tabs.update(msg.tabId, { pinned: msg.pinned }, () => sendResponse({ ok: true }));
        break;
      }
      case 'TOGGLE_MUTE_TAB': {
        chrome.tabs.update(msg.tabId, { muted: msg.muted }, () => sendResponse({ ok: true }));
        break;
      }
      case 'MOVE_TAB_NEW_WINDOW': {
        chrome.windows.create({ tabId: msg.tabId }, () => sendResponse({ ok: true }));
        break;
      }
      case 'DISCARD_TAB': {
        // Manually unload a tab from memory (Chrome keeps it in the tab
        // strip but frees its process/memory — like Zen Browser's "unload
        // tab"). Chrome silently no-ops this on the focused/active tab, so
        // the caller avoids offering it there. Plain promise-style call so
        // it behaves the same on Firefox and Chrome; a clean resolve means
        // "discarded" and the caller's follow-up refresh reflects the state.
        if (!chrome.tabs.discard) { sendResponse({ ok: false, error: 'not supported' }); break; }
        let answered = false;
        const finish = (ok, errMsg) => {
          if (answered) return;
          answered = true;
          sendResponse({ ok, error: errMsg });
        };
        try {
          const p = chrome.tabs.discard(msg.tabId);
          if (p && typeof p.then === 'function') {
            p.then(() => finish(true), (err) => finish(false, (err && err.message) || String(err)));
          } else {
            // No promise support (unlikely): optimistic, next refresh shows truth.
            finish(true);
          }
        } catch (err) {
          finish(false, (err && err.message) || String(err));
        }
        break;
      }
      case 'OPEN_URL': {
        openUrlFromDashboard(msg, sender, () => sendResponse({ ok: true }));
        return true; // async
      }
      case 'OPEN_URLS': {
        // A single chrome.windows.create({url:[...]}) call opens every URL
        // as its own tab in one new window — far more reliable than chaining
        // windows.create(first) -> tabs.create(rest) across two async calls,
        // which is what silently did nothing before (a failed/late second
        // call left the window with just one tab, or nothing happened at
        // all if the first call's callback never fired in time).
        const urls = (msg.urls || []).filter(Boolean);
        if (!urls.length) { sendResponse({ ok: false, error: 'no urls' }); break; }
        if (msg.newWindow) {
          chrome.windows.create({ url: urls, focused: true }, (win) => {
            sendResponse({ ok: !!win, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : undefined });
          });
        } else {
          urls.forEach(u => chrome.tabs.create({ url: u, active: false }));
          sendResponse({ ok: true });
        }
        break;
      }
      case 'RESTORE_SESSION': {
        const urls = (msg.tabs || []).map(t => t.url).filter(Boolean);
        if (!urls.length) { sendResponse({ ok: false, error: 'no urls' }); break; }
        if (msg.newWindow) {
          chrome.windows.create({ url: urls, focused: true }, (win) => {
            sendResponse({ ok: !!win, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : undefined });
          });
        } else {
          urls.forEach(u => chrome.tabs.create({ url: u, active: false }));
          sendResponse({ ok: true });
        }
        break;
      }
      case 'REBUILD_MENUS': {
        await rebuildContextMenus();
        sendResponse({ ok: true });
        break;
      }
      case 'SEARCH_WEB': {
        // chrome.search.query (Chrome) and chrome.search.search (Firefox)
        // run a search in the browser's engine of choice. If the API is
        // missing we report back ok:false so the caller can fall back to
        // opening a search URL itself.
        const text = (msg && msg.text || '').trim();
        if (!text || !chrome.search || (!chrome.search.query && !chrome.search.search)) {
          sendResponse({ ok: false });
          break;
        }
        try {
          let p;
          if (chrome.search.query) p = chrome.search.query({ text, disposition: 'NEW_TAB' });
          else p = chrome.search.search({ query: text, disposition: 'NEW_TAB' });
          if (p && typeof p.then === 'function') p.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
          else sendResponse({ ok: true });
        } catch (e) { sendResponse({ ok: false }); }
        break;
      }
      case 'GET_COMMANDS': {
        if (!chrome.commands || !chrome.commands.getAll) { sendResponse({ commands: [] }); break; }
        chrome.commands.getAll((cmds) => {
          sendResponse({
            commands: (cmds || [])
              .filter(c => c.name !== '_execute_action' && c.name !== '_execute_browser_action')
              .map(c => ({ name: c.name, shortcut: c.shortcut || '', description: c.description || '' }))
          });
        });
        break;
      }
      case 'IMPORT_BOOKMARKS': {
        if (!chrome.bookmarks || !chrome.bookmarks.getTree) { sendResponse({ ok: false, error: 'not supported' }); break; }
        (async () => {
          try {
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const items = [];
            const MAX = 250;
            const umbrellaRoots = new Set(['Bookmarks Toolbar', 'Bookmarks bar', 'Other bookmarks', 'Mobile bookmarks', 'Managed bookmarks']);
            const walk = (node, colTitle) => {
              for (const child of (node.children || [])) {
                if (items.length >= MAX) return;
                if (child.url) {
                  items.push({ collection: colTitle || 'Imported bookmarks', title: child.title || child.url, url: child.url });
                } else {
                  // Folders become their own collection; deeper nesting is
                  // flattened into that same collection (the model is flat).
                  walk(child, colTitle || (child.title || 'Imported bookmarks'));
                }
              }
            };
            for (const root of (tree[0] && tree[0].children) || []) {
              if (root.url) { items.push({ collection: 'Imported bookmarks', title: root.title || root.url, url: root.url }); continue; }
              walk(root, umbrellaRoots.has(root.title) ? null : root.title);
            }
            const created = await DB.importBrowserBookmarks(items);
            sendResponse({ ok: true, ...created });
          } catch (e) {
            sendResponse({ ok: false, error: String((e && e.message) || e) });
          }
        })();
        break;
      }
      case 'ADD_BROWSER_COLLECTION': {
        // Snapshot live browser data into a real *synced* collection (top
        // sites or history): one atomic write creates the collection, its
        // bookmarks, and the collection widget that shows it. From then on
        // runBrowserDataSync keeps the collection mirrored against the
        // browser, so it behaves like a live widget that's also editable.
        const wsId = msg.workspaceId;
        const kind = msg.kind === 'history' ? 'history' : 'topSites';
        const name = kind === 'history' ? 'History' : 'Most visited';
        let sources = [];
        try {
          if (kind === 'topSites') {
            if (!chrome.topSites) { sendResponse({ ok: false, error: 'not supported' }); break; }
            const count = Math.max(1, Number(msg.count) || 12);
            sources = await fetchTopSitesItems(count);
          } else {
            if (!chrome.history || !chrome.history.search) { sendResponse({ ok: false, error: 'not supported' }); break; }
            const count = Math.max(1, Number(msg.count) || 10);
            sources = await fetchHistoryItems(Math.max(count, 20), 7);
          }
        } catch (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
          break;
        }
        if (!sources.length) { sendResponse({ ok: false, error: 'empty' }); break; }
        const out = await DB.addBrowserCollection(wsId, name, sources, kind);
        await rebuildContextMenus();
        sendResponse({ ok: true, name: out.name, count: out.count, collectionId: out.collectionId });
        break;
      }
      case 'SYNC_BROWSER_COLLECTIONS': {
        const summary = await runBrowserDataSync();
        sendResponse({ ok: true, ...summary });
        break;
      }
      case 'GET_RECENTLY_CLOSED': {
        if (!chrome.sessions) { sendResponse({ items: [] }); break; }
        const limit = Number(msg.limit) || 0;
        // "All" (limit 0) is still bounded: some browsers keep an enormous
        // session backlog and walking every entry would stall the dashboard.
        // 300 entries covers far more than any real "recently closed" list.
        const transform = (sessions) => {
          const items = [];
          (sessions || []).forEach(s => {
            if (s.tab) {
              items.push({ sessionId: s.tab.sessionId, title: s.tab.title, url: s.tab.url, favIconUrl: s.tab.favIconUrl, isWindow: false, closedAt: s.lastModified || null });
            } else if (s.window && s.window.tabs) {
              // Closed windows come back as a single session; restore the
              // whole window with one sessions.restore() call.
              items.push({
                sessionId: s.window.sessionId,
                title: `Window · ${s.window.tabs.length} tab${s.window.tabs.length === 1 ? '' : 's'}`,
                url: '', favIconUrl: '',
                isWindow: true,
                closedAt: s.lastModified || null,
                tabs: s.window.tabs.map(t => ({ title: t.title, url: t.url, favIconUrl: t.favIconUrl }))
              });
            }
          });
          sendResponse({ items });
        };
        // getRecentlyClosed can throw or fail to invoke the callback on some
        // browsers (Firefox also rejects oversized maxResults values), so we
        // retry with the safe 25 cap before giving up — never hang the request.
        const requested = limit > 0 ? limit : 300;
        const tryFetch = (mx) => {
          try {
            const done = (sessions) => (sessions ? transform(sessions) : retry(mx));
            const p = chrome.sessions.getRecentlyClosed({ maxResults: mx });
            if (p && typeof p.then === 'function') p.then(done, () => retry(mx));
            else chrome.sessions.getRecentlyClosed({ maxResults: mx }, done);
          } catch (e) {
            retry(mx);
          }
        };
        const retry = (mx) => { if (mx !== 25) tryFetch(25); else transform([]); };
        tryFetch(requested);
        break;
      }
      case 'REOPEN_CLOSED_SESSION': {
        if (!chrome.sessions) { sendResponse({ ok: false }); break; }
        chrome.sessions.restore(msg.sessionId, () => sendResponse({ ok: true }));
        break;
      }
      default:
        sendResponse({ error: 'unknown message type' });
    }
  })();
  return true; // keep the message channel open for the async response
});

// Keep context menus in sync whenever collections change from the dashboard,
// and re-sync alarms when settings (like the RSS refresh interval) change.
let alarmSyncTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.tdb_data) return;
  rebuildContextMenus();
  // Debounced so a burst of writes (e.g. bulk bookmark import) doesn't
  // churn alarms.
  clearTimeout(alarmSyncTimer);
  alarmSyncTimer = setTimeout(syncAlarms, 1500);
  // Re-evaluate whether any synced collections exist, and if the history
  // count setting changed, resize those collections right away (the 5-min
  // alarm otherwise waits until the next tick).
  refreshSyncCollectionsFlag();
  const ns = changes.tdb_data.newValue.meta && changes.tdb_data.newValue.meta.settings;
  const os = changes.tdb_data.oldValue && changes.tdb_data.oldValue.meta && changes.tdb_data.oldValue.meta.settings;
  if (ns && (!os || os.historyCount !== ns.historyCount || os.topSitesCount !== ns.topSitesCount)) scheduleBrowserDataSync(600);
});

/* Live update push for open dashboards.
   Any tab/window/session change is debounced into a single lightweight
   TABS_CHANGED broadcast. The dashboard re-fetches its Open Tabs and
   Recently Closed lists on receipt, so the sidebar updates the instant a
   tab opens/closes/navigates instead of waiting up to the next poll. The
   poll stays as a safety net for anything that happens while no dashboard
   is listening (chrome.runtime.sendMessage resolves/rejects harmlessly when
   no receiving context is open, which is why the promise is swallowed). */
let broadcastTimer = null;
function broadcastTabsChanged() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    updateTabBadge();
    try {
      const p = chrome.runtime.sendMessage({ type: 'TABS_CHANGED' });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* no dashboard open to notify */ }
  }, 200);
}

/* Live open-tab counter on the toolbar icon. The badge shows how many tabs
   are open across all windows, refreshed on every tab/window event (via the
   debounced broadcast above) and whenever the transient ✓ from quick-add
   clears. Uses whichever toolbar API the manifest version provides. */
function updateTabBadge() {
  const api = chrome.action || chrome.browserAction;
  if (!api) return;
  chrome.tabs.query({}, (tabs) => {
    const count = (tabs || []).length;
    api.setBadgeText({ text: count ? String(count) : '' });
  });
}
{
  const api = chrome.action || chrome.browserAction;
  if (api) {
    api.setBadgeBackgroundColor({ color: '#6366f1' });
    if (api.setBadgeTextColor) api.setBadgeTextColor({ color: '#ffffff' });
  }
  updateTabBadge();
}

chrome.tabs.onCreated.addListener(broadcastTabsChanged);
chrome.tabs.onRemoved.addListener(() => { broadcastTabsChanged(); if (hasSyncCollections) scheduleBrowserDataSync(2500); });
chrome.tabs.onUpdated.addListener(broadcastTabsChanged);
chrome.tabs.onActivated.addListener(broadcastTabsChanged);
chrome.windows.onCreated.addListener(broadcastTabsChanged);
chrome.windows.onRemoved.addListener(broadcastTabsChanged);
chrome.windows.onFocusChanged.addListener(broadcastTabsChanged);
if (chrome.sessions && chrome.sessions.onChanged) {
  chrome.sessions.onChanged.addListener(broadcastTabsChanged);
}

/* Downloads mirroring: the browser fires chrome.downloads.onChanged for
   every state/location change, so we push DOWNLOADS_CHANGED to open
   dashboards instead of polling. The dashboard re-fetches its downloads
   widget on receipt, keeping it live with zero intervals. */
let dlTimer = null;
function broadcastDownloadsChanged() {
  clearTimeout(dlTimer);
  dlTimer = setTimeout(() => {
    try {
      const p = chrome.runtime.sendMessage({ type: 'DOWNLOADS_CHANGED' });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* no dashboard open to notify */ }
  }, 200);
}
if (chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener(broadcastDownloadsChanged);
}

/* Address-bar integration (chrome.omnibox). Type "tb <query>" in the
   address bar to search collections, bookmarks, and sessions. Suggestions
   carry real destination URLs, so the omnibox shows where each entry goes:
   - bookmark entries open that URL,
   - collection entries open the dashboard focused on that widget,
   - session entries open the dashboard's Sessions view,
   - a plain query is searched with the saved web engine. */
const SEARCH_URLS = {
  google: 'https://www.google.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  bing: 'https://www.bing.com/search?q='
};
function openWebSearch(q) {
  DB.getState().then((state) => {
    const engine = (state.meta.settings && state.meta.settings.searchEngine) || 'google';
    chrome.tabs.create({ url: (SEARCH_URLS[engine] || SEARCH_URLS.google) + encodeURIComponent(q) });
  });
}
if (chrome.omnibox) {
  chrome.omnibox.setDefaultSuggestion({ description: 'TabsBoard — search collections, bookmarks & sessions' });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const q = (text || '').trim().toLowerCase();
    if (!q || !chrome.omnibox) { suggest([]); return; }
    DB.getState().then((state) => {
      const matches = [];
      const push = (content, description, limit = 250) => {
        if (matches.length >= limit) return;
        matches.push({ content, description });
      };
      Object.values(state.collections)
        .filter(c => c.name.toLowerCase().includes(q))
        .slice(0, 4)
        .forEach(c => push(chrome.runtime.getURL('newtab/index.html#col=' + c.id), 'Collection: ' + c.name));
      Object.values(state.bookmarks)
        .filter(b => (b.title || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q))
        .slice(0, 6)
        .forEach(b => push(b.url, 'Bookmark: ' + (b.title || b.url)));
      Object.values(state.sessions)
        .filter(s => (s.name || '').toLowerCase().includes(q))
        .slice(0, 5)
        .forEach(s => {
          const n = (s.tabs || []).length;
          push(chrome.runtime.getURL('newtab/index.html#view=sessions'), `Session · ${n} tab${n === 1 ? '' : 's'} · ` + s.name);
        });
      suggest(matches.slice(0, 8));
    });
  });
  chrome.omnibox.onInputEntered.addListener((content) => {
    content = content || '';
    // Picked suggestions are already real destinations (a bookmark URL or a
    // dashboard deep link); normal typing falls through to a web search.
    const newtabBase = chrome.runtime.getURL('newtab/');
    const isDirectUrl = content.indexOf(newtabBase) === 0 ||
      content.includes('://') ||
      /^(about|file|chrome|data|view-source|mailto|tel|javascript):/i.test(content);
    if (isDirectUrl) {
      chrome.tabs.create({ url: content });
    } else if (content.trim()) {
      openWebSearch(content.trim());
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('newtab/index.html') });
    }
  });
}
