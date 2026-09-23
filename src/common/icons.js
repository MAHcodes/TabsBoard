/* TabsBoard — icon set
 * Icons are from Lucide (https://lucide.dev), vendored as inline SVG strings.
 * lucide-static v1.47.0 — ISC License. Copyright (c) Lucide Contributors.
 * Size is controlled entirely via CSS on the container; every <svg> here
 * fills 100% of whatever box it is placed in. Stroke styling is applied
 * below so the whole set stays visually consistent.
 */
(function (root) {
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = {
    search: `<svg viewBox="0 0 24 24" ${S}><path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" /></svg>`,
    grid: `<svg viewBox="0 0 24 24" ${S}><rect width="7" height="7" x="3" y="3" rx="1" /> <rect width="7" height="7" x="14" y="3" rx="1" /> <rect width="7" height="7" x="14" y="14" rx="1" /> <rect width="7" height="7" x="3" y="14" rx="1" /></svg>`,
    list: `<svg viewBox="0 0 24 24" ${S}><path d="M3 5h.01" /> <path d="M3 12h.01" /> <path d="M3 19h.01" /> <path d="M8 5h13" /> <path d="M8 12h13" /> <path d="M8 19h13" /></svg>`,
    palette: `<svg viewBox="0 0 24 24" ${S}><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" /> <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /> <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /> <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" /> <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /></svg>`,
    trash: `<svg viewBox="0 0 24 24" ${S}><path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>`,
    settings: `<svg viewBox="0 0 24 24" ${S}><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /> <circle cx="12" cy="12" r="3" /></svg>`,
    keyboard: `<svg viewBox="0 0 24 24" ${S}><path d="M10 8h.01" /> <path d="M12 12h.01" /> <path d="M14 8h.01" /> <path d="M16 12h.01" /> <path d="M18 8h.01" /> <path d="M6 8h.01" /> <path d="M7 16h10" /> <path d="M8 12h.01" /> <rect width="20" height="16" x="2" y="4" rx="2" /></svg>`,
    plus: `<svg viewBox="0 0 24 24" ${S}><path d="M5 12h14" /> <path d="M12 5v14" /></svg>`,
    dots: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" /></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" ${S}><path d="m6 9 6 6 6-6" /></svg>`,
    chevronLeft: `<svg viewBox="0 0 24 24" ${S}><path d="m15 18-6-6 6-6" /></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" ${S}><path d="m9 18 6-6-6-6" /></svg>`,
    edit: `<svg viewBox="0 0 24 24" ${S}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" /></svg>`,
    close: `<svg viewBox="0 0 24 24" ${S}><path d="M18 6 6 18" /> <path d="m6 6 12 12" /></svg>`,
    check: `<svg viewBox="0 0 24 24" ${S}><path d="M20 6 9 17l-5-5" /></svg>`,
    folder: `<svg viewBox="0 0 24 24" ${S}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>`,
    layers: `<svg viewBox="0 0 24 24" ${S}><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" /> <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" /> <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" /></svg>`,
    pin: `<svg viewBox="0 0 24 24" ${S}><path d="M12 17v5" /> <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></svg>`,
    pinOff: `<svg viewBox="0 0 24 24" ${S}><path d="M12 17v5" /> <path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" /> <path d="m2 2 20 20" /> <path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" /></svg>`,
    copyPlus: `<svg viewBox="0 0 24 24" ${S}><line x1="15" x2="15" y1="12" y2="18" /> <line x1="12" x2="18" y1="15" y2="15" /> <rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>`,
    mute: `<svg viewBox="0 0 24 24" ${S}><path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" /> <path d="m16.5 14.5 5-5" /> <path d="m16.5 9.5 5 5" /></svg>`,
    unmute: `<svg viewBox="0 0 24 24" ${S}><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /> <path d="M16 9a5 5 0 0 1 0 6" /> <path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></svg>`,
    externalWindow: `<svg viewBox="0 0 24 24" ${S}><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4" /> <rect width="10" height="7" x="12" y="13" rx="2" /></svg>`,
    openAll: `<svg viewBox="0 0 24 24" ${S}><path d="M15 3h6v6" /> <path d="M10 14 21 3" /> <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>`,
    copy: `<svg viewBox="0 0 24 24" ${S}><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>`,
    sort: `<svg viewBox="0 0 24 24" ${S}><path d="m21 16-4 4-4-4" /> <path d="M17 20V4" /> <path d="m3 8 4-4 4 4" /> <path d="M7 4v16" /></svg>`,
    tag: `<svg viewBox="0 0 24 24" ${S}><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /> <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></svg>`,
    gripHandle: `<svg viewBox="0 0 24 24" ${S}><circle cx="9" cy="12" r="1" /> <circle cx="9" cy="5" r="1" /> <circle cx="9" cy="19" r="1" /> <circle cx="15" cy="12" r="1" /> <circle cx="15" cy="5" r="1" /> <circle cx="15" cy="19" r="1" /></svg>`,
    briefcase: `<svg viewBox="0 0 24 24" ${S}><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /> <rect width="20" height="14" x="2" y="6" rx="2" /></svg>`,
    archive: `<svg viewBox="0 0 24 24" ${S}><rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" /></svg>`,
    link: `<svg viewBox="0 0 24 24" ${S}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>`,
    folderInput: `<svg viewBox="0 0 24 24" ${S}><path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" /> <path d="M2 13h10" /> <path d="m9 16 3-3-3-3" /></svg>`,
    globe: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" /></svg>`,
    refresh: `<svg viewBox="0 0 24 24" ${S}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /> <path d="M21 3v5h-5" /> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /> <path d="M8 16H3v5" /></svg>`,
    save: `<svg viewBox="0 0 24 24" ${S}><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" /></svg>`,
    warn: `<svg viewBox="0 0 24 24" ${S}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" /></svg>`,
    notes: `<svg viewBox="0 0 24 24" ${S}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /> <path d="M14 2v5a1 1 0 0 0 1 1h5" /> <path d="M10 9H8" /> <path d="M16 13H8" /> <path d="M16 17H8" /></svg>`,
    checkSquare: `<svg viewBox="0 0 24 24" ${S}><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="m16 9-5.5 5.5L8 12" /></svg>`,
    clock: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="10" /> <path d="M12 6v6l4 2" /></svg>`,
    widget: `<svg viewBox="0 0 24 24" ${S}><rect width="7" height="9" x="3" y="3" rx="1" /> <rect width="7" height="5" x="14" y="3" rx="1" /> <rect width="7" height="9" x="14" y="12" rx="1" /> <rect width="7" height="5" x="3" y="16" rx="1" /></svg>`,
    columns: `<svg viewBox="0 0 24 24" ${S}><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M9 3v18" /> <path d="M15 3v18" /></svg>`,
    panelLeftClose: `<svg viewBox="0 0 24 24" ${S}><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M9 3v18" /> <path d="m16 15-3-3 3-3" /></svg>`,
    panelLeftOpen: `<svg viewBox="0 0 24 24" ${S}><rect width="18" height="18" x="3" y="3" rx="2" /> <path d="M9 3v18" /> <path d="m14 9 3 3-3 3" /></svg>`,
    rotateCcwClock: `<svg viewBox="0 0 24 24" ${S}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /> <path d="M3 3v5h5" /> <path d="M12 7v5l4 2" /></svg>`,
    hourglass: `<svg viewBox="0 0 24 24" ${S}><path d="M5 22h14" /> <path d="M5 2h14" /> <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /> <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /></svg>`,
    clipboard: `<svg viewBox="0 0 24 24" ${S}><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>`,
    timer: `<svg viewBox="0 0 24 24" ${S}><line x1="10" x2="14" y1="2" y2="2" /> <line x1="12" x2="15" y1="14" y2="11" /> <circle cx="12" cy="14" r="8" /></svg>`,
    stopwatch: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="13" r="8" /> <path d="M12 9v4l2 2" /> <path d="M9 2h6" /> <path d="M12 2v3" /></svg>`,
    target: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="10" /> <circle cx="12" cy="12" r="6" /> <circle cx="12" cy="12" r="2" /></svg>`,
    cloudSun: `<svg viewBox="0 0 24 24" ${S}><path d="M12 2v2" /> <path d="m4.93 4.93 1.41 1.41" /> <path d="M20 12h2" /> <path d="m19.07 4.93-1.41 1.41" /> <path d="M15.947 12.65a4 4 0 0 0-5.925-4.128" /> <path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z" /></svg>`,
    rss: `<svg viewBox="0 0 24 24" ${S}><path d="M4 11a9 9 0 0 1 9 9" /> <path d="M4 4a16 16 0 0 1 16 16" /> <circle cx="5" cy="19" r="1" /></svg>`,
    download: `<svg viewBox="0 0 24 24" ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" /> <path d="M12 15V3" /></svg>`,
    arrowLeft: `<svg viewBox="0 0 24 24" ${S}><path d="m12 19-7-7 7-7" /> <path d="M19 12H5" /></svg>`,
    arrowRight: `<svg viewBox="0 0 24 24" ${S}><path d="M5 12h14" /> <path d="m12 5 7 7-7 7" /></svg>`,
    folderPlus: `<svg viewBox="0 0 24 24" ${S}><path d="M12 10v6" /> <path d="M9 13h6" /> <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>`,
  };

  root.ICONS = ICONS;
  if (typeof module !== 'undefined') module.exports = ICONS;
})(typeof self !== 'undefined' ? self : this);
