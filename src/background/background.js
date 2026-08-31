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

chrome.runtime.onInstalled.addListener(() => {
  DB.init();
  rebuildContextMenus();
});

chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => {
  rebuildContextMenus();
});

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
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab/index.html') });
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

// Message hub used by dashboard/popup for tab-related operations
// that require the background's persistent access to chrome.tabs.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'GET_OPEN_TABS': {
        const tabs = await new Promise(res => chrome.tabs.query({ currentWindow: true }, res));
        sendResponse({ tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active, pinned: t.pinned, mutedInfo: t.mutedInfo, audible: t.audible, discarded: t.discarded })) });
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
        // tab"). Chrome silently no-ops this on the focused tab, so the
        // caller should avoid offering it for the active tab.
        if (!chrome.tabs.discard) { sendResponse({ ok: false, error: 'not supported' }); break; }
        chrome.tabs.discard(msg.tabId, (tab) => {
          sendResponse({ ok: !!tab, discarded: tab && tab.discarded, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : undefined });
        });
        break;
      }
      case 'OPEN_URL': {
        chrome.tabs.create({ url: msg.url, active: msg.active !== false }, () => sendResponse({ ok: true }));
        break;
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
      case 'GET_RECENTLY_CLOSED': {
        if (!chrome.sessions) { sendResponse({ items: [] }); break; }
        chrome.sessions.getRecentlyClosed({ maxResults: 10 }, (sessions) => {
          const items = (sessions || [])
            .filter(s => s.tab)
            .map(s => ({ sessionId: s.tab.sessionId, title: s.tab.title, url: s.tab.url, favIconUrl: s.tab.favIconUrl }));
          sendResponse({ items });
        });
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

// Keep context menus in sync whenever collections change from the dashboard.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tdb_data) rebuildContextMenus();
});
