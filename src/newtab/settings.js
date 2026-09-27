  /* Settings panel + keyboard-shortcuts popup. Composes with the other newtab
   modules via the shared global scope (see index.html). */
  /* ============ SETTINGS PANEL ============ */
  function openSettings() { pickingThemeFor = null; if (themeBuilder) closeThemeBuilder(); renderThemeGrids(); populateFontSelect(); syncSettingsUI(); showOverlay('#settings-overlay'); }
  // Closing Settings always drops the builder: its DOM must not survive into the
  // next open, and its live preview goes with it. endThemePreview() is a no-op
  // when nothing is being previewed.
  function closeSettings() {
    if (themeBuilder) { closeThemeBuilder(); endThemePreview(); }
    hideOverlay('#settings-overlay');
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
      const cur = (STATE.meta.settings.interfaceFont || '').trim();
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
    const list = Themes.allThemes(savedCustomThemes()).filter(t => !q || t.name.toLowerCase().includes(q));
    renderThemeGrid('#theme-grid-all', list);
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
      const cur = (STATE.meta.settings.interfaceFont || '').trim();
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
      const t = Themes.findTheme(id, savedCustomThemes()) || Themes.PRESET_THEMES[0];
      const chips = themeChipColors(t);
      box.innerHTML = `<div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div><div class="theme-swatch-label">${escapeHtml(t.name)}</div>`;
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
      /* Custom themes carry their own two buttons next to the name, so you can
         open the builder or drop one straight from the grid. */
      const tools = t.custom ? `<span class="theme-card-tools">
          <button type="button" data-act="edit" title="Edit ${escapeHtml(t.name)}" aria-label="Edit ${escapeHtml(t.name)}">${ICONS.edit}</button>
          <button type="button" data-act="del" title="Delete ${escapeHtml(t.name)}" aria-label="Delete ${escapeHtml(t.name)}">${ICONS.trash}</button>
        </span>` : '';
      card.innerHTML = `<div class="theme-swatch-chips">${chips.map(c => `<span class="tsc" style="background:${c}"></span>`).join('')}</div>
        <div class="theme-swatch-foot"><div class="theme-swatch-label">${escapeHtml(t.name)}</div>${tools}</div>`;
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

  function syncSettingsUI() {
    const s = STATE.meta.settings;
    const autoOn = s.themeId === 'auto';
    const applied = appliedThemeId();
    $$('.theme-swatch-card').forEach(c => c.classList.toggle('selected', c.dataset.themeId === applied));
    $('#setting-auto-theme').checked = autoOn;
    const extras = $('#auto-theme-extras');
    if (extras) extras.classList.toggle('hidden', !autoOn);
    renderAutoThemeBoxes();
    syncBuilderButtons();
    const grid = $('#theme-grid-all');
    if (grid) grid.classList.toggle('pick-active', !!pickingThemeFor);
    $$('#density-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === s.density));
    $$('#radius-toggle button').forEach(b => b.classList.toggle('active', b.dataset.val === (s.radius || 'default')));
    $('#setting-borders').checked = s.borders !== false;
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
