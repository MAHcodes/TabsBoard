(function () {
  const DB = TabsDB;
  const $ = (s) => document.querySelector(s);

  function sendMsg(type, payload = {}) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
  }

  async function currentTab() {
    return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
  }

  function applyTheme(state) {
    const s = state.meta.settings;
    const palette = Themes.resolveTheme(s.themeId, s.customThemes);
    const r = document.documentElement.style;
    r.setProperty('--bg', palette.bg);
    r.setProperty('--surface', palette.surface);
    r.setProperty('--surface-2', palette.surface2);
    r.setProperty('--border', palette.border);
    r.setProperty('--text', palette.text);
    r.setProperty('--text-muted', palette.textMuted);
    r.setProperty('--accent', palette.accent);
  }

  async function boot() {
    const tab = await currentTab();
    $('#p-title').textContent = tab.title || tab.url;
    $('#p-url').textContent = tab.url;
    if (tab.favIconUrl) $('#p-favicon').src = tab.favIconUrl;

    const state = await DB.getState();
    applyTheme(state);
    const wsId = state.meta.activeWorkspaceId;
    const cols = Object.values(state.collections).filter(c => c.workspaceId === wsId).sort((a, b) => a.order - b.order);

    const list = $('#p-list');
    list.innerHTML = '';
    if (!cols.length) list.innerHTML = '<div class="empty">No collections yet — create one below.</div>';
    cols.forEach(col => {
      const row = document.createElement('div');
      row.className = 'col-item';
      row.innerHTML = `<span class="dot" style="background:${col.color}"></span><span>${escapeHtml(col.name)}</span>`;
      row.onclick = async () => {
        await DB.createBookmark(col.id, wsId, { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
        sendMsg('REBUILD_MENUS');
        showDone();
      };
      list.appendChild(row);
    });

    $('#p-new-btn').onclick = async () => {
      const name = $('#p-new-name').value.trim();
      if (!name) return;
      const col = await DB.createCollection(wsId, name);
      await DB.createBookmark(col.id, wsId, { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
      sendMsg('REBUILD_MENUS');
      showDone();
    };

    $('#p-open-dash').onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('newtab/index.html') });
      window.close();
    };
  }

  function showDone() {
    document.body.innerHTML = '<div class="done">✓ Added to TabsBoard</div>';
    setTimeout(() => window.close(), 900);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
