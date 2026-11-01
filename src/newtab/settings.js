  /* Settings panel + keyboard-shortcuts popup. Composes with the other newtab
   modules via the shared global scope (see index.html). */
  /* ============ SETTINGS PANEL ============ */
  function openSettings() { if (themeBuilder) closeThemeBuilder(); renderThemeGrids(); populateFontSelect(); syncSettingsUI(); renderPluginSettings(); showOverlay('#settings-overlay'); }
  // Closing Settings always drops the builder: its DOM must not survive into the
  // next open, and its live preview goes with it. endThemePreview() is a no-op
  // when nothing is being previewed.
  function closeSettings() {
    if (themeBuilder) { closeThemeBuilder(); endThemePreview(); }
    hideOverlay('#settings-overlay');
  }

  /* ---------- Notifications panel ----------
     Each control maps to one key of settings.notifications (see
     NOTIFICATION_DEFAULTS in storage.js). Segmented values are strings in the
     markup; `num` ones are stored as numbers. */
  const NOTIF_SEGMENTS = {
    'notif-toast-level': ['toastLevel', false],
    'notif-toast-position': ['toastPosition', false],
    'notif-toast-size': ['toastSize', false],
    'notif-toast-duration': ['toastDuration', true],
    'notif-toast-max': ['toastMax', true],
    'notif-browser-timeout': ['browserTimeout', true]
  };
  const NOTIF_SWITCHES = {
    'notif-toast-progress': 'toastProgress',
    'notif-toast-icons': 'toastIcons',
    'notif-toast-pause': 'toastPauseOnHover',
    'notif-toast-group': 'toastGroupDuplicates',
    'notif-browser-enabled': 'browserEnabled',
    'notif-browser-selection': 'browserSelectionSaved',
    'notif-browser-silent': 'browserSilent',
    'notif-pomo-enabled': 'pomodoroEnabled',
    'notif-pomo-focus': 'pomodoroOnFocusEnd',
    'notif-pomo-break': 'pomodoroOnBreakEnd',
    'notif-pomo-sound': 'pomodoroSound'
  };
  async function saveNotificationSetting(key, value) {
    await DB.updateSettings({ notifications: { [key]: value } });
    await reload();
    syncSettingsUI();
  }
  function wireNotificationSettings() {
    for (const [id, [key, num]] of Object.entries(NOTIF_SEGMENTS)) {
      $$(`#${id} button`).forEach(b => b.onclick = () => saveNotificationSetting(key, num ? parseInt(b.dataset.val, 10) : b.dataset.val));
    }
    for (const [id, key] of Object.entries(NOTIF_SWITCHES)) {
      const input = $('#' + id);
      if (input) input.onchange = (e) => saveNotificationSetting(key, e.target.checked);
    }
    $('#notif-test-toast').onclick = () => {
      const level = DB.notificationSettings(DB.settingsOf(STATE)).toastLevel;
      if (level === 'off') { toast('In-app notifications are turned off'); return; }
      toast('Settings saved', { type: 'success' });
      toast('Heads up — this is a warning', { type: 'warning' });
      toast("Couldn't do that — this is an example error", { type: 'error' });
    };
    $('#notif-test-browser').onclick = async () => {
      const res = await sendMsg('TEST_NOTIFICATION');
      if (!res || res.error) toast("Couldn't send a notification — is the extension's notification permission blocked?");
      else if (res.skipped) toast('Browser notifications are turned off above');
    };
    $('#notif-reset').onclick = async () => {
      await DB.updateSettings({ notifications: Object.assign({}, DB.NOTIFICATION_DEFAULTS) });
      await reload();
      syncSettingsUI();
      toast('Notification settings reset');
    };
  }
  function syncNotificationSettingsUI(s) {
    const n = DB.notificationSettings(s);
    for (const [id, [key]] of Object.entries(NOTIF_SEGMENTS)) {
      $$(`#${id} button`).forEach(b => b.classList.toggle('active', String(b.dataset.val) === String(n[key])));
    }
    for (const [id, key] of Object.entries(NOTIF_SWITCHES)) {
      const input = $('#' + id);
      if (input) input.checked = !!n[key];
    }
    // Sub-options are meaningless while their master switch is off.
    const dim = (ids, on) => ids.forEach(id => { const r = $('#' + id) && $('#' + id).closest('.switch-row'); if (r) r.style.opacity = on ? '' : '.5'; });
    dim(['notif-browser-selection', 'notif-browser-silent'], n.browserEnabled);
    dim(['notif-pomo-focus', 'notif-pomo-break', 'notif-pomo-sound'], n.pomodoroEnabled);
  }

  function openSettingsTab(tab) {
    $$('.settings-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.settings-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  }

  function wireSettingsPanel() {
    $$('.settings-tab').forEach(btn => {
      btn.onclick = () => openSettingsTab(btn.dataset.tab);
    });
    $('#settings-btn').onclick = openSettings;
    $('#settings-close-x').onclick = () => { endThemePreview(); closeSettings(); };

    populateFontSelect();
    const fontSelect = $('#interface-font');
    if (fontSelect) fontSelect.onchange = async (e) => {
      await DB.updateSettings({ interfaceFont: e.target.value || '' });
      await reload();
      syncSettingsUI();
    };
    $('#interface-font-custom').onclick = async () => {
      const cur = (DB.settingsOf(STATE).interfaceFont || '').trim();
      const val = await openDialog({
        title: 'Custom font',
        label: 'Font family',
        inputValue: cur,
        placeholder: 'e.g. Avenir Next, Papyrus…',
        okLabel: 'Apply'
      });
      if (val === null || val === false) return;
      const family = String(val).trim();
      if (family.length > 40) { toast('That font name looks too long.'); return; }
      if (family !== cur) await DB.updateSettings({ interfaceFont: family });
      await reload();
      populateFontSelect();
    };

    renderThemeGrids();
    $$('#theme-mode button').forEach(btn => btn.onclick = async () => {
      const auto = DB.settingsOf(STATE).themeId === 'auto';
      if (btn.dataset.val === 'auto' && !auto) await DB.updateSettings({ themeId: 'auto' });
      // Leaving Auto: keep whatever is showing right now, so the look doesn't change.
      else if (btn.dataset.val === 'fixed' && auto) await DB.updateSettings({ themeId: appliedThemeId() });
      else return;
      await reload();
      syncSettingsUI();
    });
    $$('#theme-type-filter button').forEach(btn => btn.onclick = () => {
      themeTypeFilter = btn.dataset.val;
      renderThemeGrids();
      syncSettingsUI();
    });
    const themeSearchInput = $('#theme-search-input');
    const themeSearchClear = $('#theme-search-clear');
    themeSearchClear.innerHTML = ICONS.close;
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

    $('#theme-builder-new').onclick = () => openThemeBuilder(null);
    $('#theme-builder-edit').onclick = () => openThemeBuilder(appliedThemeId());
    $('#theme-builder-delete').onclick = () => deleteCustomTheme(appliedThemeId());

    $$('#density-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ density: b.dataset.val }); await reload(); syncSettingsUI(); });
    $$('#radius-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ radius: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#setting-borders').onchange = async (e) => { await DB.updateSettings({ borders: e.target.checked }); await reload(); };
    $('#setting-floating-bars').onchange = async (e) => { await DB.updateSettings({ floatingBars: e.target.checked }); await reload(); };
    $('#setting-animations').onchange = async (e) => { await DB.updateSettings({ animations: e.target.checked }); await reload(); };
    $('#setting-popup-blur').onchange = async (e) => { await DB.updateSettings({ popupBlur: e.target.checked }); await reload(); };

    $$('#viewmode-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ viewMode: b.dataset.val }); await reload(); syncSettingsUI(); });
    $$('#boardcols-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ dashboard: { columns: parseInt(b.dataset.val, 10) } }); await reload(); syncSettingsUI(); });
    $('#setting-sidebar-collapsed').onchange = async (e) => { await DB.updateSettings({ sidebarCollapsed: e.target.checked }); await reload(); };
    $('#setting-sidebar-compact').onchange = async (e) => { await DB.updateSettings({ sidebarCompact: e.target.checked }); await reload(); };

    $('#setting-confirm-delete').onchange = async (e) => { await DB.updateSettings({ confirmDelete: e.target.checked }); await reload(); };
    $('#setting-open-in-new-tab').onchange = async (e) => { await DB.updateSettings({ openBookmarksInNewTab: e.target.checked }); await reload(); };
    $$('#search-engine-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ searchEngine: b.dataset.val }); await reload(); syncSettingsUI(); });
    $$('#favicon-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ faviconSource: b.dataset.val }); await reload(); syncSettingsUI(); });
    $('#favicon-cache-clear').onclick = async () => {
      await Favicons.clear();
      await Thumbs.clear();
      await syncSettingsUI();
      toast('Cache cleared — icons re-download as needed; refetch bookmarks to restore previews');
      await reload();
    };
    $('#setting-show-previews').onchange = async (e) => { await DB.updateSettings({ showPreviews: e.target.checked }); await reload(); };
    wireNotificationSettings();
    $('#setting-show-tab-audio').onchange = async (e) => { await DB.updateSettings({ tabsList: { showTabAudio: e.target.checked } }); await reload(); };
    $('#setting-group-pinned').onchange = async (e) => { await DB.updateSettings({ tabsList: { groupPinned: e.target.checked } }); await reload(); };
    $('#setting-dim-inactive').onchange = async (e) => { await DB.updateSettings({ tabsList: { dimInactive: e.target.checked } }); await reload(); };
    $('#setting-inactive-grayscale').onchange = async (e) => { await DB.updateSettings({ tabsList: { inactiveGrayscale: e.target.checked } }); await reload(); };
    $$('#inactiveopacity-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ tabsList: { inactiveOpacity: parseInt(b.dataset.val, 10) } }); await reload(); syncSettingsUI(); });

    $('#setting-show-topbar-search').onchange = async (e) => { await DB.updateSettings({ showTopbarSearch: e.target.checked }); await reload(); };
    $('#setting-show-shortcuts-button').onchange = async (e) => { await DB.updateSettings({ showShortcutsButton: e.target.checked }); await reload(); };
    $('#setting-show-trash-button').onchange = async (e) => { await DB.updateSettings({ showTrashButton: e.target.checked }); await reload(); };
    $$('#fontsize-toggle button').forEach(b => b.onclick = async () => { await DB.updateSettings({ interfaceFontSize: parseInt(b.dataset.val, 10) }); await reload(); syncSettingsUI(); });
    $$('#font-size-custom').forEach(inp => inp.onchange = async (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v >= 80 && v <= 150) { await DB.updateSettings({ interfaceFontSize: v }); await reload(); } else syncSettingsUI();
    });

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

    $('#settings-workspace').onchange = async (e) => {
      const id = e.target.value;
      if (!STATE.workspaces[id] || id === activeWorkspaceId()) return;
      // Settings (and any theme preview/builder) belong to the workspace being left.
      if (themeBuilder) closeThemeBuilder();
      endThemePreview();
      await DB.setActiveWorkspace(id);
      await reload();
      renderThemeGrids();
      syncSettingsUI();
    };
    $('#ws-settings-copy-btn').onclick = copyWorkspaceSettingsFlow;
    $('#ws-settings-reset-btn').onclick = resetWorkspaceSettingsFlow;

    $('#export-json-btn').onclick = async () => {
      const day = new Date().toISOString().slice(0, 10);
      downloadFile(`tabsboard-backup-${day}.json`, await DB.exportJSON(), 'application/json');
      toast('Backup exported — it includes every workspace and its settings');
    };
    $('#export-html-btn').onclick = () => {
      const cols = collectionsForActiveWS();
      const byCol = {};
      cols.forEach(c => byCol[c.id] = bookmarksForCollection(c.id));
      const html = DB.bookmarksHTMLExport(cols, byCol);
      downloadFile('bookmarks.html', html, 'text/html');
    };
    $('#import-json-input').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) await startBackupImport(file);
    };
    $('#danger-clear-all-btn').onclick = async () => {
      if (!(await uiConfirm('Clear ALL data? This permanently deletes every workspace, board, collection, bookmark, session, widget, and setting, and resets TabsBoard to a fresh install. This cannot be undone.', { title: 'Clear all data', okLabel: 'Clear all data', danger: true }))) return;
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
    const all = Themes.allThemes(savedCustomThemes());
    const list = all.filter(t => (themeTypeFilter === 'all' || t.type === themeTypeFilter) && (!q || t.name.toLowerCase().includes(q)));
    renderThemeGrid('#theme-grid-all', list);
    const meta = $('#theme-grid-meta');
    if (meta) meta.textContent = list.length === all.length ? `· ${all.length} themes` : `· ${list.length} of ${all.length} shown`;
    syncThemeCardStates();
    syncBuilderButtons();
  }

  /* The builder edits whatever theme is on screen, so its edit/delete buttons
     only make sense — and only enable — while a custom theme is applied. */
  function syncBuilderButtons() {
    const list = savedCustomThemes();
    const applied = appliedThemeId();
    const isCustom = Themes.isCustomId(applied) && list.some(t => t.id === applied);
    const editBtn = $('#theme-builder-edit');
    const delBtn = $('#theme-builder-delete');
    if (editBtn) { editBtn.disabled = !isCustom; editBtn.title = isCustom ? 'Edit this custom theme' : 'Only your own themes can be edited'; }
    if (delBtn) { delBtn.disabled = !isCustom; delBtn.title = isCustom ? 'Delete this custom theme' : 'Only your own themes can be deleted'; }
    const newBtn = $('#theme-builder-new');
    if (newBtn) newBtn.disabled = list.length >= Themes.MAX_CUSTOM_THEMES;
    const count = $('#theme-builder-count');
    if (count) count.textContent = `${list.length}/${Themes.MAX_CUSTOM_THEMES}`;
  }

  /* Font picker. No hardcoded availability list — the dropdown is filled with
   fonts actually on the machine. Sources:
   - chrome.fontSettings.getFontList (Chrome, instant, needs "fontSettings"
     permission) returns the full system list.
   - window.queryLocalFonts (Local Font Access API, Chrome + newer Firefox)
     enumerates installed families, prompting once for permission.
   - As a universal fallback (Firefox ships no font API), a canvas probe
     measures a test string against each candidate family; if the measured
     width differs from the bare serif fallback the family is installed, so
     only fonts that genuinely exist on the system end up in the list.
   The stored value is the bare family name; '' means "system default". */
  const PROBE_CHAR = 'mmmmmmmmmmbiblioilll';
  const PROBE_CANDIDATES = [
    // Windows
    'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara',
    'Cascadia Mono', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
    'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Leelawadee UI',
    'Lucida Console', 'Lucida Sans Unicode', 'Malgun Gothic', 'Microsoft YaHei', 'Microsoft Sans Serif',
    'MS Gothic', 'MV Boli', 'Nirmala UI', 'Palatino Linotype', 'Rockwell', 'Segoe Print',
    'Segoe Script', 'Segoe UI', 'Segoe UI Light', 'Segoe UI Semibold', 'Segoe UI Symbol',
    'SimSun', 'Sitka', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Yu Gothic',
    // macOS
    'Academy Engraved LET', 'American Typewriter', 'Apple Chancery', 'Apple SD Gothic Neo',
    'Avenir', 'Avenir Next', 'Avenir Next Condensed', 'Baskerville', 'Big Caslon', 'Brush Script MT',
    'Chalkboard', 'Cochin', 'Copperplate', 'Didot', 'Futura', 'Gill Sans', 'Helvetica',
    'Helvetica Neue', 'Hoefler Text', 'Lucida Grande', 'Marker Felt', 'Menlo', 'Monaco',
    'Optima', 'Palatino', 'Papyrus', 'SF Pro Display', 'Snell Roundhand', 'Songti SC', 'Times',
    // Linux / common distro
    'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'Droid Sans', 'Droid Sans Mono',
    'Droid Serif', 'Fira Sans', 'Fira Mono', 'FreeMono', 'FreeSans', 'FreeSerif', 'Liberation Mono',
    'Liberation Sans', 'Liberation Serif', 'Nimbus Mono PS', 'Nimbus Roman', 'Nimbus Sans',
    'Noto Sans', 'Noto Sans Mono', 'Noto Serif', 'Source Sans 3', 'Source Serif 4', 'Ubuntu', 'Ubuntu Mono',
    'URW Gothic', 'URW Palladio L',
    // Dev / UI favorites
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Poppins', 'Nunito Sans',
    'Work Sans', 'Archivo', 'Rubik', 'Manrope', 'Sora', 'Barlow', 'Figtree', 'Karla',
    'Merriweather', 'Playfair Display', 'IBM Plex Sans', 'IBM Plex Serif', 'IBM Plex Mono',
    'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'Hack', 'Inconsolata', 'Space Mono', 'Monoid'
  ];
  function probeFontAvailable(family) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = '48px serif';
      const baseline = ctx.measureText(PROBE_CHAR).width;
      ctx.font = `48px "${family}", serif`;
      return ctx.measureText(PROBE_CHAR).width !== baseline;
    } catch (e) { return false; }
  }
  function populateFontSelect() {
    const sel = $('#interface-font');
    if (!sel) return;
    sel.innerHTML = '<option value="">System default</option>';
    const add = (familyName) => {
      const family = String(familyName || '').trim();
      if (!family || sel.querySelector(`option[value="${CSS.escape(family)}"]`)) return;
      const o = document.createElement('option');
      o.value = family;
      o.textContent = family;
      sel.appendChild(o);
    };
    const keepSelection = () => {
      const cur = (DB.settingsOf(STATE).interfaceFont || '').trim();
      if (cur && !sel.querySelector(`option[value="${CSS.escape(cur)}"]`)) add(cur);
      sel.value = cur;
      syncSettingsUI();
    };
    // Chrome-only instant list (callback style for broad compat).
    if (chrome.fontSettings && chrome.fontSettings.getFontList) {
      try {
        chrome.fontSettings.getFontList((fonts) => {
          if (!fonts) return keepSelection();
          (fonts || []).forEach(f => add(f && (f.displayName || f.fontId)));
          keepSelection();
        });
      } catch (e) { keepSelection(); }
    } else {
      keepSelection();
    }
    // Local Font Access API: every installed system font. Needs a user
    // gesture, so this is triggered from openSettings() (a click).
    if (window.queryLocalFonts) {
      window.queryLocalFonts()
        .then((entries) => {
          const seen = new Set();
          (entries || []).forEach(f => {
            const fam = (f && f.family || '').trim();
            if (fam && !seen.has(fam)) { seen.add(fam); add(fam); }
          });
          keepSelection();
        })
        .catch(() => { /* permission denied / unavailable — fall back to probe */ });
    }
    // Universal fallback (Firefox has no font API): probe the candidate list
    // and add only families that measure differently from the serif fallback,
    // i.e. fonts that are actually installed. Duplicates against the entries
    // above are skipped by add().
    if (!window.queryLocalFonts) {
      PROBE_CANDIDATES.forEach((name) => {
        if (probeFontAvailable(name)) add(name);
      });
    }
  }

  /* ---------- Themes panel ----------

     Three things are always on screen so you never have to guess:
       1. the "In use now" card, painted in the theme that is actually showing;
       2. the mode — Follow system (a Light-mode and a Dark-mode theme; the one
          matching your OS is marked "Showing now") or Single theme;
       3. a strong ring + badge on the grid card that is applied, and a dashed ring
          on the other mode's theme.
     In Follow-system mode a click on a theme fills the Light or Dark slot that
     matches the theme's own type — it never silently switches Auto off. */
  let themeTypeFilter = 'all';   // 'all' | 'light' | 'dark' — which themes the grid lists

  function prefersDarkMode() {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function slotThemeId(key) {
    const s = DB.settingsOf(STATE);
    return key === 'light' ? (s.lightThemeId || Themes.DEFAULT_LIGHT_ID) : (s.darkThemeId || Themes.DEFAULT_DARK_ID);
  }
  function appliedThemeId() {
    const s = DB.settingsOf(STATE);
    return s.themeId !== 'auto' ? s.themeId : slotThemeId(prefersDarkMode() ? 'dark' : 'light');
  }
  function themeById(id) {
    return Themes.findTheme(id, savedCustomThemes()) || Themes.defaultTheme(prefersDarkMode());
  }
  function themeChipsHtml(t) {
    return themeChipColors(t).map(c => `<span style="background:${c}"></span>`).join('');
  }
  /* Paints an element in a theme's own colors (its accent/background are exposed as
     --tc-main / --tc-bg so borders and badges can use them). */
  function paintThemed(elm, t) {
    elm.style.background = t.bg;
    elm.style.color = t.text;
    elm.style.setProperty('--tc-main', t.main);
    elm.style.setProperty('--tc-bg', t.bg);
  }

  function revealSelectedTheme(smooth) {
    const card = $('#theme-grid-all .theme-swatch-card.selected');
    if (card) card.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }

  function renderThemeCurrent() {
    const host = $('#theme-current');
    if (!host) return;
    const s = DB.settingsOf(STATE);
    const auto = s.themeId === 'auto';
    const sysDark = prefersDarkMode();
    const t = themeById(appliedThemeId());
    paintThemed(host, t);
    host.innerHTML = `
      <div class="tc-chips">${themeChipsHtml(t)}</div>
      <div class="tc-text">
        <div class="tc-kicker">${ICONS.check}<span>In use now</span>${auto ? `<span class="tc-tag">${ICONS.monitor}Auto</span>` : ''}${t.custom ? '<span class="tc-tag">Custom</span>' : ''}</div>
        <div class="tc-name">${escapeHtml(t.name)}</div>
        <div class="tc-sub">${auto
          ? `Your system is in ${sysDark ? 'dark' : 'light'} mode, so your ${sysDark ? 'Dark' : 'Light'}-mode theme is showing.`
          : 'Used in both light and dark mode.'}</div>
      </div>
      <button type="button" class="tc-find">Show in list</button>`;
    host.querySelector('.tc-find').onclick = () => {
      themeTypeFilter = 'all';
      const q = $('#theme-search-input');
      if (q) q.value = '';
      renderThemeGrids();
      syncSettingsUI();
      revealSelectedTheme(true);
    };
  }

  function renderAutoThemeBoxes() {
    const sysDark = prefersDarkMode();
    $$('#auto-theme-boxes .auto-slot').forEach(box => {
      const key = box.dataset.key;
      const t = themeById(slotThemeId(key));
      const isNow = (key === 'dark') === sysDark;
      paintThemed(box, t);
      box.innerHTML = `
        <span class="slot-head"><span class="slot-ic">${key === 'light' ? ICONS.sun : ICONS.moon}</span><span>${key === 'light' ? 'Light' : 'Dark'} mode</span>${isNow ? '<span class="slot-now">Showing now</span>' : ''}</span>
        <span class="slot-body"><span class="tc-chips">${themeChipsHtml(t)}</span><span class="slot-name">${escapeHtml(t.name)}</span></span>`;
      box.classList.toggle('active-now', isNow);
      box.classList.toggle('filtering', themeTypeFilter === key);
      box.setAttribute('aria-pressed', String(themeTypeFilter === key));
      box.title = `Browse ${key} themes to use in ${key} mode`;
      box.onclick = () => {
        themeTypeFilter = themeTypeFilter === key ? 'all' : key;
        renderThemeGrids();
        syncSettingsUI();
        const grid = $('#theme-grid-all');
        if (grid) grid.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
    });
  }

  function syncThemeModeUI() {
    const auto = DB.settingsOf(STATE).themeId === 'auto';
    $$('#theme-mode button').forEach(b => {
      const on = (b.dataset.val === 'auto') === auto;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('#theme-type-filter button').forEach(b => {
      const on = b.dataset.val === themeTypeFilter;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const extras = $('#auto-theme-extras');
    if (extras) extras.classList.toggle('hidden', !auto);
    const hint = $('#theme-mode-hint');
    if (!hint) return;
    const sysDark = prefersDarkMode();
    if (!auto) hint.textContent = 'One theme, whatever your system is set to. Switch to Follow system to use a different theme in light and dark mode.';
    else if (themeTypeFilter === 'all') hint.textContent = `Click a theme below to use it in its own mode — light themes fill Light mode, dark themes fill Dark mode. Your system is in ${sysDark ? 'dark' : 'light'} mode right now.`;
    else hint.textContent = `Showing ${themeTypeFilter} themes — click one to use it in ${themeTypeFilter} mode.${(themeTypeFilter === 'dark') === sysDark ? '' : ` You'll see it when your system is in ${themeTypeFilter} mode.`}`;
  }

  /* Marks, on the grid: the theme in use (strong ring + "In use"), and in
     Follow-system mode the theme assigned to the other mode (dashed ring). */
  function syncThemeCardStates() {
    const auto = DB.settingsOf(STATE).themeId === 'auto';
    const applied = appliedThemeId();
    const lightId = slotThemeId('light'), darkId = slotThemeId('dark');
    $$('#theme-grid-all .theme-swatch-card').forEach(card => {
      const id = card.dataset.themeId;
      const isApplied = id === applied;
      const modes = auto ? [id === lightId ? 'light' : null, id === darkId ? 'dark' : null].filter(Boolean) : [];
      card.classList.toggle('selected', isApplied);
      card.classList.toggle('slot-pick', !isApplied && modes.length > 0);
      card.setAttribute('aria-pressed', String(isApplied));
      const badge = card.querySelector('.tsc-badge');
      if (!badge) return;
      if (isApplied) badge.innerHTML = `${ICONS.check}In use`;
      else if (modes.length) badge.innerHTML = modes.map(m => `${m === 'light' ? ICONS.sun : ICONS.moon}${m === 'light' ? 'Light' : 'Dark'}`).join(' ');
      else badge.innerHTML = '';
      badge.hidden = !badge.innerHTML;
    });
  }

  function syncThemeUI() {
    renderThemeCurrent();
    renderAutoThemeBoxes();
    syncThemeModeUI();
    syncThemeCardStates();
    syncBuilderButtons();
  }

  async function applyThemeChoice(t) {
    commitThemePreview();
    const s = DB.settingsOf(STATE);
    if (s.themeId === 'auto') {
      const key = t.type === 'light' ? 'light' : 'dark';
      await DB.updateSettings(key === 'light' ? { lightThemeId: t.id } : { darkThemeId: t.id });
      await reload();
      syncSettingsUI();
      toast(`${key === 'light' ? 'Light' : 'Dark'} mode now uses ${t.name}${(key === 'dark') === prefersDarkMode() ? '' : ` — you'll see it when your system is in ${key} mode`}`);
    } else {
      await DB.updateSettings({ themeId: t.id });
      await reload();
      syncSettingsUI();
    }
  }

  function renderThemeGrid(selector, list) {
    const wrap = $(selector);
    wrap.innerHTML = '';
    if (!list.length) { wrap.appendChild(el('div', 'theme-empty-hint', 'No themes match.')); return; }
    list.forEach(t => {
      const card = el('div', 'theme-swatch-card');
      card.dataset.themeId = t.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      paintThemed(card, t);
      const chips = themeChipColors(t);
      /* Custom themes carry their own two buttons next to the name, so you can
         open the builder or drop one straight from the grid. */
      const tools = t.custom ? `<span class="theme-card-tools">
          <button type="button" data-act="edit" title="Edit ${escapeHtml(t.name)}" aria-label="Edit ${escapeHtml(t.name)}">${ICONS.edit}</button>
          <button type="button" data-act="del" title="Delete ${escapeHtml(t.name)}" aria-label="Delete ${escapeHtml(t.name)}">${ICONS.trash}</button>
        </span>` : '';
      card.innerHTML = `<span class="tsc-badge" hidden></span><div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div>
        <div class="theme-swatch-foot"><div class="theme-swatch-label">${escapeHtml(t.name)}</div>${tools}</div>`;
      card.onclick = () => applyThemeChoice(t);
      card.onkeydown = (e) => {
        if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); applyThemeChoice(t); }
      };
      card.querySelectorAll('.theme-card-tools button').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          if (btn.dataset.act === 'edit') openThemeBuilder(t.id);
          else deleteCustomTheme(t.id);
        };
      });
      wrap.appendChild(card);
    });
  }

  /* The "Editing settings for" picker: every workspace, the active one selected.
     Rebuilt only when the list of workspaces changed, so it never flickers. */
  function syncSettingsWorkspacePicker() {
    const sel = $('#settings-workspace');
    if (!sel) return;
    const list = Object.values(STATE.workspaces).sort((a, b) => a.order - b.order);
    const sig = list.map(w => w.id + '\u0001' + w.name).join('\u0002');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '';
      list.forEach(w => { const o = document.createElement('option'); o.value = w.id; o.textContent = w.name; sel.appendChild(o); });
    }
    sel.value = activeWorkspaceId();
    const copyBtn = $('#ws-settings-copy-btn');
    if (copyBtn) copyBtn.disabled = list.length < 2;
  }

  function syncSettingsUI() {
    syncSettingsWorkspacePicker();
    const s = DB.settingsOf(STATE);
    syncThemeUI();
    $$('#density-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.density));
    $$('#radius-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === (s.radius || 'default')));
    $('#setting-borders').checked = s.borders !== false;
    $('#setting-floating-bars').checked = !!s.floatingBars;
    $('#setting-animations').checked = s.animations !== false;
    $('#setting-popup-blur').checked = s.popupBlur !== false;

    $$('#viewmode-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.viewMode));
    $$('#boardcols-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === ((s.dashboard && s.dashboard.columns) || 4)));
    $('#setting-sidebar-collapsed').checked = !!s.sidebarCollapsed;
    $('#setting-sidebar-compact').checked = !!s.sidebarCompact;

    $('#setting-confirm-delete').checked = s.confirmDelete !== false;
    $('#setting-open-in-new-tab').checked = !!s.openBookmarksInNewTab;
    $$('#search-engine-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === (s.searchEngine || 'google')));
    $$('#favicon-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.faviconSource));
    { const pv = $('#setting-show-previews'); if (pv) pv.checked = s.showPreviews !== false; }
    syncNotificationSettingsUI(s);
    { const si = $('#storage-info');
      if (si && DB.storageStats) DB.storageStats().then(st => {
        const c = st.counts, mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
        const parts = [`${c.bookmarks} bookmark${c.bookmarks === 1 ? '' : 's'}`, `${c.collections} collection${c.collections === 1 ? '' : 's'}`, `${c.widgets} widget${c.widgets === 1 ? '' : 's'}`];
        if (c.sessions) parts.push(`${c.sessions} session${c.sessions === 1 ? '' : 's'}`);
        if (c.trash) parts.push(`${c.trash} in trash`);
        si.textContent = parts.join(' · ') + (st.usage != null ? ` — using ${mb(st.usage)} of browser storage.` : '.');
      }).catch(() => { si.textContent = 'Storage details unavailable.'; });
    }
    { const info = $('#favicon-cache-info');
      if (info) {
        const st = Favicons.stats();
        Thumbs.stats().then(ts => {
          const parts = [];
          if (st.count) parts.push(`${st.count} icon${st.count === 1 ? '' : 's'} (${Math.max(1, Math.round(st.bytes / 1024))} KB)`);
          if (ts.count) parts.push(`${ts.count} preview${ts.count === 1 ? '' : 's'} (${Math.max(1, Math.round(ts.bytes / 1024))} KB)`);
          info.textContent = parts.length ? `Cached: ${parts.join(' · ')}. Works offline; clear it if something looks stale.` : 'Icons and previews are cached after they first load.';
        });
      } }
    const tl = s.tabsList || {};
    $('#setting-show-tab-audio').checked = tl.showTabAudio !== false;
    $('#setting-group-pinned').checked = tl.groupPinned !== false;
    $('#setting-dim-inactive').checked = tl.dimInactive !== false;
    $('#setting-inactive-grayscale').checked = tl.inactiveGrayscale !== false;
    $$('#inactiveopacity-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (tl.inactiveOpacity ?? 55)));

    $('#setting-show-topbar-search').checked = s.showTopbarSearch !== false;
    $('#setting-show-shortcuts-button').checked = s.showShortcutsButton !== false;
    $('#setting-show-trash-button').checked = s.showTrashButton !== false;
    $$('#fontsize-toggle button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.val, 10) === (s.interfaceFontSize || 100)));
    $$('#font-size-custom').forEach(inp => inp.value = (s.interfaceFontSize || 100));
    const fontSel = $('#interface-font');
    if (fontSel) {
      const cur = (s.interfaceFont || '').trim();
      if (cur && !fontSel.querySelector(`option[value="${CSS.escape(cur)}"]`)) {
        const o = document.createElement('option');
        o.value = cur; o.textContent = cur;
        fontSel.appendChild(o);
      }
      fontSel.value = cur;
    }

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

  /* ---------- Workspace settings: copy / reset ---------- */
  function afterWorkspaceSettingsChange() {
    if (themeBuilder) closeThemeBuilder();
    endThemePreview();
    applySettings();
    renderThemeGrids();
    syncSettingsUI();
  }
  async function undoableWorkspaceSettingsChange(wsId, message, change) {
    const before = DB.settingsOf(STATE, wsId);
    await change();
    await reload();
    afterWorkspaceSettingsChange();
    toast(message, {
      type: 'success',
      action: {
        label: 'Undo',
        fn: async () => { await DB.replaceWorkspaceSettings(wsId, before); await reload(); afterWorkspaceSettingsChange(); }
      }
    });
  }
  async function copyWorkspaceSettingsFlow() {
    const cur = STATE.workspaces[activeWorkspaceId()];
    if (!cur) return;
    const others = Object.values(STATE.workspaces).filter(w => w.id !== cur.id).sort((a, b) => a.order - b.order);
    if (!others.length) { toast('There is no other workspace to copy settings from yet'); return; }
    const fromId = await uiSearchablePicker('Copy settings from…', `Replaces the settings of “${cur.name}” with a copy of the chosen workspace's. Bookmarks and layouts are not touched.`,
      others.map(w => ({ id: w.id, label: w.name })), { okLabel: 'Copy', placeholder: 'Find a workspace…' });
    if (!fromId || !STATE.workspaces[fromId]) return;
    await undoableWorkspaceSettingsChange(cur.id, `Copied settings from “${STATE.workspaces[fromId].name}”`, () => DB.copyWorkspaceSettings(fromId, cur.id));
  }
  async function resetWorkspaceSettingsFlow() {
    const cur = STATE.workspaces[activeWorkspaceId()];
    if (!cur) return;
    if (!(await uiConfirm(`Reset the settings of “${cur.name}” to the defaults? Other workspaces, your custom themes and the trash settings are not affected.`, { title: 'Reset workspace settings', okLabel: 'Reset', danger: true }))) return;
    await undoableWorkspaceSettingsChange(cur.id, `Settings of “${cur.name}” reset to the defaults`, () => DB.resetWorkspaceSettings(cur.id));
  }

  /* ---------- Backup import ----------
     Picking a file first shows what is in it, then lets you choose between adding
     it next to what you have and replacing everything, and whether the
     workspaces' settings come along. Nothing is written until you confirm. */
  function backupPlural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  function openBackupImportDialog(fileName, info) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey, true);
        registerOverlayCloser('modal-overlay', closeModal);
        hideOverlay('#modal-overlay');
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') finish(null); };
      const when = info.exportedAt && !isNaN(Date.parse(info.exportedAt))
        ? new Date(info.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
      const shownNames = info.workspaceNames.slice(0, 4).map(n => `“${escapeHtml(n)}”`).join(', ') + (info.workspaceNames.length > 4 ? ` and ${info.workspaceNames.length - 4} more` : '');
      const counts = [backupPlural(info.workspaces, 'workspace'), backupPlural(info.collections, 'collection'), backupPlural(info.bookmarks, 'bookmark')];
      if (info.sessions) counts.push(backupPlural(info.sessions, 'session'));
      $('#modal-box').className = 'modal import-modal';
      $('#modal-box').innerHTML = `
        <h2>Import backup</h2>
        <p class="dialog-message">${escapeHtml(fileName)}${when ? ' · exported ' + escapeHtml(when) : ''}</p>
        <div class="import-summary">
          <div>${counts.join(' · ')}</div>
          <div class="hint-text">${shownNames}</div>
        </div>
        <div class="import-options" role="radiogroup" aria-label="How to import">
          <label class="import-option"><input type="radio" name="imp-mode" value="merge" checked><span><b>Add as new workspaces</b><small>Nothing you have now is changed or removed.</small></span></label>
          <label class="import-option danger"><input type="radio" name="imp-mode" value="replace"><span><b>Replace everything</b><small>Deletes all your current workspaces, bookmarks and settings first. Export a backup before you do this.</small></span></label>
        </div>
        <div class="switch-row import-settings-row">
          <span class="switch-text"><span class="switch-title">Include workspace settings</span><span class="switch-desc" id="imp-settings-desc"></span></span>
          <label class="switch"><input type="checkbox" id="imp-settings"${info.hasSettings ? ' checked' : ' disabled'}><span class="switch-track"><span class="switch-thumb"></span></span></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="mini-btn" id="imp-cancel">Cancel</button>
          <button type="button" class="mini-btn" id="imp-ok">Import</button>
        </div>`;
      const mode = () => $('#modal-box input[name="imp-mode"]:checked').value;
      const withSettings = () => info.hasSettings && $('#imp-settings').checked;
      const refresh = () => {
        const replace = mode() === 'replace';
        const on = withSettings();
        let msg;
        if (!info.hasSettings) msg = replace ? 'This file has no settings, so yours are kept.' : "This file has no settings — new workspaces start with this workspace's current settings.";
        else if (on) {
          msg = replace ? 'Your settings are replaced by the ones in the file.' : 'Each imported workspace keeps the look and behavior it had in the backup.';
          if (!replace && info.customThemes) msg += ` ${backupPlural(info.customThemes, 'custom theme')} will be added to your theme library.`;
        } else msg = replace ? 'Your current settings are kept.' : "New workspaces start with this workspace's current settings.";
        $('#imp-settings-desc').textContent = msg;
        const ok = $('#imp-ok');
        ok.textContent = replace ? 'Replace everything' : 'Import';
        ok.classList.toggle('danger', replace);
      };
      $$('#modal-box input[name="imp-mode"]').forEach(r => r.onchange = refresh);
      $('#imp-settings').onchange = refresh;
      $('#imp-cancel').onclick = () => finish(null);
      $('#imp-ok').onclick = () => finish({ mode: mode(), settings: withSettings() });
      registerOverlayCloser('modal-overlay', () => finish(null));
      showOverlay('#modal-overlay');
      refresh();
      $('#imp-ok').focus();
      document.addEventListener('keydown', onKey, true);
    });
  }

  async function startBackupImport(file) {
    let text, info;
    try {
      text = await file.text();
      info = DB.inspectBackup(text);
    } catch (err) {
      toast((err && err.code) ? err.message : 'Import failed: could not read that file', { type: 'error' });
      return;
    }
    const choice = await openBackupImportDialog(file.name, info);
    if (!choice) return;
    if (choice.mode === 'replace' && !(await uiConfirm('Replace everything with this backup? Your current workspaces, bookmarks, widgets and (if included) settings are deleted. This cannot be undone.', { title: 'Replace everything', okLabel: 'Replace everything', danger: true }))) return;
    try {
      const res = await DB.importJSON(text, choice.mode, { settings: choice.settings });
      await reload();
      applySettings();
      renderThemeGrids();
      syncSettingsUI();
      sendMsg('REBUILD_MENUS');
      const withSet = res && res.settingsImported ? ' with their settings' : '';
      toast(choice.mode === 'replace'
        ? `Backup restored — ${backupPlural(res.workspaces, 'workspace')}${withSet}`
        : `Imported ${backupPlural(res.workspaces, 'workspace')}${withSet}`, { type: 'success' });
      if (res && res.themesSkipped) toast(`${backupPlural(res.themesSkipped, 'custom theme')} not imported — the library holds 20`, { type: 'warning' });
    } catch (err) {
      toast((err && err.code) ? err.message : 'Import failed', { type: 'error' });
    }
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
    const list = $('#shortcut-list');
    if (list) {
      list.innerHTML = SHORTCUT_HELP.map(([label, combos]) =>
        `<li><span>${escapeHtml(label)}</span><span class="shortcut-keys">${shortcutKeysHtml(combos)}</span></li>`
      ).join('');
    }
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
        li.innerHTML = `<span>${escapeHtml(c.description || c.name)}</span><span class="shortcut-keys">${c.shortcut ? c.shortcut.split('+').map(part => `<kbd>${escapeHtml(part)}</kbd>`).join(IS_MAC ? '' : '<span class="shortcut-sep">+</span>') : '<span class="shortcut-unset">Not set</span>'}</span>`;
        ul.appendChild(li);
      });
      wrap.classList.remove('hidden');
    });
  }
  function closeShortcuts() { hideOverlay('#shortcuts-overlay'); }
