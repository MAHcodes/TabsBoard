  /* Settings panel + keyboard-shortcuts popup. Composes with the other newtab
   modules via the shared global scope (see index.html). */
  /* ============ SETTINGS PANEL ============ */
  function openSettings() { pickingThemeFor = null; renderThemeGrids(); syncSettingsUI(); showOverlay('#settings-overlay'); }
  function closeSettings() { hideOverlay('#settings-overlay'); }

  function wireSettingsPanel() {
    $$('.settings-tab').forEach(btn => {
      btn.onclick = () => {
        $$('.settings-tab').forEach(b => b.classList.remove('active'));
        $$('.settings-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#panel-${btn.dataset.tab}`).classList.add('active');
      };
    });
    $('#settings-btn').onclick = openSettings;
    $('#settings-close-x').onclick = () => { endThemePreview(); closeSettings(); };

    renderThemeGrids();
    $$('#auto-theme-boxes .auto-theme-box').forEach(box => box.onclick = () => { startThemePick(box.dataset.key); });
    $('#setting-auto-theme').onchange = async (e) => {
      const s = STATE.meta.settings;
      if (e.target.checked) {
        await DB.updateSettings({ themeId: 'auto' });
      } else {
        // Turn auto off: land on whichever of the two modes matches the OS
        // right now, so the look barely changes.
        const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
        await DB.updateSettings({ themeId: prefersDark ? (s.darkThemeId || 'serika_dark') : (s.lightThemeId || 'serika') });
      }
      await reload();
      syncSettingsUI();
    };
    const themeSearchInput = $('#theme-search-input');
    const themeSearchClear = $('#theme-search-clear');
    themeSearchClear.innerHTML = ICONS.x;
    const updateSearchClear = () => themeSearchClear.classList.toggle('hidden', !themeSearchInput.value.trim());
    themeSearchInput.addEventListener('input', (e) => { renderThemeGrids(); syncSettingsUI(); updateSearchClear(); });
    themeSearchClear.onclick = () => {
      themeSearchInput.value = '';
      themeSearchInput.focus();
      renderThemeGrids();
      syncSettingsUI();
      updateSearchClear();
    };
    updateSearchClear();

    $$('#density-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ density: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#setting-animations').onchange = async (e) => { await DB.updateSettings({ animations: e.target.checked }); await reload(); };

    $$('#viewmode-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ viewMode: b.dataset.val }); await reload(); syncSettingsUI(); });
    $$('#boardcols-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ dashboard: { columns: parseInt(b.dataset.val, 10) } }); await reload(); syncSettingsUI(); });
    $('#setting-sidebar-collapsed').onchange = async (e) => { await DB.updateSettings({ sidebarCollapsed: e.target.checked }); await reload(); };
    $('#setting-sidebar-compact').onchange = async (e) => { await DB.updateSettings({ sidebarCompact: e.target.checked }); await reload(); };

    $('#setting-confirm-delete').onchange = async (e) => { await DB.updateSettings({ confirmDelete: e.target.checked }); await reload(); };
    $('#setting-open-in-new-tab').onchange = async (e) => { await DB.updateSettings({ openBookmarksInNewTab: e.target.checked }); await reload(); };
    $$('#favicon-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ faviconSource: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#setting-group-pinned').onchange = async (e) => { await DB.updateSettings({ tabsList: { groupPinned: e.target.checked } }); await reload(); };
    $('#setting-dim-inactive').onchange = async (e) => { await DB.updateSettings({ tabsList: { dimInactive: e.target.checked } }); await reload(); };
    $('#setting-inactive-grayscale').onchange = async (e) => { await DB.updateSettings({ tabsList: { inactiveGrayscale: e.target.checked } }); await reload(); };
    $$('#inactiveopacity-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ tabsList: { inactiveOpacity: parseInt(b.dataset.val, 10) } }); await reload(); syncSettingsUI(); });

    $('#setting-show-topbar-search').onchange = async (e) => { await DB.updateSettings({ showTopbarSearch: e.target.checked }); await reload(); };
    $('#setting-show-topbar-buttons').onchange = async (e) => { await DB.updateSettings({ showTopbarButtons: e.target.checked }); await reload(); };
    $('#setting-font-large').onchange = async (e) => { await DB.updateSettings({ interfaceFontLarge: e.target.checked }); await reload(); };

    $$('#widget-clock-format button').forEach(b => b.onclick = async () => { await DB.updateSettings({ clockFormat: b.dataset.val }); await reload(); syncSettingsUI(); });
    $$('#widget-weather-units button').forEach(b => b.onclick = async () => { await DB.updateSettings({ weatherUnits: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#widget-pomodoro-focus').onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (v >= 1 && v <= 180) { await DB.updateSettings({ pomodoroFocus: v }); await reload(); } else syncSettingsUI();
    };
    $('#widget-pomodoro-break').onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (v >= 1 && v <= 60) { await DB.updateSettings({ pomodoroBreak: v }); await reload(); } else syncSettingsUI();
    };
    $('#widget-countdown-days').onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (v >= 1 && v <= 365) { await DB.updateSettings({ countdownDays: v }); await reload(); } else syncSettingsUI();
    };
    $$('#widget-rss-refresh button').forEach(b => b.onclick = async () => { await DB.updateSettings({ rssRefreshInterval: parseInt(b.dataset.val, 10) }); await reload(); syncSettingsUI(); });

    $('#setting-confirm-restore-session').onchange = async (e) => { await DB.updateSettings({ confirmRestoreSession: e.target.checked }); await reload(); };

    $$('#recently-closed-limit button').forEach(b => b.onclick = async () => { await DB.updateSettings({ recentlyClosedLimit: parseInt(b.dataset.val, 10) }); await reload(); syncSettingsUI(); });
    $$('#trash-retention button').forEach(b => b.onclick = async () => { await DB.updateSettings({ trashRetentionDays: parseInt(b.dataset.val, 10) }); await reload(); syncSettingsUI(); });

    $('#setting-history-times').onchange = async (e) => { await DB.updateSettings({ historyShowTimes: e.target.checked }); await reload(); };
    $$('#history-count button').forEach(b => b.onclick = async () => { await DB.updateSettings({ historyCount: parseInt(b.dataset.val, 10) }); await reload(); syncSettingsUI(); });
    $$('#history-count-custom').forEach(inp => inp.onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 1 && v <= 200) { await DB.updateSettings({ historyCount: v }); await reload(); } else syncSettingsUI();
    });
    $$('#top-sites-count button').forEach(b => b.onclick = async () => { await DB.updateSettings({ topSitesCount: parseInt(b.dataset.val, 10) }); await reload(); syncSettingsUI(); });
    $$('#top-sites-count-custom').forEach(inp => inp.onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 1 && v <= 200) { await DB.updateSettings({ topSitesCount: v }); await reload(); } else syncSettingsUI();
    });
    $$('#recently-closed-custom').forEach(inp => inp.onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 0 && v <= 500) { await DB.updateSettings({ recentlyClosedLimit: v }); await reload(); } else syncSettingsUI();
    });

    $('#export-json-btn').onclick = async () => downloadFile('tabsboard-export.json', await DB.exportJSON(), 'application/json');
    $('#export-html-btn').onclick = () => {
      const cols = collectionsForActiveWS();
      const byCol = {};
      cols.forEach(c => byCol[c.id] = bookmarksForCollection(c.id));
      const html = DB.bookmarksHTMLExport(cols, byCol);
      downloadFile('bookmarks.html', html, 'text/html');
    };
    $('#import-json-input').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        await DB.importJSON(text, 'merge');
        toast('Imported successfully');
        await reload();
        sendMsg('REBUILD_MENUS');
      } catch (err) {
        toast('Import failed: invalid file');
      }
      e.target.value = '';
    };
    $('#danger-clear-all-btn').onclick = async () => {
      if (!confirm('Clear ALL data? This permanently deletes every workspace, board, collection, bookmark, session, widget, and setting, and resets TabsBoard to a fresh install. This cannot be undone.')) return;
      await DB.clearAll();
      await reload();
      applySettings();
      hideOverlay('#settings-overlay');
      sendMsg('REBUILD_MENUS');
      toast('All data cleared — TabsBoard is back to a fresh install');
    };
  }

  function renderThemeGrids() {
    const input = $('#theme-search-input');
    const q = (input ? input.value : '').trim().toLowerCase();
    const list = Themes.PRESET_THEMES.filter(t => !q || t.name.toLowerCase().includes(q));
    renderThemeGrid('#theme-grid-all', list);
  }

  /* The Auto section carries the toggle plus the two selected-theme boxes
     (Light/Dark). Clicking a box enters "picking" — the presets grid below
     gets highlighted, and clicking a preset assigns that theme to the box's
     mode. The grid's selected ring is always the theme actually applied right
     now (manual pick, or whichever preset matches the OS light/dark). */
  let pickingThemeFor = null; // 'light' | 'dark' | null

  function prefersDarkMode() {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function appliedThemeId() {
    const s = STATE.meta.settings;
    if (s.themeId !== 'auto') return s.themeId;
    return prefersDarkMode() ? (s.darkThemeId || 'serika_dark') : (s.lightThemeId || 'serika');
  }

  function renderAutoThemeBoxes() {
    const boxes = $$('#auto-theme-boxes .auto-theme-box');
    boxes.forEach(box => {
      const key = box.dataset.key;
      const s = STATE.meta.settings;
      const id = key === 'light' ? (s.lightThemeId || 'serika') : (s.darkThemeId || 'serika_dark');
      const t = Themes.PRESET_THEMES.find(x => x.id === id) || Themes.PRESET_THEMES[0];
      const chips = themeChipColors(t);
      box.innerHTML = `<div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div><div class="theme-swatch-label">${t.name}</div>`;
      box.style.background = t.bg;
      box.style.borderColor = t.main;
      box.style.color = t.text;
      box.classList.toggle('picking', pickingThemeFor === key);
      box.classList.toggle('selected', id === appliedThemeId());
    });
  }

  function startThemePick(key) {
    pickingThemeFor = pickingThemeFor === key ? null : key;
    renderAutoThemeBoxes();
    syncSettingsUI();
  }
  function cancelThemePick() {
    pickingThemeFor = null;
    renderAutoThemeBoxes();
    syncSettingsUI();
  }

  function renderThemeGrid(selector, list) {
    const wrap = $(selector);
    wrap.innerHTML = '';
    if (!list.length) { wrap.appendChild(el('div', 'theme-empty-hint', 'No themes match.')); return; }
    list.forEach(t => {
      const card = el('div', 'theme-swatch-card');
      card.dataset.themeId = t.id;
      card.style.background = t.bg;
      card.style.borderColor = t.main;
      card.style.color = t.text;
      const chips = themeChipColors(t);
      card.innerHTML = `<div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div><div class="theme-swatch-label">${t.name}</div>`;
      card.onclick = async () => {
        commitThemePreview();
        const s = STATE.meta.settings;
        if (pickingThemeFor) {
          const key = pickingThemeFor;
          await DB.updateSettings(key === 'light' ? { lightThemeId: t.id } : { darkThemeId: t.id });
          pickingThemeFor = null;
          STATE = await DB.getState();
          renderAutoThemeBoxes();
          if (s.themeId === 'auto' && prefersDarkMode() === (key === 'dark')) await reload();
          syncSettingsUI();
          toast(`${key === 'light' ? 'Light' : 'Dark'} theme set to ${t.name}`);
        } else {
          await DB.updateSettings({ themeId: t.id });
          await reload();
          syncSettingsUI();
        }
      };
      wrap.appendChild(card);
    });
  }

  function syncSettingsUI() {
    const s = STATE.meta.settings;
    const autoOn = s.themeId === 'auto';
    const applied = appliedThemeId();
    $$('.theme-swatch-card').forEach(c => c.classList.toggle('selected', c.dataset.themeId === applied));
    $('#setting-auto-theme').checked = autoOn;
    const extras = $('#auto-theme-extras');
    if (extras) extras.classList.toggle('hidden', !autoOn);
    renderAutoThemeBoxes();
    const grid = $('#theme-grid-all');
    if (grid) grid.classList.toggle('pick-active', !!pickingThemeFor);
    $$('#density-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.density));
    $('#setting-animations').checked = s.animations !== false;

    $$('#viewmode-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.viewMode));
    $$('#boardcols-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === ((s.dashboard && s.dashboard.columns) || 4)));
    $('#setting-sidebar-collapsed').checked = !!s.sidebarCollapsed;
    $('#setting-sidebar-compact').checked = !!s.sidebarCompact;

    $('#setting-confirm-delete').checked = s.confirmDelete !== false;
    $('#setting-open-in-new-tab').checked = !!s.openBookmarksInNewTab;
    $$('#favicon-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.faviconSource));
    const tl = s.tabsList || {};
    $('#setting-group-pinned').checked = tl.groupPinned !== false;
    $('#setting-dim-inactive').checked = tl.dimInactive !== false;
    $('#setting-inactive-grayscale').checked = tl.inactiveGrayscale !== false;
    $$('#inactiveopacity-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (tl.inactiveOpacity ?? 55)));

    $('#setting-show-topbar-search').checked = s.showTopbarSearch !== false;
    $('#setting-show-topbar-buttons').checked = s.showTopbarButtons !== false;
    $('#setting-font-large').checked = s.interfaceFontLarge === true;

    $$('#widget-clock-format button').forEach(b => b.classList.toggle('active', b.dataset.val === (s.clockFormat || '24')));
    $$('#widget-weather-units button').forEach(b => b.classList.toggle('active', b.dataset.val === (s.weatherUnits || 'c')));
    $('#widget-pomodoro-focus').value = s.pomodoroFocus || 25;
    $('#widget-pomodoro-break').value = s.pomodoroBreak || 5;
    $('#widget-countdown-days').value = s.countdownDays || 7;
    $$('#widget-rss-refresh button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (s.rssRefreshInterval || 0)));

    $('#setting-confirm-restore-session').checked = s.confirmRestoreSession === true;

    $$('#recently-closed-limit button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (s.recentlyClosedLimit ?? 20)));
    $$('#recently-closed-custom').forEach(inp => inp.value = (s.recentlyClosedLimit ?? 20));
    $$('#trash-retention button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (s.trashRetentionDays || 0)));
    $('#setting-history-times').checked = s.historyShowTimes !== false;
    $$('#history-count button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (s.historyCount || 10)));
    $$('#history-count-custom').forEach(inp => inp.value = (s.historyCount || 10));
    $$('#top-sites-count button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (s.topSitesCount || 12)));
    $$('#top-sites-count-custom').forEach(inp => inp.value = (s.topSitesCount || 12));
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* ============ SHORTCUTS POPUP ============ */
  function openShortcuts() {
    showOverlay('#shortcuts-overlay');
    // Show the actual, user-remapped globals reported by chrome.commands.
    sendMsg('GET_COMMANDS').then((res) => {
      const cmds = (res && res.commands) || [];
      const wrap = $('#commands-list-wrap');
      if (!wrap) return;
      const ul = $('#commands-list');
      if (!cmds.length) { wrap.classList.add('hidden'); return; }
      ul.innerHTML = '';
      cmds.forEach(c => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${escapeHtml(c.description || c.name)}</span><kbd>${escapeHtml(c.shortcut || '— not set —')}</kbd>`;
        ul.appendChild(li);
      });
      wrap.classList.remove('hidden');
    });
  }
  function closeShortcuts() { hideOverlay('#shortcuts-overlay'); }
