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

  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  let COLS = [];

  function renderList(query) {
    const list = $('#p-list');
    list.innerHTML = '';
    const q = (query || '').trim().toLowerCase();
    const shown = COLS.filter(c => !q || c.name.toLowerCase().includes(q));
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${COLS.length ? 'No collections match.' : 'No collections yet — name one below.'}</div>`;
      return;
    }
    shown.forEach(col => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'col-item';
      row.innerHTML = `<span class="dot" style="background:${col.color}"></span><span class="name">${escapeHtml(col.name)}</span><span class="go">${CHEVRON}</span>`;
      row.onclick = async () => await addCurrentTab(col.id);
      list.appendChild(row);
    });
  }

  async function addCurrentTab(colId) {
    const tab = await currentTab();
    const state = await DB.getState();
    await DB.createBookmark(colId, state.meta.activeWorkspaceId, { title: tab.title, url: tab.url, favicon: tab.favIconUrl });
    sendMsg('REBUILD_MENUS');
    showDone();
  }

  async function createCollection() {
    const name = $('#p-new-name').value.trim();
    if (!name) return;
    const state = await DB.getState();
    const col = await DB.createCollection(state.meta.activeWorkspaceId, name);
    await addCurrentTab(col.id);
  }

  async function boot() {
    const tab = await currentTab();
    $('#p-title').textContent = tab.title || tab.url;
    $('#p-url').textContent = tab.url;
    if (tab.favIconUrl) $('#p-favicon').src = tab.favIconUrl;

    const state = await DB.getState();
    applyTheme(state);
    const wsId = state.meta.activeWorkspaceId;
    COLS = Object.values(state.collections).filter(c => c.workspaceId === wsId).sort((a, b) => a.order - b.order);
    renderList('');

    $('#p-filter').addEventListener('input', (e) => renderList(e.target.value));
    $('#p-new-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createCollection(); } });
    $('#p-new-btn').onclick = createCollection;
    $('#p-open-dash').onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('newtab/index.html') });
      window.close();
    };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
    $('#p-filter').focus();
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