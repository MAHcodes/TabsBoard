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
    document.documentElement.classList.toggle('no-borders', s.borders === false);
    ['radius-sharp', 'radius-rounded', 'radius-extra', 'radius-none'].forEach(c => document.documentElement.classList.toggle(c, s.radius === c.slice(7)));
    const palette = Themes.resolveTheme(s.themeId, s.lightThemeId, s.darkThemeId);
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
