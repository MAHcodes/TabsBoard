  /* Command palette + modal overlay plumbing. Shared with the other newtab
   modules through the page's single global scope (old-school classic-script
   composition — see index.html, loaded after common/). The purely-functional
   matcher/highlighter and the tree flatten/rank/section helpers live in
   common/search.js under SearchUtils (unit-tested in tests/search.test.js). */
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
          ${hasCancel ? `<button type="button" class="mini-btn" id="dialog-cancel" title="Cancel (Esc)">${escapeHtml(opts.cancelLabel || 'Cancel')}</button>` : ''}
          <button type="button" class="mini-btn${opts.danger ? ' danger' : ''}" id="dialog-ok" title="${escapeHtml(opts.okLabel || 'OK')} (Enter)">${escapeHtml(opts.okLabel || 'OK')}</button>
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
          <button type="button" class="mini-btn" id="dialog-cancel" title="Cancel (Esc)">${escapeHtml(o.cancelLabel || 'Cancel')}</button>
          <button type="button" class="mini-btn" id="dialog-ok" title="${escapeHtml(o.okLabel || 'OK')} (Enter)">${escapeHtml(o.okLabel || 'OK')}</button>
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

  /* ============ COMMAND PALETTE ============
     A navigable tree (root → Themes / Settings / Add widget → options) that
     also flattens into one searchable list: typing at the root finds commands,
     groups, themes, individual setting values, bookmarks and open tabs, with
     section headings. Typing inside a group searches just that group.
     Folders are lazy (`children` may be a function) so check marks and values
     are always read fresh from STATE instead of from a stale snapshot. */
  let paletteItems = [];        // items currently rendered, in row order
  let paletteIndex = 0;         // active row
  let paletteUserMoved = false; // true once the user arrowed/hovered: only then do theme rows live-preview
  let palNav = [];              // folder stack: { folder, title, parentIndex } — empty = root
  let paletteLastMouse = null;

  function openPalette() {
    palNav = []; paletteIndex = 0; paletteUserMoved = false;
    showOverlay('#palette-overlay');
    const input = $('#palette-input');
    input.value = ''; input.focus();
    renderPaletteResults('');
  }
  function closePalette() { endThemePreview(); hideOverlay('#palette-overlay'); }
  function togglePalette() {
    if ($('#palette-overlay').classList.contains('hidden')) openPalette(); else closePalette();
  }

  /* Registry of every user-facing setting so the command palette can expose
     them all: each setting becomes a "cycle" command plus one command per
     option. `set(value)` returns a settings patch; `get(s)` reads the current
     value. Adding a new setting here automatically makes it palette-driven. */
  /* Notification preferences live in the nested settings.notifications group
     (NOTIFICATION_DEFAULTS in storage.js), so their get/set need a small shim. */
  const notifSetting = (id, label, options, keywords) => ({
    id, label, keywords,
    get: s => DB.notificationSettings(s)[id],
    set: v => ({ notifications: { [id]: v } }),
    options
  });
  const PALETTE_ON_OFF = [{ label: 'On', value: true }, { label: 'Off', value: false }];
  const PALETTE_SETTINGS = [
    { id: 'boardMode', label: 'Board view', keywords: 'grid canvas free-form freeform split list detail mail layout drag snap', get: s => s.boardMode || 'grid', set: v => ({ boardMode: v }), options: [
      { label: 'Grid', value: 'grid' }, { label: 'Free-form canvas', value: 'canvas' }, { label: 'Split view', value: 'split' } ] },
    { id: 'density', label: 'Density', get: s => s.density, set: v => ({ density: v }), options: [
      { label: 'Spacious', value: 'spacious' }, { label: 'Comfortable', value: 'comfortable' },
      { label: 'Compact', value: 'compact' }, { label: 'Dense', value: 'dense' } ] },
    { id: 'radius', label: 'Corner radius', get: s => s.radius || 'default', set: v => ({ radius: v }), options: [
      { label: 'None', value: 'none' }, { label: 'Sharp', value: 'sharp' }, { label: 'Standard', value: 'default' }, { label: 'Rounded', value: 'rounded' }, { label: 'Extra', value: 'extra' } ] },
    { id: 'borders', label: 'Borders', get: s => s.borders !== false, set: v => ({ borders: v }), options: [
      { label: 'Show', value: true }, { label: 'Hide', value: false } ] },
    { id: 'floatingBars', label: 'Floating bars', get: s => !!s.floatingBars, set: v => ({ floatingBars: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'popupBlur', label: 'Blur behind popups', get: s => s.popupBlur !== false, set: v => ({ popupBlur: v }), options: [
      { label: 'On', value: true }, { label: 'Off', value: false } ] },
    { id: 'viewMode', label: 'Bookmark style', get: s => s.viewMode, set: v => ({ viewMode: v }), options: [
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
      { label: 'Forever', value: 0 }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 } ] },

    notifSetting('toastLevel', 'Show notifications', [
      { label: 'All', value: 'all' }, { label: 'Important only', value: 'important' },
      { label: 'Errors only', value: 'errors' }, { label: 'Off', value: 'off' } ], 'toast in-app level'),
    notifSetting('toastPosition', 'Notification position', [
      { label: 'Top left', value: 'top-left' }, { label: 'Top center', value: 'top-center' }, { label: 'Top right', value: 'top-right' },
      { label: 'Bottom left', value: 'bottom-left' }, { label: 'Bottom center', value: 'bottom-center' }, { label: 'Bottom right', value: 'bottom-right' } ], 'toast corner place'),
    notifSetting('toastSize', 'Notification size', [
      { label: 'Small', value: 'small' }, { label: 'Normal', value: 'normal' }, { label: 'Large', value: 'large' } ], 'toast'),
    notifSetting('toastDuration', 'Notification stay on screen for', [
      { label: 'Automatic', value: 0 }, { label: '3 s', value: 3000 }, { label: '5 s', value: 5000 },
      { label: '8 s', value: 8000 }, { label: '15 s', value: 15000 }, { label: 'Until dismissed', value: -1 } ], 'toast timeout duration'),
    notifSetting('toastMax', 'Notifications shown at most', [
      { label: '1', value: 1 }, { label: '2', value: 2 }, { label: '4', value: 4 }, { label: '6', value: 6 }, { label: '8', value: 8 } ], 'toast count limit stack'),
    notifSetting('toastProgress', 'Notification countdown bar', PALETTE_ON_OFF, 'toast progress timer'),
    notifSetting('toastIcons', 'Notification status icons', PALETTE_ON_OFF, 'toast success warning error icon'),
    notifSetting('toastPauseOnHover', 'Pause notifications on hover', PALETTE_ON_OFF, 'toast timer hover'),
    notifSetting('toastGroupDuplicates', 'Group repeated notifications', PALETTE_ON_OFF, 'toast duplicate stack count'),

    notifSetting('browserEnabled', 'Browser notifications', PALETTE_ON_OFF, 'system desktop master'),
    notifSetting('browserSelectionSaved', 'Browser notification: selection saved', PALETTE_ON_OFF, 'system desktop context menu note'),
    notifSetting('browserTimeout', 'Browser notification stay on screen for', [
      { label: 'Browser default', value: 0 }, { label: '5 s', value: 5 }, { label: '10 s', value: 10 }, { label: 'Until dismissed', value: -1 } ], 'system desktop timeout duration'),
    notifSetting('browserSilent', 'Silent browser notifications', PALETTE_ON_OFF, 'system desktop sound'),

    notifSetting('pomodoroEnabled', 'Pomodoro notifications', PALETTE_ON_OFF, 'timer focus break master'),
    notifSetting('pomodoroOnFocusEnd', 'Pomodoro notification when focus ends', PALETTE_ON_OFF, 'timer focus break'),
    notifSetting('pomodoroOnBreakEnd', 'Pomodoro notification when break ends', PALETTE_ON_OFF, 'timer focus break'),
    notifSetting('pomodoroSound', 'Pomodoro notification sound', PALETTE_ON_OFF, 'timer focus break audio')
  ];
  const PALETTE_SETTINGS_BY_ID = Object.fromEntries(PALETTE_SETTINGS.map(d => [d.id, d]));

  /* The Settings folder: groups → settings → options. */
  const PALETTE_SETTING_GROUPS = [
    { name: 'Appearance', icon: 'palette', keys: ['density', 'radius', 'borders', 'floatingBars', 'animations', 'popupBlur', 'fontSize'] },
    { name: 'Board', icon: 'columns', keys: ['boardMode', 'columns', 'viewMode'] },
    { name: 'Navigation', icon: 'panelLeftClose', keys: ['showTopbarSearch', 'showShortcutsButton', 'showTrashButton', 'sidebarCollapsed', 'sidebarCompact', 'showTabAudio', 'groupPinned', 'dimInactive', 'inactiveGrayscale', 'inactiveOpacity', 'recentlyClosedLimit'] },
    { name: 'Widgets', icon: 'widget', keys: ['clockFormat', 'weatherUnits', 'pomodoroFocus', 'pomodoroBreak', 'countdownDays', 'rssRefreshInterval', 'historyShowTimes', 'historyCount', 'topSitesCount'] },
    { name: 'Behavior', icon: 'target', keys: ['openBookmarksInNewTab', 'searchEngine', 'faviconSource', 'confirmDelete', 'confirmRestoreSession'] },
    { name: 'Notifications', icon: 'warn', keys: ['toastLevel', 'toastPosition', 'toastSize', 'toastDuration', 'toastMax', 'toastProgress', 'toastIcons', 'toastPauseOnHover', 'toastGroupDuplicates', 'browserEnabled', 'browserSelectionSaved', 'browserTimeout', 'browserSilent', 'pomodoroEnabled', 'pomodoroOnFocusEnd', 'pomodoroOnBreakEnd', 'pomodoroSound'] },
    { name: 'Data', icon: 'archive', keys: ['trashRetentionDays'] }
  ];

  /* label, widget type, icon — one table drives the "Add widget" group. */
  const PALETTE_WIDGETS = [
    ['Add Notes widget', 'notes', 'notes'], ['Add To-Do widget', 'todo', 'checkSquare'],
    ['Add Clock widget', 'clock', 'clock'], ['Add Search widget', 'search', 'search'],
    ['Add Countdown widget', 'countdown', 'hourglass'], ['Add Pomodoro widget', 'pomodoro', 'target'],
    ['Add Timer widget', 'timer', 'timer'], ['Add Stopwatch widget', 'stopwatch', 'stopwatch'],
    ['Add Weather widget', 'weather', 'cloudSun'], ['Add RSS feeds widget', 'rss', 'rss'],
    ['Create Most visited collection', 'topSites', 'globe'], ['Add Recent downloads widget', 'downloads', 'download'],
    ['Create History collection', 'history', 'rotateCcwClock']
  ];

  /* Which section heading each kind gets in search results. */
  const PALETTE_KIND_SECTION = { action: 'Commands', folder: 'Groups', theme: 'Themes', setting: 'Settings', bookmark: 'Bookmarks', tab: 'Tabs' };
  const PALETTE_SECTION_CAPS = { Commands: 8, Groups: 5, Themes: 6, Settings: 8, Bookmarks: 8, Tabs: 5 };

  /* Shared with the Settings theme grids (settings.js) through the global scope. */
  function themeChipColors(t) { return [t.bg, t.main, t.caret, t.sub, t.subAlt, t.text]; }

  function paletteSystemPrefersDark() {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function paletteThemeItems() {
    const s = DB.settingsOf(STATE);
    const cur = s.themeId;
    const custom = s.customThemes || [];
    // The Auto row previews the user's own light + dark picks. (It used to ask
    // resolveTheme('auto') for each, which only ever returns the slot matching
    // the *system* scheme — so one of the two chip sets was wrong.)
    const light = Themes.findTheme(s.lightThemeId, custom) || Themes.defaultTheme(false);
    const dark = Themes.findTheme(s.darkThemeId, custom) || Themes.defaultTheme(true);
    const mk = (t, heading) => ({
      kind: 'theme', heading, label: t.name, themeId: t.id, chips: themeChipColors(t),
      themeType: t.type, keywords: `${t.type} theme`, checked: cur === t.id,
      run: () => selectTheme(t.id)
    });
    const all = Themes.allThemes(custom);
    const items = [{
      kind: 'theme', heading: 'System', label: 'Auto (follow system)', themeId: 'auto',
      chips: [light.bg, light.main, light.text, dark.bg, dark.main, dark.text],
      hint: 'light + dark', keywords: 'system automatic theme', checked: cur === 'auto',
      run: () => selectTheme('auto')
    }];
    items.push({
      kind: 'action', heading: 'Custom', icon: 'plus', label: 'Custom theme builder…',
      run: () => { openSettings(); openSettingsTab('themes'); openThemeBuilder(null); }
    });
    all.filter(t => t.custom).forEach(t => items.push(mk(t, 'Custom')));
    const order = paletteSystemPrefersDark() ? ['dark', 'light'] : ['light', 'dark'];
    order.forEach(type => {
      all.filter(t => !t.custom && t.type === type).forEach(t => items.push(mk(t, type === 'dark' ? 'Dark themes' : 'Light themes')));
    });
    return items;
  }

  function paletteSettingOptions(def) {
    const cur = def.get(DB.settingsOf(STATE));
    return def.options.map(o => ({
      kind: 'setting', label: o.label, checked: o.value === cur, select: true,
      run: async () => { await DB.updateSettings(def.set(o.value)); await reload(); }
    }));
  }

  function paletteSettingItem(def) {
    const cur = def.get(DB.settingsOf(STATE));
    const opt = def.options.find(o => o.value === cur);
    return {
      kind: 'folder', icon: 'settings', label: def.label, settingId: def.id,
      keywords: def.keywords,
      value: opt ? opt.label : String(cur),
      children: () => paletteSettingOptions(def)
    };
  }

  function paletteSettingsFolder() {
    return {
      kind: 'folder', heading: 'Customize', icon: 'settings', label: 'Settings', keywords: 'preferences options configure',
      children: () => PALETTE_SETTING_GROUPS.map(g => ({
        kind: 'folder', icon: g.icon, label: g.name,
        children: () => g.keys.map(k => paletteSettingItem(PALETTE_SETTINGS_BY_ID[k]))
      }))
    };
  }

  function paletteRootItems() {
    const s = DB.settingsOf(STATE);
    const curTheme = s.themeId === 'auto' ? { name: 'Auto' } : Themes.findTheme(s.themeId, s.customThemes);
    const act = (heading, icon, label, run, extra) => Object.assign({ kind: 'action', heading, icon, label, run }, extra || {});

    const items = [
      { kind: 'folder', heading: 'Customize', icon: 'palette', label: 'Themes', keywords: 'colors colours appearance dark light',
        value: curTheme ? curTheme.name : '', children: paletteThemeItems },
      paletteSettingsFolder(),

      act('Create', 'folder', 'New Collection', () => openCollectionModal()),
      { kind: 'folder', heading: 'Create', icon: 'widget', label: 'Add widget', keywords: 'new widgets',
        children: () => [
          ...PALETTE_WIDGETS.map(([label, type, ic]) => act(null, ic, label, () => addWidget(type))),
          ...pluginPaletteActions().map(a => Object.assign({ icon: 'widget' }, a))
        ] },
      act('Create', 'briefcase', 'New Workspace', () => openWorkspaceModal()),
      act('Create', 'layers', 'New Board', () => newBoardFromPalette()),
      act('Create', 'save', 'Save current tabs as session', saveWindowSession),
      act('Create', 'folderInput', 'Import browser bookmarks…', importBrowserBookmarksViaFilePicker),

      act('Navigate', 'folder', 'Go to Collections', () => switchNav('collections')),
      act('Navigate', 'clock', 'Go to Sessions', () => switchNav('sessions')),
      act('Navigate', 'settings', 'Open Settings', openSettings, { keywords: 'preferences options' }),
      act('Navigate', 'trash', 'Open Trash', () => openTrashPanel(), { keywords: 'deleted bin restore' }),
      act('Navigate', 'keyboard', 'Show keyboard shortcuts', openShortcuts, { keywords: 'keys hotkeys help' })
    ];
    Object.values(STATE.workspaces).sort((a, b) => a.order - b.order).forEach(ws => {
      items.push(act('Navigate', 'briefcase', `Go to workspace · ${ws.name}`, () => jumpToWorkspace(ws.id)));
    });
    boardsForActiveWS().forEach(board => {
      items.push(act('Navigate', 'layers', `Go to board · ${board.name}`, () => jumpToBoard(board.id)));
    });
    items.push(
      act('View', 'panelLeftClose', 'Toggle sidebar', toggleSidebar, { keywords: 'hide show tabs panel' }),
      act('View', 'grid', 'Toggle grid / list view', toggleViewMode, { keywords: 'tiles rows layout' }),
      act('View', 'search', 'Search the web…', searchTheWeb)
    );
    if (canvasActive(s)) items.push(act('View', 'wand', 'Auto-arrange canvas widgets', canvasAutoArrange, { keywords: 'tidy snap grid pack layout' }));
    return items;
  }

  /* ---------- Navigation (folder stack) ---------- */
  function paletteLevel() {
    return palNav.length ? SearchUtils.childrenOf(palNav[palNav.length - 1].folder) : paletteRootItems();
  }
  const paletteInput = () => $('#palette-input');

  function pushPaletteNav(folder) {
    // `folder.chain` (set on flattened search results) holds the folders above
    // it, so "Density" found by typing at the root opens as Settings › Appearance › Density.
    // The row to restore on Back is only meaningful when we were browsing: after a
    // search, the old index pointed into the *results* list.
    const returnTo = paletteInput().value.trim() ? 0 : paletteIndex;
    const entries = (folder.chain || []).map(f => ({ folder: f, title: f.label, parentIndex: 0 }));
    entries.push({ folder, title: folder.label, parentIndex: 0 });
    entries[0].parentIndex = returnTo;
    palNav = palNav.concat(entries);
    paletteInput().value = '';
    // Open on the current value (checked theme / option) rather than the top.
    paletteIndex = Math.max(0, paletteLevel().findIndex(i => i.checked));
    paletteUserMoved = false;
    renderPaletteResults('');
  }
  function popPaletteNav() {
    if (!palNav.length) return false;
    paletteIndex = palNav.pop().parentIndex || 0;
    paletteInput().value = '';
    paletteUserMoved = false;
    renderPaletteResults('');
    return true;
  }

  async function selectTheme(themeId) {
    commitThemePreview();
    await DB.updateSettings({ themeId });
    await reload();
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

  function searchHost(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  /* Typed text that isn't a command: offer to search the web / open it. */
  function paletteWebItem(q) {
    const looksLikeUrl = /^(https?:\/\/|www\.)\S+$/i.test(q) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q);
    return {
      kind: 'action', section: 'Web', icon: looksLikeUrl ? 'externalWindow' : 'globe',
      label: looksLikeUrl ? `Go to ${q}` : `Search the web for “${q}”`,
      run: async () => {
        const res = await sendMsg('SEARCH_WEB', { text: q });
        if (!res || !res.ok) {
          const engine = DB.settingsOf(STATE).searchEngine || 'google';
          sendMsg('OPEN_URL', { url: (SEARCH_URLS[engine] || SEARCH_URLS.google) + encodeURIComponent(q), forceNewTab: true });
        }
      }
    };
  }

  function paletteTabItem(t) {
    return { kind: 'tab', label: t.title || t.url, url: t.url, favicon: t.favIconUrl || '', run: () => sendMsg('FOCUS_TAB', { tabId: t.id }) };
  }

  /* Build the rows for `query` ('' = browse the current level). */
  function paletteBuildItems(q) {
    const level = paletteLevel();
    const atRoot = !palNav.length;
    if (!q) {
      const all = level.map(i => Object.assign({}, i, { section: i.heading || null }));
      if (atRoot) OPEN_TABS.slice(0, 5).forEach(t => all.push(Object.assign(paletteTabItem(t), { section: 'Open tabs' })));
      return all;
    }

    // Search flattens the current level's whole subtree, so at the root every
    // theme and individual setting value is reachable by typing.
    const ranked = SearchUtils.rankItems(q, SearchUtils.flattenTree(level)).map(i => {
      const out = Object.assign({}, i, { section: PALETTE_KIND_SECTION[i.kind] || 'Commands' });
      if (i.kind === 'theme') { if (i.themeType) out.hint = i.themeType; }
      else if (i.path && i.path.length) out.hint = i.path.join(' › ');
      out.label = i.searchLabel != null ? i.searchLabel : i.label;
      return out;
    });

    if (atRoot) {
      // Bookmarks from every collection, ranked per word across title, tags,
      // site, URL, description and notes (common/bmsearch.js: typo tolerance,
      // tag:foo / site:github.com / -word). De-duplicated by full URL.
      const seenUrls = new Set();
      const uniqueBms = Object.values(STATE.bookmarks).filter(bm => {
        const urlKey = (bm.url || '').trim().toLowerCase();
        if (!urlKey || seenUrls.has(urlKey)) return false;
        seenUrls.add(urlKey);
        return true;
      });
      BookmarkSearch.rank(q, uniqueBms, { limit: 24 }).forEach(r => {
        const bm = r.item;
        ranked.push({
          kind: 'bookmark', section: 'Bookmarks', label: bm.title || bm.url,
          favicon: bm.favicon || '', url: bm.url, hint: searchHost(bm.url),
          value: r.field || '',                     // WHY it matched, when it wasn't the title
          swatch: bm.tintColor || undefined,
          run: () => openBookmarkUrl(bm), match: { indices: r.indices }, score: r.score
        });
      });
      // Open tabs, so the palette doubles as a tab switcher.
      const seenTabIds = new Set();
      const tabs = OPEN_TABS.filter(t => !seenTabIds.has(t.id) && seenTabIds.add(t.id));
      BookmarkSearch.rank(q, tabs, { limit: 12, map: t => ({ title: t.title || t.url, url: t.url }) }).forEach(r => {
        ranked.push(Object.assign(paletteTabItem(r.item), {
          section: 'Tabs', hint: searchHost(r.item.url), value: r.field || '',
          match: { indices: r.indices }, score: r.score
        }));
      });
      ranked.sort((a, b) => b.score - a.score);
    }

    const out = SearchUtils.groupBySection(ranked, PALETTE_SECTION_CAPS, 30);
    if (atRoot) out.push(paletteWebItem(q));
    return out;
  }

  /* ---------- Rendering ---------- */
  function paletteIcon(name) { return name && ICONS[name] ? `<span class="pi-ic">${ICONS[name]}</span>` : ''; }

  function paletteRowHtml(item) {
    const visual = item.url
      ? favImg(item.url, item.favicon || '', 'pi-fav')
      : item.chips
      ? `<span class="pi-chips">${item.chips.map(c => `<span class="pi-chip" style="background:${escapeHtml(c)}"></span>`).join('')}</span>`
      : item.swatch ? `<span class="pi-swatch" style="background:${escapeHtml(item.swatch)}"></span>`
      : paletteIcon(item.icon || (item.kind === 'folder' ? 'folder' : ''));
    const hint = item.hint ? `<span class="pi-hint">${escapeHtml(item.hint)}</span>` : '';
    const value = item.value ? `<span class="pi-val">${escapeHtml(item.value)}</span>` : '';
    const check = item.checked ? `<span class="pi-check" aria-label="Current">${ICONS.check || '✓'}</span>` : '';
    const caret = item.children || item.kind === 'folder' ? '<span class="pi-caret">›</span>' : '';
    return `${visual}<span class="pi-main"><span class="pi-label">${highlightLabel(item.label, item.match && item.match.indices)}</span>${hint}</span>${value}${check}${caret}`;
  }

  function renderPaletteChrome(q) {
    const input = paletteInput();
    const crumb = $('#palette-crumb');
    input.placeholder = palNav.length
      ? `Filter ${palNav[palNav.length - 1].title}…`
      : 'Search bookmarks, tabs, themes, settings, and commands…';
    if (!palNav.length) { crumb.classList.add('hidden'); crumb.innerHTML = ''; return; }
    crumb.classList.remove('hidden');
    const trail = palNav.map((n, i) => `<span class="crumb-seg${i === palNav.length - 1 ? ' current' : ''}" role="button" data-i="${i}">${escapeHtml(n.title)}</span>`).join('<span class="crumb-sep">›</span>');
    crumb.innerHTML = `<span class="crumb-seg" role="button" data-i="-1">All</span><span class="crumb-sep">›</span>${trail}`;
  }

  function renderPaletteResults(query, opts) {
    const results = $('#palette-results');
    const keepScroll = opts && opts.keepScroll ? results.scrollTop : 0;
    const q = (query || '').trim();
    results.innerHTML = '';
    renderPaletteChrome(q);

    const all = paletteBuildItems(q);
    paletteItems = all;
    if (!all.length) {
      const where = palNav.length ? palNav[palNav.length - 1].title : 'the palette';
      results.appendChild(el('div', 'palette-empty', q ? `Nothing in ${escapeHtml(where)} matches “${escapeHtml(q)}”` : 'Nothing here'));
      updatePaletteFoot();
      paletteSyncThemePreview();
      return;
    }
    paletteIndex = Math.max(0, Math.min(paletteIndex, all.length - 1));

    let lastSection;
    all.forEach((item, i) => {
      if (item.section && item.section !== lastSection) results.appendChild(el('div', 'palette-section', escapeHtml(item.section)));
      lastSection = item.section;
      const row = el('div', 'palette-item', paletteRowHtml(item));
      row.id = `pal-opt-${i}`;
      row.dataset.i = String(i);
      row.setAttribute('role', 'option');
      results.appendChild(row);
    });
    setPaletteActive(paletteIndex, { scroll: !opts || !opts.keepScroll });
    if (opts && opts.keepScroll) results.scrollTop = keepScroll;
  }

  function updatePaletteFoot() {
    const foot = $('#palette-foot');
    if (!foot) return;
    const it = paletteItems[paletteIndex];
    const q = paletteInput().value;
    const verb = !it ? '' : it.children || it.kind === 'folder' ? 'open'
      : it.kind === 'theme' ? 'apply theme' : it.kind === 'setting' ? 'select'
      : it.kind === 'tab' ? 'switch to tab' : it.kind === 'bookmark' ? 'open' : 'run';
    const hint = (k, t) => `<span><kbd>${k}</kbd> ${t}</span>`;
    foot.innerHTML = [
      hint('↑↓', 'navigate'),
      verb ? hint('↵', verb) : '',
      it && (it.children || it.kind === 'folder') ? hint('→', 'enter group') : '',
      palNav.length && !q ? hint('⌫', 'back') : '',
      hint('esc', q ? 'clear' : palNav.length ? 'back' : 'close')
    ].join('');
  }

  /* Theme rows live-preview only after the user moves onto them (arrows /
     mouse) — never just because typing happened to put one first — and the
     preview is dropped the moment the active row isn't a theme. */
  function paletteSyncThemePreview() {
    const it = paletteItems[paletteIndex];
    if (paletteUserMoved && it && it.kind === 'theme') previewTheme(it.themeId);
    else endThemePreview();
  }

  function setPaletteActive(i, opts) {
    const rows = $$('.palette-item');
    if (!rows.length) return;
    paletteIndex = Math.max(0, Math.min(i, rows.length - 1));
    rows.forEach((r, k) => { r.classList.toggle('active', k === paletteIndex); r.setAttribute('aria-selected', k === paletteIndex ? 'true' : 'false'); });
    const active = rows[paletteIndex];
    paletteInput().setAttribute('aria-activedescendant', active.id);
    if (!opts || opts.scroll !== false) {
      if (paletteIndex === 0) $('#palette-results').scrollTop = 0;
      else active.scrollIntoView({ block: 'nearest' });
    }
    updatePaletteFoot();
    paletteSyncThemePreview();
  }

  function movePaletteActive(delta, wrap) {
    const n = paletteItems.length;
    if (!n) return;
    paletteUserMoved = true;
    const next = wrap ? (paletteIndex + delta + n) % n : Math.max(0, Math.min(paletteIndex + delta, n - 1));
    setPaletteActive(next);
  }

  /* ---------- Activation ---------- */
  function activatePaletteItem(item) {
    if (item.children || item.kind === 'folder') { pushPaletteNav(item); return; }
    runPaletteItem(item);
  }

  async function runPaletteItem(item) {
    if (item.kind === 'theme') commitThemePreview();
    // Close first so focus returns to the page *before* the command runs —
    // otherwise commands that open a dialog lose its autofocus to the palette's opener.
    if (!item.select) closePalette();
    try { await item.run(); } catch (err) { console.error('Palette command failed:', err); }
    if (item.select) {
      STATE = await DB.getState(); // reload() has applied it; re-read so check marks reflect the new value
      renderPaletteResults(paletteInput().value, { keepScroll: true });
    }
  }

  /* ---------- Events (wired once from dashboard.js boot) ---------- */
  function onPaletteKeydown(e) {
    if (e.isComposing) return;
    const input = e.target;
    const caretAtStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const caretAtEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const item = paletteItems[paletteIndex];
    const isFolder = !!item && !!(item.children || item.kind === 'folder');
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); movePaletteActive(1, true); break;
      case 'ArrowUp': e.preventDefault(); movePaletteActive(-1, true); break;
      case 'PageDown': e.preventDefault(); movePaletteActive(6, false); break;
      case 'PageUp': e.preventDefault(); movePaletteActive(-6, false); break;
      case 'ArrowRight':
        // Only steal the key when it can't be moving the text caret.
        if (isFolder && caretAtEnd) { e.preventDefault(); activatePaletteItem(item); }
        break;
      case 'Tab':
        e.preventDefault();
        if (isFolder) activatePaletteItem(item);
        break;
      case 'ArrowLeft':
        if (palNav.length && caretAtStart) { e.preventDefault(); popPaletteNav(); }
        break;
      case 'Backspace':
        if (palNav.length && !input.value) { e.preventDefault(); popPaletteNav(); }
        break;
      case 'Enter':
        e.preventDefault();
        if (item) activatePaletteItem(item);
        break;
      case 'Escape':
        // Staged: clear the query → leave the group → close.
        e.preventDefault(); e.stopPropagation();
        if (input.value) { input.value = ''; paletteIndex = 0; paletteUserMoved = false; renderPaletteResults(''); }
        else if (!popPaletteNav()) closePalette();
        break;
    }
  }

  function wirePalette() {
    const input = paletteInput();
    const results = $('#palette-results');
    input.addEventListener('input', () => { paletteIndex = 0; paletteUserMoved = false; renderPaletteResults(input.value); });
    input.addEventListener('keydown', onPaletteKeydown);
    // Keep focus in the input when clicking rows / crumbs.
    results.addEventListener('mousedown', (e) => e.preventDefault());
    $('#palette-crumb').addEventListener('mousedown', (e) => e.preventDefault());
    results.addEventListener('click', (e) => {
      const row = e.target.closest('.palette-item');
      const it = row && paletteItems[parseInt(row.dataset.i, 10)];
      if (it) activatePaletteItem(it);
    });
    // Hover moves the highlight — but only on real pointer movement, so a
    // list scrolling under a resting cursor doesn't hijack the selection
    // (or flip the live theme preview).
    results.addEventListener('mousemove', (e) => {
      const last = paletteLastMouse;
      paletteLastMouse = { x: e.screenX, y: e.screenY };
      if (last && last.x === e.screenX && last.y === e.screenY) return;
      const row = e.target.closest('.palette-item');
      if (!row) return;
      const i = parseInt(row.dataset.i, 10);
      if (i === paletteIndex && paletteUserMoved) return;
      paletteUserMoved = true;
      setPaletteActive(i, { scroll: false });
    });
    $('#palette-crumb').addEventListener('click', (e) => {
      const seg = e.target.closest('.crumb-seg[data-i]');
      if (!seg) return;
      palNav.length = parseInt(seg.dataset.i, 10) + 1;
      paletteIndex = 0; paletteUserMoved = false;
      input.value = '';
      renderPaletteResults('');
      input.focus();
    });
  }
