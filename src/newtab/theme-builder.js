  /* TabsBoard — custom theme builder (Settings ▸ Themes).
     The eight exposed slots are the ones the app's stylesheet paints from
     (Themes.COLOR_SLOTS); monkeytype's two unused "colorful error" slots are
     derived on save so a custom theme is still a complete theme object.

     Everything here is live: any edit repaints the page behind the settings
     modal immediately, exactly like hovering a preset in the grid does. Cancel
     (or closing Settings) drops the preview and the saved theme comes back. */
  let themeBuilder = null; // { id, name, type, colors, touched } while open, else null

  function savedCustomThemes() { return STATE.meta.settings.customThemes || []; }

  /* The palette the builder is currently describing — all ten slots, ready for
     applyThemeColors(). The eight picked slots go in first; the two derived ones
     are filled from them after. */
  function builderPalette() {
    const p = {
      id: themeBuilder.id || 'custom-preview',
      name: themeBuilder.name || 'Custom',
      type: themeBuilder.type,
      custom: true
    };
    Themes.COLOR_SLOTS.forEach(slot => { p[slot.key] = themeBuilder.colors[slot.key]; });
    return Themes.withDerivedColors(p);
  }

  function builderPanel() { return $('#theme-builder'); }

  function closeThemeBuilder() {
    themeBuilder = null;
    const panel = builderPanel();
    if (panel) { panel.innerHTML = ''; panel.classList.add('hidden'); }
  }

  function openThemeBuilder(existingId) {
    const s = STATE.meta.settings;
    // Only your own themes are editable — a preset id starts a new theme seeded
    // from it instead of quietly turning into a copy.
    const found = existingId ? Themes.findTheme(existingId, savedCustomThemes()) : null;
    const existing = found && found.custom ? found : null;
    if (existingId && !existing) { toast('Only your own themes can be edited.'); return; }
    if (!existing && savedCustomThemes().length >= Themes.MAX_CUSTOM_THEMES) {
      toast(`You can keep ${Themes.MAX_CUSTOM_THEMES} custom themes — delete one first.`);
      return;
    }
    /* A new theme starts from whatever you're looking at right now: the theme
       being edited if the builder is already open, otherwise the applied one. */
    const base = existing || (themeBuilder ? builderPalette() : Themes.resolveTheme(s.themeId, s.lightThemeId, s.darkThemeId, savedCustomThemes()));
    const colors = {};
    Themes.COLOR_SLOTS.forEach(slot => { colors[slot.key] = base[slot.key]; });
    themeBuilder = {
      id: existing ? existing.id : null,
      name: existing ? existing.name : '',
      type: existing ? existing.type : (base.type || 'dark'),
      colors,
      touched: {}
    };
    renderThemeBuilder();
    const panel = builderPanel();
    panel.classList.remove('hidden');
    const nameInput = $('#tb-name');
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  }

  function renderThemeBuilder() {
    const panel = builderPanel();
    if (!panel) return;
    const b = themeBuilder;
    panel.innerHTML = `
      <div class="tb-head">
        <h4>${b.id ? 'Edit custom theme' : 'New custom theme'}</h4>
        <div class="segmented tb-mode" id="tb-mode">
          <button type="button" data-val="dark">Dark</button>
          <button type="button" data-val="light">Light</button>
        </div>
      </div>
      <div class="field"><label for="tb-name">Theme name</label>
        <input type="text" id="tb-name" maxlength="40" autocomplete="off" spellcheck="false" placeholder="My theme" value="${escapeHtml(b.name)}">
      </div>
      <div class="tb-slots">${Themes.COLOR_SLOTS.map(slot => `
        <div class="tb-slot" data-slot="${slot.key}">
          <span class="tb-slot-label">${escapeHtml(slot.label)}<em>${escapeHtml(slot.hint)}</em></span>
          <input type="color" class="tb-color" value="${b.colors[slot.key]}" aria-label="${escapeHtml(slot.label)} color">
          <input type="text" class="tb-hex" value="${b.colors[slot.key]}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${escapeHtml(slot.label)} hex value">
        </div>`).join('')}</div>
      <div class="tb-contrast" id="tb-contrast"></div>
      <div class="tb-actions">
        <button type="button" class="mini-btn" id="tb-derive" title="Recalculate the muted, caret, and error colors from the background, text, and accent you picked">Auto-fill</button>
        <button type="button" class="mini-btn" id="tb-cancel">Cancel</button>
        <button type="button" class="primary-btn" id="tb-save">Save &amp; use</button>
      </div>
      <div class="hint-text">Changes preview live on this page — Cancel puts the saved theme back. The two "colorful error" colors Monkeytype carries are derived from your accent and error colors; nothing in this app paints them.</div>`;

    $('#tb-name').addEventListener('input', (e) => { themeBuilder.name = e.target.value; });
    $$('#tb-mode button').forEach(btn => btn.onclick = () => {
      themeBuilder.type = btn.dataset.val;
      // The derived colors are background-dependent, so a Light ⇄ Dark flip
      // re-runs them (untouched slots only).
      autoFillSlots();
      renderThemeBuilder();
      previewBuilder();
    });
    $$('.tb-slot', panel).forEach(row => {
      const key = row.dataset.slot;
      const color = $('.tb-color', row);
      const hex = $('.tb-hex', row);
      color.addEventListener('input', (e) => {
        const v = Themes.normalizeHex(e.target.value, themeBuilder.colors[key]);
        themeBuilder.colors[key] = v;
        themeBuilder.touched[key] = true;
        hex.value = v;
        hex.classList.remove('invalid');
        previewBuilder();
      });
      hex.addEventListener('input', (e) => {
        const v = Themes.normalizeHex(e.target.value, null);
        // An in-progress value like "#ff" stays visible and flagged; the color
        // only moves once it's a real color.
        hex.classList.toggle('invalid', !Themes.isHex(e.target.value));
        if (!v) return;
        themeBuilder.colors[key] = v;
        themeBuilder.touched[key] = true;
        color.value = v;
        previewBuilder();
      });
      hex.addEventListener('blur', () => { hex.value = themeBuilder.colors[key]; hex.classList.remove('invalid'); });
    });
    $('#tb-derive').onclick = () => { autoFillSlots(); renderThemeBuilder(); previewBuilder(); };
    $('#tb-cancel').onclick = () => { closeThemeBuilder(); endThemePreview(); };
    $('#tb-save').onclick = saveThemeBuilder;
    syncBuilderButtons();
    previewBuilder();
  }

  /* Fills the slots a person rarely thinks about from the three they do:
     background, text, accent. Panel, muted text, caret, and both error colors
     follow — and any slot the user has touched by hand is left alone, so
     Auto-fill (or flipping Light ⇄ Dark) never throws away a deliberate pick. */
  function autoFillSlots() {
    const b = themeBuilder;
    if (!b) return;
    const cu = (typeof ColorUtils !== 'undefined') ? ColorUtils : null;
    if (!cu) return;
    const { bg, main, text } = b.colors;
    const dark = b.type !== 'light';
    const error = cu.mix('#da3333', text, 0.15);
    const derived = {
      sub: cu.mix(text, bg, 0.42),
      subAlt: dark ? cu.darken(bg, 16) : cu.mix(bg, text, 0.12),
      caret: main,
      error,
      errorExtra: cu.darken(error, dark ? 22 : 8)
    };
    Object.keys(derived).forEach(k => { if (!b.touched[k]) b.colors[k] = derived[k]; });
  }

  /* Live repaint + the contrast readout. Text has to be readable against the
     page and the muted color has to be readable too — those are the two pairs
     that actually decide whether a theme works. */
  function previewBuilder() {
    if (!themeBuilder) return;
    const p = builderPalette();
    previewPalette(p);
    const out = $('#tb-contrast');
    if (!out) return;
    const pairs = [
      { label: 'Text on background', a: p.text, b: p.bg, min: 4.5 },
      { label: 'Muted on background', a: p.sub, b: p.bg, min: 3 },
      { label: 'Accent on background', a: p.main, b: p.bg, min: 3 }
    ];
    out.innerHTML = pairs.map(p2 => {
      const ratio = contrastRatio(p2.a, p2.b);
      const ok = ratio >= p2.min;
      return `<span class="tb-ratio${ok ? '' : ' low'}">${escapeHtml(p2.label)} <b>${ratio.toFixed(1)}:1</b>${ok ? '' : ' — too low'}</span>`;
    }).join('');
  }

  function contrastRatio(a, b) {
    const la = ColorUtils.relativeLuminance(a);
    const lb = ColorUtils.relativeLuminance(b);
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  async function saveThemeBuilder() {
    if (!themeBuilder) return;
    const list = savedCustomThemes().slice();
    const palette = builderPalette();
    const name = (themeBuilder.name || '').trim() || ('My theme ' + (list.length + 1));
    const id = themeBuilder.id || Themes.newCustomId();
    const record = Themes.normalizeCustom(Object.assign({}, palette, { id, name, type: themeBuilder.type }));
    const at = list.findIndex(t => t.id === id);
    if (at >= 0) list[at] = record; else list.push(record);
    themeBuilder = null;
    await DB.updateSettings({ customThemes: list });
    /* Auto keeps following the OS: the new theme takes over whichever slot
       matches the mode you're in right now, and the other one is left alone. */
    const s = STATE.meta.settings;
    if (s.themeId === 'auto') {
      await DB.updateSettings(prefersDarkMode() ? { darkThemeId: id } : { lightThemeId: id });
    } else {
      await DB.updateSettings({ themeId: id });
    }
    commitThemePreview();
    closeThemeBuilder();
    await reload();
    renderThemeGrids();
    syncSettingsUI();
    toast(`Saved “${name}”`);
  }

  async function deleteCustomTheme(themeId) {
    const t = Themes.findTheme(themeId, savedCustomThemes());
    if (!t) return;
    const inUse = STATE.meta.settings;
    const note = (inUse.themeId === themeId || inUse.lightThemeId === themeId || inUse.darkThemeId === themeId)
      ? ' It is in use right now, so that slot falls back to Serika.'
      : '';
    if (!(await uiConfirm(`Delete the custom theme “${t.name}”?${note} This can't be undone.`, { title: 'Delete custom theme', okLabel: 'Delete', danger: true }))) return;
    if (themeBuilder && themeBuilder.id === themeId) { closeThemeBuilder(); endThemePreview(); }
    const patch = { customThemes: savedCustomThemes().filter(x => x.id !== themeId) };
    if (inUse.themeId === themeId) patch.themeId = prefersDarkMode() ? 'serika_dark' : 'serika';
    if (inUse.lightThemeId === themeId) patch.lightThemeId = 'serika';
    if (inUse.darkThemeId === themeId) patch.darkThemeId = 'serika_dark';
    await DB.updateSettings(patch);
    await reload();
    renderThemeGrids();
    syncSettingsUI();
    toast('Custom theme deleted');
  }
