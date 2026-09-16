/* TabsBoard — icon set
 * Slim, minimal geometric line icons (stroke-width 1.6, round caps/joins,
 * simplified shapes) — a lighter, more modern alternative to a bold/chunky
 * icon face. Sized entirely via CSS on the container, since every <svg>
 * here fills 100% of whatever box it's placed in.
 */
(function (root) {
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = {
    search: `<svg viewBox="0 0 24 24" ${S}><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" ${S}><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>`,
    list: `<svg viewBox="0 0 24 24" ${S}><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/><path d="M9 6h11.5M9 12h11.5M9 18h11.5"/></svg>`,
    palette: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8.5"/><circle cx="8.3" cy="10.3" r="1" fill="currentColor" stroke="none"/><circle cx="11.6" cy="7.4" r="1" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r="1" fill="currentColor" stroke="none"/><circle cx="9.4" cy="15" r="1" fill="currentColor" stroke="none"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" ${S}><path d="M4.5 7h15"/><path d="M9.5 7V5.2A1.7 1.7 0 0111.2 3.5h1.6A1.7 1.7 0 0114.5 5.2V7"/><path d="M6.5 7l.9 12.3A1.8 1.8 0 009.2 21h5.6a1.8 1.8 0 001.8-1.7L17.5 7"/><path d="M10.3 11v6M13.7 11v6"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M17.7 6.3l-1.7 1.7M8 16l-1.7 1.7M17.7 17.7 16 16M8 8 6.3 6.3"/></svg>`,
    keyboard: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M6.5 10.2h.01M9.5 10.2h.01M12.5 10.2h.01M15.5 10.2h.01M17.5 10.2h.01M7 14.2h10"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" ${S}><path d="M12 5.5v13M5.5 12h13"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" ${S}><path d="M6 10l6 6 6-6"/></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" ${S}><path d="M14.5 18l-6-6 6-6"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" ${S}><path d="M11.5 20.5H4v-7.5L15.3 1.7a1.6 1.6 0 012.3 0l2.3 2.3a1.6 1.6 0 010 2.3z"/><path d="M13.3 4.3l3.4 3.4"/></svg>`,
    close: `<svg viewBox="0 0 24 24" ${S}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`,
    check: `<svg viewBox="0 0 24 24" ${S}><path d="M5 12.5l4.5 4.5L19.5 7"/></svg>`,
    folder: `<svg viewBox="0 0 24 24" ${S}><path d="M3.5 7.2a1.7 1.7 0 011.7-1.7h3.9l1.9 2h7.8a1.7 1.7 0 011.7 1.7v8.6a1.7 1.7 0 01-1.7 1.7H5.2a1.7 1.7 0 01-1.7-1.7z"/></svg>`,
    layers: `<svg viewBox="0 0 24 24" ${S}><rect x="6" y="3.5" width="12" height="8" rx="2"/><rect x="3.5" y="12.5" width="12" height="8" rx="2"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" ${S}><path d="M9.8 3h4.4l.6 2-1.4 1 .4 3.6 3.6 2.4-3.3 1.6L12 21l-.1-.9-.2-4.7-3.3-1.6 3.6-2.4.4-3.6-1.4-1z"/></svg>`,
    pinOff: `<svg viewBox="0 0 24 24" ${S}><path d="M9.8 3h4.4l.6 2-1.4 1 .4 3.6 3.6 2.4-3.3 1.6L12 21l-.1-.9-.2-4.7-3.3-1.6 3.6-2.4.4-3.6-1.4-1z"/><path d="M4 4l16 16"/></svg>`,
    duplicate: `<svg viewBox="0 0 24 24" ${S}><rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h2.5"/></svg>`,
    mute: `<svg viewBox="0 0 24 24" ${S}><path d="M10.5 5.3L6 9H3.3v6H6l4.5 3.7z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>`,
    unmute: `<svg viewBox="0 0 24 24" ${S}><path d="M10.5 5.3L6 9H3.3v6H6l4.5 3.7z"/><path d="M15.8 9.3a4 4 0 010 5.4"/><path d="M18.3 6.8a7.6 7.6 0 010 10.4"/></svg>`,
    externalWindow: `<svg viewBox="0 0 24 24" ${S}><rect x="3.5" y="5.5" width="11" height="8.5" rx="1.8"/><path d="M17 9h4v9.5a1.8 1.8 0 01-1.8 1.8H9.8A1.8 1.8 0 018 18.5V16"/></svg>`,
    openAll: `<svg viewBox="0 0 24 24" ${S}><path d="M13.5 3.5H20v6.5"/><path d="M20 3.5l-8.5 8.5"/><path d="M19 13.5v5.7a1.8 1.8 0 01-1.8 1.8H5.3a1.8 1.8 0 01-1.8-1.8V7a1.8 1.8 0 011.8-1.8H11"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" ${S}><rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.2 8.5V6a2 2 0 00-2-2H5.5a2 2 0 00-2 2v7.7a2 2 0 002 2h3"/></svg>`,
    sort: `<svg viewBox="0 0 24 24" ${S}><path d="M6.5 20V5M6.5 5L3 8.5M6.5 5L10 8.5"/><path d="M17.5 4v15M17.5 19l3.5-3.5M17.5 19L14 15.5"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" ${S}><path d="M12.3 3.5H4.7a1.2 1.2 0 00-1.2 1.2v7.6c0 .32.13.62.35.85l9.6 9.6a1.2 1.2 0 001.7 0l8-8a1.2 1.2 0 000-1.7l-9.6-9.6a1.2 1.2 0 00-.85-.35z"/><circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" stroke="none"/></svg>`,
    gripHandle: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>`,
    briefcase: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="7.5" width="18" height="12" rx="2.2"/><path d="M8.5 7.5V5.8A1.8 1.8 0 0110.3 4h3.4a1.8 1.8 0 011.8 1.8v1.7"/><path d="M3 13h18"/></svg>`,
    archive: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="4" width="18" height="4.5" rx="1.4"/><path d="M4.5 8.5V18a2 2 0 002 2h11a2 2 0 002-2V8.5"/><path d="M10 13h4"/></svg>`,
    x: `<svg viewBox="0 0 24 24" ${S}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`,
    link: `<svg viewBox="0 0 24 24" ${S}><rect x="2.5" y="8" width="8" height="8" rx="4"/><rect x="13.5" y="8" width="8" height="8" rx="4"/><path d="M9 12h6"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.2 3.7 5.3 3.7 8.5s-1.3 6.3-3.7 8.5c-2.4-2.2-3.7-5.3-3.7-8.5S9.6 5.7 12 3.5z"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" ${S}><path d="M4 12a8 8 0 0113.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 01-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/></svg>`,
    save: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3v10.5"/><path d="M8 10l4 4 4-4"/><path d="M4.5 15.5V19a2 2 0 002 2h11a2 2 0 002-2v-3.5"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3.5L21.5 20h-19z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="none"/></svg>`,
    notes: `<svg viewBox="0 0 24 24" ${S}><path d="M6 3.5h9l4.5 4.5V19a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 19V5A1.5 1.5 0 016 3.5z"/><path d="M15 3.5V7a1 1 0 001 1h3.5"/><path d="M8 12h8M8 15.5h5"/></svg>`,
    checkSquare: `<svg viewBox="0 0 24 24" ${S}><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.5 12.3l2.8 2.8 6.2-6.2"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/></svg>`,
    widget: `<svg viewBox="0 0 24 24" ${S}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8"/><rect x="13" y="3.5" width="7.5" height="17" rx="1.8"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8"/></svg>`,
    columns: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="4" width="4.5" height="16" rx="1.4"/><rect x="9.75" y="4" width="4.5" height="16" rx="1.4"/><rect x="16.5" y="4" width="4.5" height="16" rx="1.4"/></svg>`,
    trash2: `<svg viewBox="0 0 24 24" ${S}><path d="M4.5 7h15"/><path d="M9.5 7V5.2A1.7 1.7 0 0111.2 3.5h1.6A1.7 1.7 0 0114.5 5.2V7"/><path d="M6.5 7l.9 12.3A1.8 1.8 0 009.2 21h5.6a1.8 1.8 0 001.8-1.7L17.5 7"/></svg>`
  };

  root.ICONS = ICONS;
  if (typeof module !== 'undefined') module.exports = ICONS;
})(typeof self !== 'undefined' ? self : this);
