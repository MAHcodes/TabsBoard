/* TabsBoard — theme presets
 * Each preset only specifies 4 base colors (bg, surface-ish text, accent, type);
 * deriveTheme() expands that into the full CSS-variable palette so every
 * surface, border, and muted-text tone updates together, not just the accent.
 */
(function (root) {
  const CU = root.ColorUtils || (typeof require !== 'undefined' ? require('./color-utils.js') : null);

  const PRESET_THEMES = [
    { id: 'light',        name: 'Light',           type: 'light', bg: '#f4f5f9', text: '#1c1e26', accent: '#6366f1' },
    { id: 'dark',         name: 'Dark',            type: 'dark',  bg: '#14151c', text: '#eef0f6', accent: '#6366f1' },
    { id: 'midnight',     name: 'Midnight',        type: 'dark',  bg: '#0b1120', text: '#e2e8f0', accent: '#3b82f6' },
    { id: 'nord',         name: 'Nord',            type: 'dark',  bg: '#2e3440', text: '#eceff4', accent: '#88c0d0' },
    { id: 'dracula',      name: 'Dracula',         type: 'dark',  bg: '#282a36', text: '#f8f8f2', accent: '#ff79c6' },
    { id: 'forest',       name: 'Forest',          type: 'dark',  bg: '#101d15', text: '#e6f4ea', accent: '#34d399' },
    { id: 'grape',        name: 'Grape',           type: 'dark',  bg: '#1e1229', text: '#f3e8ff', accent: '#a855f7' },
    { id: 'slate',        name: 'Slate',           type: 'dark',  bg: '#1a1d23', text: '#e5e7eb', accent: '#94a3b8' },
    { id: 'solarized-d',  name: 'Solarized Dark',  type: 'dark',  bg: '#00303e', text: '#eee8d5', accent: '#b58900' },
    { id: 'ember',        name: 'Ember',           type: 'dark',  bg: '#1f1410', text: '#fde8d8', accent: '#f97316' },
    { id: 'ocean',        name: 'Ocean',           type: 'light', bg: '#eef6f8', text: '#0f2b30', accent: '#0891b2' },
    { id: 'sunset',       name: 'Sunset',          type: 'light', bg: '#fdf1ea', text: '#3a1f14', accent: '#f97316' },
    { id: 'rose',         name: 'Rose',            type: 'light', bg: '#fdf0f5', text: '#3a0e22', accent: '#e11d84' },
    { id: 'mint',         name: 'Mint',            type: 'light', bg: '#effaf3', text: '#0d2b1a', accent: '#10b981' },
    { id: 'solarized-l',  name: 'Solarized Light', type: 'light', bg: '#fdf6e3', text: '#073642', accent: '#268bd2' },
    { id: 'coffee',       name: 'Coffee',          type: 'light', bg: '#f7f0e8', text: '#2e1e12', accent: '#92400e' },
    { id: 'lavender',     name: 'Lavender',        type: 'light', bg: '#f3f1fb', text: '#241b40', accent: '#8b5cf6' },
    { id: 'sky',          name: 'Sky',             type: 'light', bg: '#eef5ff', text: '#0c2340', accent: '#2563eb' },
    { id: 'amoled',       name: 'AMOLED',          type: 'dark',  bg: '#000000', text: '#f2f2f5', accent: '#818cf8' },
    { id: 'charcoal',     name: 'Charcoal',        type: 'dark',  bg: '#1b1c1e', text: '#e9e9ec', accent: '#a3a3a3' },
    { id: 'cyberpunk',    name: 'Cyberpunk',       type: 'dark',  bg: '#0d0221', text: '#f1e8ff', accent: '#ff2fb0' },
    { id: 'terminal',     name: 'Terminal',        type: 'dark',  bg: '#031400', text: '#c8ffcf', accent: '#39ff6a' },
    { id: 'blush',        name: 'Blush',           type: 'light', bg: '#fdf2f4', text: '#3a1520', accent: '#fb7185' },
    { id: 'latte',        name: 'Latte',           type: 'light', bg: '#f6ede3', text: '#3b2a1e', accent: '#b45309' },
    { id: 'seafoam',      name: 'Seafoam',         type: 'light', bg: '#eaf7f4', text: '#0c2b25', accent: '#0d9488' },
    { id: 'ice',          name: 'Ice',             type: 'light', bg: '#eef9ff', text: '#0b2733', accent: '#0ea5e9' },
    { id: 'sandstone',    name: 'Sandstone',       type: 'light', bg: '#f5f0e6', text: '#2b2415', accent: '#a16207' },
    { id: 'peach',        name: 'Peach',           type: 'light', bg: '#fff2ea', text: '#3a1e10', accent: '#fb923c' },
    { id: 'birch',        name: 'Birch',           type: 'light', bg: '#f7f7f2', text: '#22241d', accent: '#65a30d' },
    { id: 'plum',         name: 'Plum',            type: 'dark',  bg: '#1e1024', text: '#f4e9fb', accent: '#c026d3' },
    { id: 'steel',        name: 'Steel',           type: 'dark',  bg: '#12181f', text: '#e3ecf5', accent: '#38bdf8' },
    { id: 'crimson',      name: 'Crimson',         type: 'dark',  bg: '#1c0f10', text: '#fbe4e6', accent: '#e11d48' },
    { id: 'olive',        name: 'Olive',           type: 'dark',  bg: '#171b0f', text: '#eef2e2', accent: '#a3e635' },
    { id: 'paper',        name: 'Paper',           type: 'light', bg: '#faf9f6', text: '#242220', accent: '#57534e' },
    { id: 'blueprint',    name: 'Blueprint',       type: 'dark',  bg: '#0a1e33', text: '#dbeafe', accent: '#60a5fa' },
    { id: 'clay',         name: 'Clay',            type: 'light', bg: '#f2e9e4', text: '#3d2b25', accent: '#c2410c' },
    { id: 'lagoon',       name: 'Lagoon',          type: 'dark',  bg: '#0c2a2e', text: '#d9f7f4', accent: '#2dd4bf' },
    { id: 'orchid',       name: 'Orchid',          type: 'light', bg: '#faf0fb', text: '#341539', accent: '#c026d3' },
    { id: 'espresso',     name: 'Espresso',        type: 'dark',  bg: '#1a120b', text: '#f0e2d3', accent: '#d97706' },
    { id: 'glacier',      name: 'Glacier',         type: 'light', bg: '#eef4f7', text: '#132530', accent: '#0284c7' },
    { id: 'mocha',        name: 'Mocha',           type: 'dark',  bg: '#1e1712', text: '#f2e6d8', accent: '#c08552' },
    { id: 'meadow',       name: 'Meadow',          type: 'light', bg: '#f1f7ea', text: '#1f2e14', accent: '#4d7c0f' },
    { id: 'nightowl',     name: 'Night Owl',       type: 'dark',  bg: '#0d1b2a', text: '#e0e9f2', accent: '#48cae4' },
    { id: 'rosewater',    name: 'Rosewater',       type: 'light', bg: '#fbf0ef', text: '#3a2224', accent: '#e07a8b' },
    { id: 'obsidian',     name: 'Obsidian',        type: 'dark',  bg: '#121212', text: '#ececec', accent: '#9b8afb' },
    { id: 'linen',        name: 'Linen',           type: 'light', bg: '#f6f3ec', text: '#2c2a24', accent: '#8a7452' },
    { id: 'deepsea',      name: 'Deep Sea',        type: 'dark',  bg: '#041521', text: '#d6ecf5', accent: '#00b4d8' },
    { id: 'apricot',      name: 'Apricot',         type: 'light', bg: '#fff3e6', text: '#3d2612', accent: '#ea7c3c' },
    { id: 'vaporwave',    name: 'Vaporwave',       type: 'dark',  bg: '#190938', text: '#f3e6ff', accent: '#ff3ea5' },
    { id: 'bumblebee',    name: 'Bumblebee',       type: 'dark',  bg: '#141414', text: '#f7f7f2', accent: '#f5c518' },
    { id: 'arctic',       name: 'Arctic',          type: 'dark',  bg: '#0f1e2b', text: '#e7f0f7', accent: '#fb7185' },
    { id: 'patina',       name: 'Patina',          type: 'dark',  bg: '#191510', text: '#efe5cf', accent: '#2dd4bf' },
    { id: 'crystal',      name: 'Crystal',         type: 'light', bg: '#eef3fb', text: '#1b2a4a', accent: '#7c8cf8' },
    { id: 'horizon',      name: 'Horizon',         type: 'dark',  bg: '#241505', text: '#fff3dd', accent: '#fbbf24' },
    { id: 'inkwell',      name: 'Inkwell',         type: 'light', bg: '#f2f0ea', text: '#241f18', accent: '#1f2937' },
    { id: 'peacock',      name: 'Peacock',         type: 'dark',  bg: '#0b1c1f', text: '#e4f6f3', accent: '#8b5cf6' }
  ];

  const COLLECTION_COLORS = [
    '#6366f1', '#ec4899', '#f59e0b', '#10b981',
    '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16',
    '#f97316', '#14b8a6', '#a855f7', '#0ea5e9'
  ];

  function deriveTheme(base) {
    const isDark = base.type === 'dark';
    const bg = base.bg, text = base.text, accent = base.accent;
    const surface = isDark ? CU.lighten(bg, 8) : '#ffffff';
    const surface2 = isDark ? CU.lighten(bg, 15) : CU.mix('#ffffff', bg, 0.5);
    const border = isDark ? CU.lighten(bg, 22) : CU.mix('#ffffff', bg, 0.75);
    const textMuted = CU.mix(text, bg, 0.42);
    return {
      id: base.id, name: base.name, type: base.type,
      bg, surface, surface2, border, text, textMuted,
      accent, accentSoft: accent + '26'
    };
  }

  function resolveTheme(themeId, customThemes) {
    if (themeId === 'auto') {
      const prefersDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
      return deriveTheme(PRESET_THEMES.find(t => t.id === (prefersDark ? 'dark' : 'light')));
    }
    const custom = customThemes && customThemes[themeId];
    if (custom) return deriveTheme(custom);
    const preset = PRESET_THEMES.find(t => t.id === themeId);
    return deriveTheme(preset || PRESET_THEMES[0]);
  }

  const Themes = { PRESET_THEMES, COLLECTION_COLORS, deriveTheme, resolveTheme };
  if (typeof module !== 'undefined') module.exports = Themes;
  root.Themes = Themes;
})(typeof self !== 'undefined' ? self : this);
