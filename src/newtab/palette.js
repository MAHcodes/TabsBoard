  /* Command palette + modal overlay plumbing. Shared with the other newtab
   modules through the page's single global scope (old-school classic-script
   composition — see index.html, loaded after common/). The purely-functional
   matcher/highlighter lives in common/search.js under SearchUtils. */
  const { fuzzyMatch, highlightLabel } = SearchUtils;

  /* ============ MODAL / PALETTE plumbing ============ */

  /* Open/close the layered overlays with keyboard focus management: Tab is
     trapped inside the open layer (a modal shouldn't tab into the dashboard
     behind the scrim), and when a layer closes, focus returns to whatever
     opened it. Keeps openPalette/openSettings/etc. one-liners while fixing
     the previous "focus leaks into the page behind the dialog" behavior. */
  const _overlayKeydowns = new Map();
  const _overlayBackdrops = new Map();
  const _overlayClosers = new Map(); // overlay id -> close fn (covers cleanup)
  function registerOverlayCloser(id, fn) { _overlayClosers.set(id, fn); }
  function showOverlay(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('hidden');
    if (!_overlayBackdrops.has(id)) {
      const onBackdrop = (e) => {
        if (e.target !== el) return; // only clicks on the scrim itself close it
        const closer = _overlayClosers.get(id);
        if (closer) closer(); else hideOverlay(id);
      };
      _overlayBackdrops.set(id, onBackdrop);
      el.addEventListener('click', onBackdrop);
    }
    if (!_overlayKeydowns.has(id)) {
      _overlayKeydowns.set(id, document.activeElement);
      const onKey = (e) => {
        if (e.key !== 'Tab') return;
        const focusables = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus(); }
      };
      document.addEventListener('keydown', onKey, true);
      el._tdbTrap = onKey;
    }
    const firstFocusable = el.querySelector('input, button:not([disabled]), select, textarea');
    if (firstFocusable) firstFocusable.focus();
  }
  function hideOverlay(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('hidden');
    if (_overlayBackdrops.has(id)) {
      el.removeEventListener('click', _overlayBackdrops.get(id));
      _overlayBackdrops.delete(id);
    }
    if (_overlayKeydowns.has(id)) {
      document.removeEventListener('keydown', el._tdbTrap, true);
      delete el._tdbTrap;
      const opener = _overlayKeydowns.get(id);
      if (opener && opener !== document.body && document.contains(opener) && opener.focus) opener.focus();
      _overlayKeydowns.delete(id);
    }
  }

  function openModal(html, afterMount, extraClass) {
    $('#modal-box').className = 'modal' + (extraClass ? ' ' + extraClass : '');
    $('#modal-box').innerHTML = html;
    showOverlay('#modal-overlay');
    afterMount && afterMount();
  }
  function closeModal() { hideOverlay('#modal-overlay'); }

  /* ============ CUSTOM CONFIRM / PROMPT / ALERT ============
     Native confirm()/prompt()/alert() block the extension's background services
     in Firefox, so every call site drives these styled dialogs instead. They
     reuse the generic #modal-overlay and resolve as promises:
     uiConfirm -> boolean, uiPrompt -> string | null, uiAlert -> undefined. */
  function openDialog(opts) {
    return new Promise((resolve) => {
      let settled = false;
      const hasInput = opts.inputValue !== undefined;
      const hasCancel = opts.cancelLabel !== null && !(opts.okOnly);
      const html = `
        ${opts.title ? `<h2>${escapeHtml(opts.title)}</h2>` : ''}
        ${opts.message ? `<p class="dialog-message">${escapeHtml(opts.message)}</p>` : ''}
        ${opts.details ? `<div class="dialog-details">${escapeHtml(opts.details)}</div>` : ''}
        ${hasInput ? `<div class="field">${opts.label ? `<label for="dialog-input">${escapeHtml(opts.label)}</label>` : ''}<input type="text" id="dialog-input" value="${escapeHtml(opts.inputValue)}" placeholder="${escapeHtml(opts.placeholder || '')}"></div>` : ''}
        <div class="modal-actions">
          ${hasCancel ? `<button type="button" class="mini-btn" id="dialog-cancel">${escapeHtml(opts.cancelLabel || 'Cancel')}</button>` : ''}
          <button type="button" class="mini-btn${opts.danger ? ' danger' : ''}" id="dialog-ok">${escapeHtml(opts.okLabel || 'OK')}</button>
        </div>`;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        registerOverlayCloser('modal-overlay', closeModal);
        hideOverlay('#modal-overlay');
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') finish(hasInput ? null : false); };
      $('#modal-box').className = 'modal';
      $('#modal-box').innerHTML = html;
      registerOverlayCloser('modal-overlay', () => finish(hasInput ? null : false));
      showOverlay('#modal-overlay');
      const okBtn = $('#dialog-ok');
      okBtn.onclick = () => finish(hasInput ? $('#dialog-input').value : (opts.okOnly ? undefined : true));
      if (hasInput) {
        const input = $('#dialog-input');
        input.focus(); input.select();
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } });
      } else {
        okBtn.focus();
      }
      if (hasCancel) $('#dialog-cancel').onclick = () => finish(hasInput ? null : false);
      document.addEventListener('keydown', onKey, true);
    });
  }
  function uiConfirm(message, opts) { return openDialog(Object.assign({ title: 'Are you sure?', message, okLabel: 'OK' }, opts || {})); }
  function uiPrompt(message, inputValue, opts) {
    const o = opts || {};
    return openDialog({
      title: o.title !== undefined ? o.title : (message || 'Enter a value'),
      okLabel: o.okLabel || 'Save',
      cancelLabel: o.cancelLabel !== undefined ? o.cancelLabel : 'Cancel',
      message: o.message, // optional helper text under the heading (default: none)
      details: o.details,
      placeholder: o.placeholder,
      label: o.label,
      danger: o.danger,
      inputValue
    });
  }
  function uiAlert(message, opts) { return openDialog(Object.assign({ message, okLabel: 'OK', okOnly: true }, (opts || {}))); }

  /* Searchable item picker: filter box + click/arrow-key-selectable list.
     uiSearchablePicker(title, message, items[], opts) -> picked item id | null.
     items: [{ id, label }]. */
  function uiSearchablePicker(title, message, items, opts) {
    return new Promise((resolve) => {
      let settled = false;
      let query = '';
      let highlight = 0;
      const o = opts || {};
      const finish = (val) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onEscapeCapture, true);
        registerOverlayCloser('modal-overlay', closeModal);
        hideOverlay('#modal-overlay');
        resolve(val);
      };
      const onEscapeCapture = (e) => { if (e.key === 'Escape') finish(null); };
      $('#modal-box').className = 'modal';
      $('#modal-box').innerHTML = `
        ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}
        ${message ? `<p class="dialog-message">${escapeHtml(message)}</p>` : ''}
        <div class="field"><input type="text" id="dialog-filter" class="filter-input" placeholder="${escapeHtml(o.placeholder || 'Search…')}" value="${escapeHtml(query)}" autocomplete="off"></div>
        <div class="picker-list" id="dialog-picker-list"></div>
        <div class="modal-actions">
          <button type="button" class="mini-btn" id="dialog-cancel">${escapeHtml(o.cancelLabel || 'Cancel')}</button>
          <button type="button" class="mini-btn" id="dialog-ok">${escapeHtml(o.okLabel || 'OK')}</button>
        </div>`;
      const listEl = $('#dialog-picker-list');
      const filterEl = $('#dialog-filter');
      const render = () => {
        const q = query.trim().toLowerCase();
        const shown = items.filter((it) => !q || it.label.toLowerCase().includes(q));
        if (!shown.length) { listEl.innerHTML = '<div class="picker-empty">No matches</div>'; highlight = -1; return; }
        highlight = Math.max(0, Math.min(highlight, shown.length - 1));
        listEl.innerHTML = shown.map((it, i) =>
          `<button type="button" class="picker-row${i === highlight ? ' active' : ''}" data-id="${escapeHtml(it.id)}"><span class="picker-ic">${ICONS.layers}</span><span class="picker-label">${escapeHtml(it.label)}</span></button>`
        ).join('');
        listEl.querySelectorAll('.picker-row').forEach((row) => { row.onclick = () => finish(row.dataset.id); });
        listEl.scrollTop = 0;
      };
      const move = () => {
        const rows = listEl.querySelectorAll('.picker-row');
        if (rows.length) rows[highlight].click();
      };
      const onNav = (e) => {
        const rows = listEl.querySelectorAll('.picker-row');
        if (!rows.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight = (highlight + 1) % rows.length; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight = (highlight - 1 + rows.length) % rows.length; }
        else if (e.key === 'Enter') { e.preventDefault(); rows[highlight].click(); return; }
        else return;
        rows.forEach((r, i) => r.classList.toggle('active', i === highlight));
      };
      filterEl.addEventListener('input', () => { query = filterEl.value; highlight = 0; render(); });
      filterEl.addEventListener('keydown', onNav);
      listEl.addEventListener('keydown', onNav);
      $('#dialog-cancel').onclick = () => finish(null);
      $('#dialog-ok').onclick = () => move();
      registerOverlayCloser('modal-overlay', () => finish(null));
      showOverlay('#modal-overlay');
      render();
      filterEl.focus();
      document.addEventListener('keydown', onEscapeCapture, true);
    });
  }

  function openPalette() {
    showOverlay('#palette-overlay');
    const input = $('#palette-input');
    input.value = ''; input.focus();
    resetPaletteNav();
    renderPaletteResults('');
  }
  function closePalette() { endThemePreview(); hideOverlay('#palette-overlay'); }

  /* Registry of every user-facing setting so the command palette can expose
     them all: each setting becomes a "cycle" command plus one command per
     option. `set(value)` returns a settings patch; `get(s)` reads the current
     value. Adding a new setting here automatically makes it palette-driven. */
  const PALETTE_SETTINGS = [
    { id: 'density', label: 'Density', get: s => s.density, set: v => ({ density: v }), options: [
      { label: 'Comfortable', value: 'comfortable' }, { label: 'Compact', value: 'compact' } ] },
    { id: 'radius', label: 'Corner radius', get: s => s.radius || 'default', set: v => ({ radius: v }), options: [
      { label: 'None', value: 'none' }, { label: 'Sharp', value: 'sharp' }, { label: 'Standard', value: 'default' }, { label: 'Rounded', value: 'rounded' }, { label: 'Extra', value: 'extra' } ] },
    { id: 'borders', label: 'Borders', get: s => s.borders !== false, set: v => ({ borders: v }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'popupBlur', label: 'Blur behind popups', get: s => s.popupBlur !== false, set: v => ({ popupBlur: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'viewMode', label: 'Bookmark view', get: s => s.viewMode, set: v => ({ viewMode: v }), options: [
      { label: 'Tiles', value: 'grid' }, { label: 'Rows', value: 'list' } ] },
    { id: 'columns', label: 'Board width', get: s => (s.dashboard && s.dashboard.columns) || 4, set: v => ({ dashboard: { columns: v } }), options: [
      { label: '3 columns', value: 3 }, { label: '4 columns', value: 4 }, { label: '5 columns', value: 5 }, { label: '6 columns', value: 6 } ] },
    { id: 'sidebarCollapsed', label: 'Sidebar collapsed', get: s => !!s.sidebarCollapsed, set: v => ({ sidebarCollapsed: v }), options: [
      { label: 'Expanded', value: false }, { label: 'Collapsed', value: true } ] },
    { id: 'sidebarCompact', label: 'Sidebar compact', get: s => !!s.sidebarCompact, set: v => ({ sidebarCompact: v }), options: [
      { label: 'Off', value: false }, { label: 'Icons only', value: true } ] },
    { id: 'showTabAudio', label: 'Show tab audio controls', get: s => !(s.tabsList && s.tabsList.showTabAudio === false), set: v => ({ tabsList: { showTabAudio: v } }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'animations', label: 'Animations', get: s => s.animations !== false, set: v => ({ animations: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'confirmDelete', label: 'Confirm before delete', get: s => s.confirmDelete !== false, set: v => ({ confirmDelete: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'openBookmarksInNewTab', label: 'Open bookmarks in new tab', get: s => !!s.openBookmarksInNewTab, set: v => ({ openBookmarksInNewTab: v }), options: [
      { label: 'Off (same tab)', value: false }, { label: 'On (new tab)', value: true } ] },
    { id: 'searchEngine', label: 'Web search engine', get: s => s.searchEngine || 'google', set: v => ({ searchEngine: v }), options: [
      { label: 'Google', value: 'google' }, { label: 'DuckDuckGo', value: 'duckduckgo' }, { label: 'Bing', value: 'bing' } ] },
    { id: 'faviconSource', label: 'Favicon source', get: s => s.faviconSource, set: v => ({ faviconSource: v }), options: [
      { label: 'Google', value: 'google' }, { label: 'DuckDuckGo', value: 'duckduckgo' }, { label: 'None', value: 'none' } ] },
    { id: 'groupPinned', label: 'Group pinned tabs', get: s => !(s.tabsList && s.tabsList.groupPinned === false), set: v => ({ tabsList: { groupPinned: v } }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'dimInactive', label: 'Dim unloaded tabs', get: s => !(s.tabsList && s.tabsList.dimInactive === false), set: v => ({ tabsList: { dimInactive: v } }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'inactiveGrayscale', label: 'Grayscale unloaded tabs', get: s => !(s.tabsList && s.tabsList.inactiveGrayscale === false), set: v => ({ tabsList: { inactiveGrayscale: v } }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'inactiveOpacity', label: 'Inactive tab opacity', get: s => (s.tabsList && s.tabsList.inactiveOpacity) ?? 55, set: v => ({ tabsList: { inactiveOpacity: v } }), options: [
      { label: 'Faint (35%)', value: 35 }, { label: 'Dim (55%)', value: 55 }, { label: 'Subtle (75%)', value: 75 }, { label: 'Off (100%)', value: 100 } ] },
    { id: 'clockFormat', label: 'Clock widget format', get: s => s.clockFormat || '24', set: v => ({ clockFormat: v }), options: [
      { label: '24-hour', value: '24' }, { label: '12-hour', value: '12' } ] },
    { id: 'weatherUnits', label: 'Weather units', get: s => s.weatherUnits || 'c', set: v => ({ weatherUnits: v }), options: [
      { label: 'Celsius', value: 'c' }, { label: 'Fahrenheit', value: 'f' } ] },
    { id: 'pomodoroFocus', label: 'Pomodoro focus (min)', get: s => s.pomodoroFocus || 25, set: v => ({ pomodoroFocus: v }), options: [
      { label: '15 min', value: 15 }, { label: '20 min', value: 20 }, { label: '25 min', value: 25 }, { label: '30 min', value: 30 }, { label: '45 min', value: 45 } ] },
    { id: 'pomodoroBreak', label: 'Pomodoro break (min)', get: s => s.pomodoroBreak || 5, set: v => ({ pomodoroBreak: v }), options: [
      { label: '5 min', value: 5 }, { label: '10 min', value: 10 }, { label: '15 min', value: 15 }, { label: '20 min', value: 20 } ] },
    { id: 'countdownDays', label: 'Countdown default (days)', get: s => s.countdownDays || 7, set: v => ({ countdownDays: v }), options: [
      { label: '7 days', value: 7 }, { label: '14 days', value: 14 }, { label: '30 days', value: 30 }, { label: '60 days', value: 60 } ] },
    { id: 'rssRefreshInterval', label: 'RSS auto-refresh', get: s => s.rssRefreshInterval || 0, set: v => ({ rssRefreshInterval: v }), options: [
      { label: 'Off', value: 0 }, { label: 'Every 15 min', value: 15 }, { label: 'Every 30 min', value: 30 }, { label: 'Every 60 min', value: 60 } ] },
    { id: 'confirmRestoreSession', label: 'Confirm before restoring session', get: s => s.confirmRestoreSession === true, set: v => ({ confirmRestoreSession: v }), options: [
      { label: 'Off', value: false }, { label: 'On', value: true } ] },
    { id: 'showTopbarSearch', label: 'Topbar search bar', get: s => s.showTopbarSearch !== false, set: v => ({ showTopbarSearch: v }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'showShortcutsButton', label: 'Shortcuts button', get: s => s.showShortcutsButton !== false, set: v => ({ showShortcutsButton: v }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'showTrashButton', label: 'Trash button', get: s => s.showTrashButton !== false, set: v => ({ showTrashButton: v }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'fontSize', label: 'Interface font size', get: s => s.interfaceFontSize || 100, set: v => ({ interfaceFontSize: v }), options: [
      { label: 'Small', value: 92 }, { label: 'Normal', value: 100 }, { label: 'Large', value: 109 }, { label: 'X-Large', value: 118 } ] },
    { id: 'recentlyClosedLimit', label: 'Recently closed tabs shown', get: s => s.recentlyClosedLimit || 0, set: v => ({ recentlyClosedLimit: v }), options: [
      { label: 'All', value: 0 }, { label: '5', value: 5 }, { label: '10', value: 10 }, { label: '20', value: 20 }, { label: '40', value: 40 } ] },
    { id: 'historyShowTimes', label: 'Show visit time in History widgets', get: s => s.historyShowTimes !== false, set: v => ({ historyShowTimes: v }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'historyCount', label: 'History tabs shown per widget', get: s => s.historyCount || 10, set: v => ({ historyCount: v }), options: [
      { label: '5', value: 5 }, { label: '10', value: 10 }, { label: '20', value: 20 }, { label: '40', value: 40 } ] },
    { id: 'topSitesCount', label: 'Most visited sites shown per widget', get: s => s.topSitesCount || 12, set: v => ({ topSitesCount: v }), options: [
      { label: '6', value: 6 }, { label: '12', value: 12 }, { label: '24', value: 24 }, { label: '48', value: 48 } ] },
    { id: 'trashRetentionDays', label: 'Keep deleted bookmarks for', get: s => s.trashRetentionDays || 0, set: v => ({ trashRetentionDays: v }), options: [
      { label: 'Forever', value: 0 }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 } ] }
  ];
  const PALETTE_SETTINGS_BY_ID = Object.fromEntries(PALETTE_SETTINGS.map(d => [d.id, d]));

  /* The palette is a navigable tree: root → Themes / Settings groups → options.
     Searching flattens every leaf so "change anything by typing" still works. */
  const PALETTE_SETTING_GROUPS = [
    { name: 'Appearance', keys: ['density', 'radius', 'borders', 'animations', 'popupBlur', 'fontSize'] },
    { name: 'Layout', keys: ['viewMode', 'columns', 'showTopbarSearch', 'showShortcutsButton', 'showTrashButton'] },
    { name: 'Sidebar', keys: ['sidebarCollapsed', 'sidebarCompact', 'showTabAudio', 'groupPinned', 'dimInactive', 'inactiveGrayscale', 'inactiveOpacity', 'recentlyClosedLimit'] },
    { name: 'Behavior', keys: ['confirmDelete', 'openBookmarksInNewTab', 'faviconSource', 'searchEngine', 'confirmRestoreSession'] },
    { name: 'Widgets', keys: ['clockFormat', 'weatherUnits', 'pomodoroFocus', 'pomodoroBreak', 'countdownDays', 'rssRefreshInterval', 'historyShowTimes', 'historyCount', 'topSitesCount'] },
    { name: 'Data', keys: ['trashRetentionDays'] }
  ];

  function themeChipColors(t) { return [t.bg, t.main, t.caret, t.sub, t.subAlt, t.text]; }

  function paletteThemeItems() {
    const s = STATE.meta.settings;
    const cur = s.themeId;
    const light = Themes.resolveTheme('auto', s.lightThemeId, undefined);
    const dark = Themes.resolveTheme('auto', undefined, s.darkThemeId);
    const items = [{
      kind: 'theme', label: 'Auto (follow system)', themeId: 'auto',
      chips: [light.bg, light.main, light.text, dark.bg, dark.main, dark.text],
      value: cur === 'auto' ? 'Active' : '', run: () => selectTheme('auto')
    }];
    Themes.PRESET_THEMES.forEach(t => {
      items.push({
        kind: 'theme', label: t.name, themeId: t.id, chips: themeChipColors(t),
        value: cur === t.id ? 'Active' : '', run: () => selectTheme(t.id)
      });
    });
    return items;
  }

  function paletteSettingOptions(def) {
    const s = STATE.meta.settings;
    const cur = def.get(s);
    return def.options.map(o => ({
      kind: 'setting', label: o.label, value: o.value === cur ? 'Active' : '', select: true,
      run: async () => { await DB.updateSettings(def.set(o.value)); }
    }));
  }

  function paletteSettingItem(def) {
    const s = STATE.meta.settings;
    const cur = def.get(s);
    const idx = def.options.findIndex(o => o.value === cur);
    return {
      kind: 'folder', label: def.label, value: idx >= 0 ? def.options[idx].label : String(cur),
      children: paletteSettingOptions(def)
    };
  }

  function paletteRootItems() {
    const cmds = [
      { kind: 'action', label: 'New Collection', run: () => openCollectionModal() },
      { kind: 'action', label: 'Add Notes widget', run: () => addWidget('notes') },
      { kind: 'action', label: 'Add To-Do widget', run: () => addWidget('todo') },
      { kind: 'action', label: 'Add Clock widget', run: () => addWidget('clock') },
      { kind: 'action', label: 'Add Search widget', run: () => addWidget('search') },
      { kind: 'action', label: 'Add Countdown widget', run: () => addWidget('countdown') },
      { kind: 'action', label: 'Add Pomodoro widget', run: () => addWidget('pomodoro') },
      { kind: 'action', label: 'Add Timer widget', run: () => addWidget('timer') },
      { kind: 'action', label: 'Add Stopwatch widget', run: () => addWidget('stopwatch') },
      { kind: 'action', label: 'Add Weather widget', run: () => addWidget('weather') },
      { kind: 'action', label: 'Add RSS feeds widget', run: () => addWidget('rss') },
      { kind: 'action', label: 'Create Most visited collection', run: () => addWidget('topSites') },
      { kind: 'action', label: 'Add Recent downloads widget', run: () => addWidget('downloads') },
      { kind: 'action', label: 'Create History collection', run: () => addWidget('history') },
      { kind: 'action', label: 'Search the web…', run: searchTheWeb },
      { kind: 'action', label: 'Import browser bookmarks…', run: importBrowserBookmarksViaFilePicker },
      { kind: 'action', label: 'New Workspace', run: () => openWorkspaceModal() },
      { kind: 'action', label: 'New Board', run: () => newBoardFromPalette() },
      { kind: 'action', label: 'Save current tabs as session', run: saveWindowSession },
      { kind: 'action', label: 'Open Settings', run: openSettings },
      { kind: 'action', label: 'Open Trash', run: () => openTrashPanel() },
      { kind: 'action', label: 'Show keyboard shortcuts', run: openShortcuts },
      { kind: 'action', label: 'Toggle sidebar', run: toggleSidebar },
      { kind: 'action', label: 'Toggle grid / list view', run: toggleViewMode },
      { kind: 'action', label: 'Go to Collections', run: () => switchNav('collections') },
      { kind: 'action', label: 'Go to Sessions', run: () => switchNav('sessions') }
    ];
    Object.values(STATE.workspaces).sort((a, b) => a.order - b.order).forEach(ws => {
      cmds.push({ kind: 'action', label: `Go to workspace · ${ws.name}`, run: () => jumpToWorkspace(ws.id) });
    });
    boardsForActiveWS().forEach(board => {
      cmds.push({ kind: 'action', label: `Go to board · ${board.name}`, run: () => jumpToBoard(board.id) });
    });
    cmds.push(
      { kind: 'folder', label: 'Themes', children: paletteThemeItems() },
      { kind: 'folder', label: 'Settings', children: PALETTE_SETTING_GROUPS.map(g => ({
        kind: 'folder', label: g.name, children: g.keys.map(k => paletteSettingItem(PALETTE_SETTINGS_BY_ID[k]))
      })) }
    );
    return cmds;
  }

  /* ---------- Palette navigation (tree) ---------- */
  let palNav = [];           // stack of { title, items } — empty = root level
  function paletteLevel() { return palNav.length ? palNav[palNav.length - 1].items : paletteRootItems(); }

  function paletteCrumbHtml() {
    if (palNav.length === 0) return '';
    const trail = palNav.map((n, i) => `<span class="crumb-seg" data-i="${i}">${escapeHtml(n.title)}</span>`).join('<span class="crumb-sep">›</span>');
    return `<span class="crumb-seg" data-i="-1">All</span><span class="crumb-sep">›</span>${trail}`;
  }

  function renderPaletteCrumb() {
    const crumb = $('#palette-crumb');
    if (!$('#palette-input').value.trim() && palNav.length) {
      crumb.classList.remove('hidden');
      crumb.innerHTML = paletteCrumbHtml();
      $$('.crumb-seg[data-i]', crumb).forEach(c => c.onclick = () => {
        palNav.length = parseInt(c.dataset.i, 10) + 1;
        paletteIndex = 0;
        renderPaletteResults('');
      });
    } else {
      crumb.classList.add('hidden');
    }
  }

  function pushPaletteNav(folder) {
    palNav.push({ title: folder.label, items: folder.children || [] });
    $('#palette-input').value = '';
    paletteIndex = 0;
    renderPaletteResults('');
  }
  function popPaletteNav() {
    if (!palNav.length) return false;
    palNav.pop();
    paletteIndex = 0;
    renderPaletteResults('');
    return true;
  }
  function resetPaletteNav() { palNav = []; paletteIndex = 0; }

  async function selectTheme(themeId) {
    commitThemePreview();
    await DB.updateSettings({ themeId });
  }

  async function newBoardFromPalette() {
    const name = await uiPrompt('New board name', `Board ${boardsForActiveWS().length + 1}`, { okLabel: 'Create', label: 'Name', placeholder: 'Board name' });
    if (!name) return;
    const created = await DB.createBoard(activeWorkspaceId(), name);
    await DB.setActiveBoard(activeWorkspaceId(), created.id);
    await reload();
  }
  async function jumpToWorkspace(wsId) {
    await DB.setActiveWorkspace(wsId);
    await reload();
  }
  async function jumpToBoard(boardId) {
    if (boardsForActiveWS().some(b => b.id === boardId)) {
      await DB.setActiveBoard(activeWorkspaceId(), boardId);
      await reload();
    }
  }


  let paletteItems = [];
  let paletteIndex = 0;
  let paletteWheelAt = 0;
  let paletteXPrimed = false;

  function scrollPaletteActiveIntoView() {
    const active = $$('.palette-item')[paletteIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function paletteStageEscape() {
    if ($('.palette-item.active')) {
      endThemePreview();
      $$('.palette-item').forEach(r => r.classList.remove('active'));
      highlightPalette($$('.palette-item'), -1);
      return true;
    }
    closePalette();
    return false;
  }

  function renderPaletteResults(query) {
    const results = $('#palette-results');
    results.innerHTML = '';
    const q = query.trim();

    let all;
    if (q) {
      // Search filters only the current level — at the root that surfaces
      // group options like Themes/Settings, not a flattened "public search".
      const scored = [];
      for (const c of paletteLevel()) {
        const m = fuzzyMatch(q, c.label);
        if (!m) continue;
        scored.push({ ...c, match: m, score: m.score + (c.children ? 3 : 0) });
      }
      // The palette promises "jump to a bookmark", so surface matching
      // bookmarks from every collection (title and URL both count).
      // Deduplicated by full URL so the same link never shows twice.
      const seenUrls = new Set();
      Object.values(STATE.bookmarks).forEach(bm => {
        const urlKey = bm.url.trim().toLowerCase();
        if (!urlKey || seenUrls.has(urlKey)) return;
        seenUrls.add(urlKey);
        const mt = fuzzyMatch(q, bm.title || '');
        const mu = fuzzyMatch(q, bm.url || '');
        const m = mt && mu ? (mt.score >= mu.score ? mt : mu) : (mt || mu);
        if (!m) return;
        scored.push({
          kind: 'bookmark',
          label: bm.title || bm.url,
          favicon: bm.favicon || '',
          swatch: bm.tintColor || undefined,
          run: () => openBookmarkUrl(bm),
          match: m,
          score: m.score
        });
      });
      // And open tabs, so the palette can double as a tab switcher.
      const seenTabIds = new Set();
      OPEN_TABS.forEach(t => {
        if (seenTabIds.has(t.id)) return;
        seenTabIds.add(t.id);
        const m = fuzzyMatch(q, t.title || t.url) || fuzzyMatch(q, t.url || '');
        if (!m) return;
        scored.push({
          kind: 'tab',
          label: t.title || t.url,
          favicon: t.favIconUrl || '',
          run: () => sendMsg('FOCUS_TAB', { tabId: t.id }),
          match: m,
          score: m.score
        });
      });
      scored.sort((a, b) => b.score - a.score);
      all = scored.slice(0, 24);
    } else {
      // Browse mode: render the current tree level (+ a few open tabs at root).
      const level = paletteLevel();
      all = [...level];
      if (!palNav.length) {
        OPEN_TABS.slice(0, 5).forEach(t => all.push({ kind: 'tab', label: t.title || t.url, run: () => sendMsg('FOCUS_TAB', { tabId: t.id }) }));
      }
    }
    renderPaletteCrumb();

    if (!all.length) { paletteItems = []; results.appendChild(el('div', 'palette-empty', 'No matches')); return; }

    paletteItems = all;
    paletteIndex = Math.min(paletteIndex, all.length - 1);
    all.forEach((item, i) => {
      const row = el('div', 'palette-item' + (i === paletteIndex ? ' active' : ''));
      const visual = item.favicon
        ? `<img class="pi-fav" src="${item.favicon}" onerror="this.style.display='none'">`
        : item.chips
        ? `<span class="pi-chips">${item.chips.map(c => `<span class="pi-chip" style="background:${c}"></span>`).join('')}</span>`
        : (item.swatch ? `<span class="pi-swatch" style="background:${item.swatch}"></span>` : '');
      const folderCaret = item.children ? `<span class="pi-caret">›</span>` : '';
      const value = item.value ? `<span class="pi-val">${escapeHtml(item.value)}</span>` : '';
      row.innerHTML = `${visual}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${highlightLabel(item.label, item.match && item.match.indices)}</span><span class="pi-kind">${item.children ? 'group' : item.kind}</span>${value}${folderCaret}`;
      row.onmouseenter = () => {
        if (Date.now() - paletteWheelAt < 220) return;
        paletteIndex = i;
        highlightPalette($$('.palette-item'), i);
        if (item.kind === 'theme') previewTheme(item.themeId);
      };
      row.onclick = () => activatePaletteItem(item);
      results.appendChild(row);
    });
    highlightPalette($$('.palette-item'), paletteIndex);
  }

  function activatePaletteItem(item) {
    if (item.children || item.kind === 'folder') { pushPaletteNav(item); return; }
    runPaletteItem(item);
  }

  async function runPaletteItem(item) {
    if (item.kind === 'theme') commitThemePreview();
    await item.run();
    if (item.select) {
      STATE = await DB.getState(); // reflect the new value before re-rendering
      renderPaletteResults($('#palette-input').value);
    } else {
      closePalette();
    }
  }
